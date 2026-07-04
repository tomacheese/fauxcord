// src/routes/channel-messages.ts
/**
 * Channel messages API routing
 *
 * Implements message CRUD and bulk-delete for /channels/:channelId/messages.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { generateSnowflake } from '../snowflake'
import { getChannel } from '../services/channels'
import {
  getMessage,
  getMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  isTooOldForBulkDelete,
} from '../services/messages'
import {
  validateMessageCreate,
  isEmptyMessage,
  type MessageCreatePayload,
} from '../validators/message'
import type { AppEnv, BotRecord } from '../middleware/auth'
import { requireEntity, parseLimitQuery } from '../lib/route-helpers'

/**
 * Creates the channel messages API routes.
 * @param db - Database
 * @param baseUrl - Base URL
 * @param uploadPath - Directory attachments are saved to
 * @returns Hono router instance
 */
export function createChannelMessageRoutes(
  db: Database,
  baseUrl: string,
  uploadPath = '/data/uploads'
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /channels/:channelId/messages — List messages
  app.get('/channels/:channelId/messages', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    const limit = parseLimitQuery(c, 50, 100)
    const before = c.req.query('before')
    const after = c.req.query('after')
    const around = c.req.query('around')

    const messages = getMessages(
      db,
      channelId,
      { limit, before, after, around },
      baseUrl
    )
    return c.json(messages)
  })

  // GET /channels/:channelId/messages/:messageId — Retrieve a specific message
  app.get('/channels/:channelId/messages/:messageId', (c) => {
    const { messageId } = c.req.param()
    const msg = requireEntity(
      c,
      getMessage(db, messageId, baseUrl),
      DiscordErrorCode.UNKNOWN_MESSAGE,
      'Unknown Message'
    )
    if (msg instanceof Response) return msg
    return c.json(msg)
  })

  // POST /channels/:channelId/messages — Send a message
  app.post('/channels/:channelId/messages', async (c) => {
    const { channelId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    let bot = c.get('bot')
    // If auth middleware wasn't applied (e.g. in unit tests), fall back to a
    // direct token lookup so the author can still be resolved.
    if (!bot) {
      const authHeader = c.req.header('Authorization')
      if (authHeader) {
        bot = db
          .prepare('SELECT * FROM bots WHERE token = ?')
          .get(authHeader) as BotRecord | undefined
      }
    }
    const authorId = bot?.user_id ?? '000000000000000000'
    const authorToken = bot?.token ?? ''

    const contentType = c.req.header('content-type') ?? ''
    let payload: Record<string, unknown>
    const attachmentFiles: {
      name: string
      data: ArrayBuffer
      type: string
    }[] = []

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      const payloadJson = formData.get('payload_json')
      payload = payloadJson
        ? (JSON.parse(payloadJson as string) as Record<string, unknown>)
        : {}

      for (let i = 0; i < 10; i++) {
        const file = formData.get(`files[${i}]`) as File | null
        if (!file) break
        if (file.size > 25 * 1024 * 1024) {
          const err = discordError(
            DiscordErrorCode.FILE_TOO_LARGE,
            'File uploaded exceeds the maximum size',
            400
          )
          return c.json(err.body, 400)
        }
        attachmentFiles.push({
          name: file.name,
          data: await file.arrayBuffer(),
          type: file.type || 'application/octet-stream',
        })
      }
    } else {
      payload = await c.req.json<Record<string, unknown>>()
    }

    const hasAttachments = attachmentFiles.length > 0

    if (isEmptyMessage(payload, hasAttachments)) {
      const err = discordError(
        DiscordErrorCode.EMPTY_MESSAGE,
        'Cannot send an empty message',
        400
      )
      return c.json(err.body, 400)
    }

    const errors = validateMessageCreate(payload, hasAttachments)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const messageId = generateSnowflake()

    const msg = createMessage(
      db,
      {
        messageId,
        channelId,
        authorId,
        authorToken,
        content: payload.content as string | undefined,
        tts: payload.tts as boolean | undefined,
        embeds: payload.embeds as unknown[] | undefined,
        messageReference: payload.message_reference as
          | { message_id?: string }
          | undefined,
        flags: payload.flags as number | undefined,
      },
      baseUrl
    )

    if (attachmentFiles.length > 0) {
      try {
        const { saveAttachment } = await import('../services/attachments')
        for (const f of attachmentFiles) {
          // Each attachment gets its own Snowflake so concurrent uploads to
          // the same message don't collide on a shared PRIMARY KEY.
          await saveAttachment(
            db,
            uploadPath,
            baseUrl,
            channelId,
            messageId,
            generateSnowflake(),
            f.name,
            f.type,
            f.data
          )
        }
      } catch (err) {
        // Ignore a missing upload directory (e.g. in-memory test env), but
        // surface any other failure instead of silently discarding it.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
      }
    }

    return c.json(msg)
  })

  // PATCH /channels/:channelId/messages/:messageId — Edit a message
  app.patch('/channels/:channelId/messages/:messageId', async (c) => {
    const { messageId } = c.req.param()
    const bot = c.get('bot')

    const existing = requireEntity(
      c,
      getMessage(db, messageId, baseUrl),
      DiscordErrorCode.UNKNOWN_MESSAGE,
      'Unknown Message'
    )
    if (existing instanceof Response) return existing

    if (bot && existing.author.id !== bot.user_id) {
      const err = discordError(
        DiscordErrorCode.CANNOT_EDIT_OTHER,
        'Cannot edit a message authored by another user',
        403
      )
      return c.json(err.body, 403)
    }

    const payload =
      await c.req.json<Pick<MessageCreatePayload, 'content' | 'embeds'>>()

    const errors = validateMessageCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const updated = updateMessage(db, messageId, payload, baseUrl)
    return c.json(updated)
  })

  // DELETE /channels/:channelId/messages/:messageId — Delete a message
  // Unlike PATCH (which enforces authorship), deletion is intentionally not
  // ownership-guarded: the mock does not model MANAGE_MESSAGES, and real
  // Discord permits deleting other users' messages with that permission.
  app.delete('/channels/:channelId/messages/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    const deleted = deleteMessage(db, messageId, channelId)
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

  // POST /channels/:channelId/messages/bulk-delete — Bulk delete messages
  app.post('/channels/:channelId/messages/bulk-delete', async (c) => {
    const { channelId } = c.req.param()
    // JSON.parse converts 19-digit Snowflake integers to floating point and
    // loses precision (JavaScript number behavior). Libraries like discord.py
    // send Snowflakes as raw numbers, so extract them from the raw text with
    // a regex to preserve precision.
    const rawBody = await c.req.text()
    const messagesMatch = /"messages"\s*:\s*\[([^\]]*)\]/.exec(rawBody)
    const messages: string[] = messagesMatch
      ? (messagesMatch[1].match(/\d+/g) ?? [])
      : []

    if (messages.length < 2 || messages.length > 100) {
      const err = discordError(
        DiscordErrorCode.INVALID_BULK_DELETE,
        'Provided too many messages to delete',
        400
      )
      return c.json(err.body, 400)
    }

    for (const msgId of messages) {
      if (isTooOldForBulkDelete(db, msgId)) {
        const err = discordError(
          DiscordErrorCode.MESSAGE_TOO_OLD,
          'A message provided was too old to bulk delete',
          400
        )
        return c.json(err.body, 400)
      }
    }

    for (const msgId of messages) {
      // Scope deletion to this channel so IDs belonging to other channels are
      // not removed by a bulk-delete targeting a different channel.
      deleteMessage(db, msgId, channelId)
    }

    return c.body(null, 204)
  })

  return app
}
