/**
 * Webhooks API routing
 *
 * Implements the /webhooks/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { generateSnowflake } from '../snowflake'
import {
  getWebhook,
  getWebhookByToken,
  updateWebhook,
  deleteWebhook,
  executeWebhook,
} from '../services/webhooks'
import { getMessage, updateMessage, deleteMessage } from '../services/messages'
import { validateWebhookExecute } from '../validators/webhook'
import { isEmptyMessage } from '../validators/message'

/**
 * Creates the Webhooks API routes.
 * @param db - Database
 * @param baseUrl - Base URL
 * @returns Hono router instance
 */
export function createWebhookRoutes(db: Database, baseUrl: string): Hono {
  const app = new Hono()

  // GET /webhooks/:webhookId — Retrieve a webhook by ID
  app.get('/webhooks/:webhookId', (c) => {
    const { webhookId } = c.req.param()
    const webhook = getWebhook(db, webhookId)
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(webhook)
  })

  // GET /webhooks/:webhookId/:token — Retrieve a webhook by token without bot authentication
  app.get('/webhooks/:webhookId/:token', (c) => {
    const { webhookId, token } = c.req.param()
    const webhook = getWebhookByToken(db, webhookId, token)
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }
    // Return the webhook without the token field.
    // The Omit annotation ensures TypeScript catches any future addition
    // of sensitive fields to WebhookObject that should not be leaked here.
    const webhookWithoutToken: Omit<typeof webhook, 'token'> = {
      id: webhook.id,
      type: webhook.type,
      application_id: webhook.application_id,
      guild_id: webhook.guild_id,
      channel_id: webhook.channel_id,
      name: webhook.name,
      avatar: webhook.avatar,
    }
    return c.json(webhookWithoutToken)
  })

  // PATCH /webhooks/:webhookId — Update webhook information
  app.patch('/webhooks/:webhookId', async (c) => {
    const { webhookId } = c.req.param()
    const payload = await c.req.json<{
      name?: string
      channel_id?: string
    }>()

    const updated = updateWebhook(db, webhookId, payload)
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(updated)
  })

  // DELETE /webhooks/:webhookId — Delete a webhook
  app.delete('/webhooks/:webhookId', (c) => {
    const { webhookId } = c.req.param()
    const deleted = deleteWebhook(db, webhookId)
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  // PATCH /webhooks/:webhookId/:token — Update a webhook by token (no bot authentication required)
  app.patch('/webhooks/:webhookId/:token', async (c) => {
    const { webhookId, token } = c.req.param()

    const webhook = getWebhookByToken(db, webhookId, token)
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }

    const payload = await c.req.json<{
      name?: string
      avatar?: string | null
    }>()

    const updated = updateWebhook(db, webhookId, {
      name: payload.name,
      avatar: payload.avatar,
    })
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }

    // Token-based endpoints return the webhook without the token field.
    // The Omit annotation ensures TypeScript catches any future addition
    // of sensitive fields to WebhookObject that should not be leaked here.
    const webhookWithoutToken: Omit<typeof updated, 'token'> = {
      id: updated.id,
      type: updated.type,
      application_id: updated.application_id,
      guild_id: updated.guild_id,
      channel_id: updated.channel_id,
      name: updated.name,
      avatar: updated.avatar,
    }
    return c.json(webhookWithoutToken)
  })

  // DELETE /webhooks/:webhookId/:token — Delete a webhook by token (no bot authentication required)
  app.delete('/webhooks/:webhookId/:token', (c) => {
    const { webhookId, token } = c.req.param()

    const webhook = getWebhookByToken(db, webhookId, token)
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }

    deleteWebhook(db, webhookId)
    return c.body(null, 204)
  })

  // POST /webhooks/:webhookId/:token (execute)
  app.post('/webhooks/:webhookId/:token', async (c) => {
    const { webhookId, token } = c.req.param()
    // discord.py sends wait=True as ?wait=1. Interpret both "true" and "1" as truthy
    const waitParam = c.req.query('wait') ?? ''
    const wait = waitParam === 'true' || waitParam === '1'

    const webhook = getWebhookByToken(db, webhookId, token)
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }

    const contentType = c.req.header('content-type') ?? ''
    let payload: Record<string, unknown>

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      const payloadJson = formData.get('payload_json')
      payload = payloadJson
        ? (JSON.parse(payloadJson as string) as Record<string, unknown>)
        : {}
    } else {
      payload = await c.req.json<Record<string, unknown>>()
    }

    const hasAttachments = false // File attachments on webhook execution are a simplified implementation

    // Empty message check
    if (isEmptyMessage(payload, hasAttachments)) {
      const err = discordError(
        DiscordErrorCode.EMPTY_MESSAGE,
        'Cannot send an empty message',
        400
      )
      return c.json(err.body, 400)
    }

    // Validation
    const errors = validateWebhookExecute(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    if (!wait) {
      // When wait is false, execute asynchronously (save to DB in the background)
      const messageId = generateSnowflake()
      try {
        executeWebhook(
          db,
          {
            messageId,
            channelId: webhook.channel_id,
            webhookId: webhook.id,
            webhookName: webhook.name,
            content: payload.content as string | undefined,
            username: payload.username as string | undefined,
            tts: payload.tts as boolean | undefined,
            embeds: payload.embeds as unknown[] | undefined,
          },
          baseUrl
        )
      } catch {
        // Ignored because this runs in the background
      }
      return c.body(null, 204)
    }

    const messageId = generateSnowflake()
    const msg = executeWebhook(
      db,
      {
        messageId,
        channelId: webhook.channel_id,
        webhookId: webhook.id,
        webhookName: webhook.name,
        content: payload.content as string | undefined,
        username: payload.username as string | undefined,
        tts: payload.tts as boolean | undefined,
        embeds: payload.embeds as unknown[] | undefined,
      },
      baseUrl
    )

    return c.json(msg)
  })

  // GET /webhooks/:webhookId/:token/messages/:messageId — Retrieve a message sent via webhook
  app.get('/webhooks/:webhookId/:token/messages/:messageId', (c) => {
    const { webhookId, token, messageId } = c.req.param()

    const webhook = getWebhookByToken(db, webhookId, token)
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }

    const msg = getMessage(db, messageId, baseUrl)
    if (!msg) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(msg)
  })

  // PATCH /webhooks/:webhookId/:token/messages/:messageId — Edit a message sent via webhook
  app.patch('/webhooks/:webhookId/:token/messages/:messageId', async (c) => {
    const { webhookId, token, messageId } = c.req.param()

    const webhook = getWebhookByToken(db, webhookId, token)
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }

    const payload = await c.req.json<{
      content?: string
      embeds?: unknown[]
    }>()

    const updated = updateMessage(db, messageId, payload, baseUrl)
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(updated)
  })

  // DELETE /webhooks/:webhookId/:token/messages/:messageId — Delete a message sent via webhook
  app.delete('/webhooks/:webhookId/:token/messages/:messageId', (c) => {
    const { webhookId, token, messageId } = c.req.param()

    const webhook = getWebhookByToken(db, webhookId, token)
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }

    const deleted = deleteMessage(db, messageId)
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  return app
}
