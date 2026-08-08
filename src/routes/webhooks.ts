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
  buildGithubEmbed,
  type GithubWebhookPayload,
} from '../services/webhooks'
import {
  getMessage,
  updateMessage,
  deleteMessage,
  createMessage,
} from '../services/messages'
import { getChannel } from '../services/channels'
import { getInteractionFollowupTarget } from '../services/interactions'
import {
  validateWebhookExecute,
  validateWebhookUpdate,
} from '../validators/webhook'
import { isEmptyMessage } from '../validators/message'
import { parseGithubBody, parseSlackBody } from '../lib/route-helpers'

/**
 * Creates either a webhook-authored message (real webhook) or an
 * interaction-followup message (pseudo-webhook), depending on which one
 * `POST /webhooks/:id/:token` resolved to.
 * @param db - Database
 * @param messageId - Pre-generated message ID
 * @param webhook - The resolved webhook, or null when this is a followup
 * @param webhookIdParam - The route's `:webhookId` param (the application ID
 * for a followup)
 * @param targetChannelId - Destination channel ID
 * @param payload - Parsed request body
 * @param baseUrl - Base URL
 * @returns The created message object
 */
function createFollowupOrWebhookMessage(
  db: Database,
  messageId: string,
  webhook: ReturnType<typeof getWebhookByToken>,
  webhookIdParam: string,
  targetChannelId: string,
  payload: Record<string, unknown>,
  baseUrl: string
) {
  if (webhook) {
    return executeWebhook(
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
  }
  return createMessage(
    db,
    {
      messageId,
      channelId: targetChannelId,
      authorId: webhookIdParam,
      authorToken: 'interaction',
      content: payload.content as string | undefined,
      tts: payload.tts as boolean | undefined,
      embeds: payload.embeds as unknown[] | undefined,
    },
    baseUrl
  )
}

function getOriginalMessageId(
  db: Database,
  webhookId: string,
  token: string
): string | null {
  const interaction = getInteractionFollowupTarget(db, webhookId, token)
  if (interaction?.initialResponseMessageId)
    return interaction.initialResponseMessageId
  const webhook = getWebhookByToken(db, webhookId, token)
  if (!webhook) return null
  const message = db
    .prepare(
      'SELECT id FROM messages WHERE author_id = ? AND channel_id = ? ORDER BY id DESC LIMIT 1'
    )
    .get(webhook.id, webhook.channel_id) as { id: string } | undefined
  return message?.id ?? null
}

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

  // POST /webhooks/:webhookId/:token/github — GitHub webhook integration
  app.post('/webhooks/:webhookId/:token/github', async (c) => {
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

    const payload = await parseGithubBody<GithubWebhookPayload>(c)
    const embed = buildGithubEmbed(payload)
    const messageId = generateSnowflake()

    executeWebhook(
      db,
      {
        messageId,
        channelId: webhook.channel_id,
        webhookId: webhook.id,
        webhookName: webhook.name,
        embeds: [embed],
      },
      baseUrl
    )

    return c.body(null, 204)
  })

  // POST /webhooks/:webhookId/:token/slack — Slack webhook integration
  app.post('/webhooks/:webhookId/:token/slack', async (c) => {
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

    const slackBody = await parseSlackBody(c)
    const messageId = generateSnowflake()

    executeWebhook(
      db,
      {
        messageId,
        channelId: webhook.channel_id,
        webhookId: webhook.id,
        webhookName: webhook.name,
        content: slackBody.text,
        username: slackBody.username,
      },
      baseUrl
    )

    return c.json(null, 200)
  })

  // PATCH /webhooks/:webhookId — Update webhook information
  app.patch('/webhooks/:webhookId', async (c) => {
    const { webhookId } = c.req.param()
    const payload = await c.req.json<{
      name?: string
      channel_id?: string
    }>()

    const errors = validateWebhookUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    // Repointing to a nonexistent channel would leave the webhook in an
    // inconsistent state, so reject it like the real API.
    if (
      payload.channel_id !== undefined &&
      !getChannel(db, payload.channel_id)
    ) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }

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

    const errors = validateWebhookUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

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
    const interactionTarget = webhook
      ? null
      : getInteractionFollowupTarget(db, webhookId, token)
    if (!webhook && !interactionTarget) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        'Unknown Webhook',
        404
      )
      return c.json(err.body, 404)
    }
    const targetChannelId = webhook
      ? webhook.channel_id
      : (interactionTarget as { channelId: string }).channelId

    const contentType = c.req.header('content-type') ?? ''
    let payload: Record<string, unknown>
    let hasAttachments = false

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      const payloadJson = formData.get('payload_json')
      payload = payloadJson
        ? (JSON.parse(payloadJson as string) as Record<string, unknown>)
        : {}
      // A file-only message (no content/embeds) is not empty, so detect any
      // uploaded file entry rather than assuming there are no attachments.
      for (const [key, value] of formData) {
        if (
          (key === 'file' || key.startsWith('files[')) &&
          value instanceof File
        ) {
          hasAttachments = true
          break
        }
      }
    } else {
      payload = await c.req.json<Record<string, unknown>>()
    }

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
        createFollowupOrWebhookMessage(
          db,
          messageId,
          webhook,
          webhookId,
          targetChannelId,
          payload,
          baseUrl
        )
      } catch {
        // Ignored because this runs in the background
      }
      return c.body(null, 204)
    }

    const messageId = generateSnowflake()
    const msg = createFollowupOrWebhookMessage(
      db,
      messageId,
      webhook,
      webhookId,
      targetChannelId,
      payload,
      baseUrl
    )

    return c.json(msg)
  })

  // GET /webhooks/:webhookId/:token/messages/@original — Retrieve the
  // interaction's initial response message (real webhooks have no
  // "original" response concept; this 404s for them).
  app.get('/webhooks/:webhookId/:token/messages/@original', (c) => {
    const { webhookId, token } = c.req.param()
    const messageId = getOriginalMessageId(db, webhookId, token)
    if (!messageId) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
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

  // PATCH /webhooks/:webhookId/:token/messages/@original
  app.patch('/webhooks/:webhookId/:token/messages/@original', async (c) => {
    const { webhookId, token } = c.req.param()
    const messageId = getOriginalMessageId(db, webhookId, token)
    if (!messageId) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
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

  // DELETE /webhooks/:webhookId/:token/messages/@original
  app.delete('/webhooks/:webhookId/:token/messages/@original', (c) => {
    const { webhookId, token } = c.req.param()
    const messageId = getOriginalMessageId(db, webhookId, token)
    if (!messageId) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
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

  // GET /webhooks/:webhookId/:token/messages/:messageId — Retrieve a message sent via webhook
  app.get('/webhooks/:webhookId/:token/messages/:messageId', (c) => {
    const { webhookId, token, messageId } = c.req.param()

    const webhook = getWebhookByToken(db, webhookId, token)
    if (!webhook && !getInteractionFollowupTarget(db, webhookId, token)) {
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
    if (!webhook && !getInteractionFollowupTarget(db, webhookId, token)) {
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
    if (!webhook && !getInteractionFollowupTarget(db, webhookId, token)) {
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
