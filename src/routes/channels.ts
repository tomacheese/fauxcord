/**
 * Channels API routing
 *
 * Implements the /channels/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, discordError, validationError } from '../errors.js'
import { generateSnowflake } from '../snowflake.js'
import {
  getChannel,
  updateChannel,
  deleteChannel,
} from '../services/channels.js'
import {
  getMessage,
  getMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  isTooOldForBulkDelete,
  addReaction,
  removeReaction,
  removeEmojiReactions,
  removeAllReactions,
  getReactionUsers,
  getPinnedMessages,
  pinMessage,
  unpinMessage,
} from '../services/messages.js'
import { getChannelWebhooks, createWebhook } from '../services/webhooks.js'
import {
  validateMessageCreate,
  isEmptyMessage,
  type MessageCreatePayload,
} from '../validators/message.js'
import { validateWebhookCreate } from '../validators/webhook.js'
import type { AppEnv, BotRecord } from '../middleware/auth.js'
import { WEBHOOK_LIMITS } from '../validators/webhook.js'

/**
 * Creates the Channels API routes.
 * @param db - Database
 * @param baseUrl - Base URL
 * @returns Hono router instance
 */
export function createChannelRoutes(
  db: Database,
  baseUrl: string,
  uploadPath = '/data/uploads'
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /channels/:channelId — Retrieve channel information
  app.get('/channels/:channelId', (c) => {
    const { channelId } = c.req.param()
    const channel = getChannel(db, channelId)
    if (!channel) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(channel)
  })

  // PATCH /channels/:channelId — Update channel information
  app.patch('/channels/:channelId', async (c) => {
    const { channelId } = c.req.param()
    const payload = await c.req.json<{
      name?: string
      topic?: string | null
      nsfw?: boolean
      rate_limit_per_user?: number
      position?: number
    }>()

    const updated = updateChannel(db, channelId, payload)
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(updated)
  })

  // DELETE /channels/:channelId — Delete a channel
  app.delete('/channels/:channelId', (c) => {
    const { channelId } = c.req.param()
    const deleted = deleteChannel(db, channelId)
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(deleted)
  })

  // GET /channels/:channelId/messages — List messages
  app.get('/channels/:channelId/messages', (c) => {
    const { channelId } = c.req.param()
    const channel = getChannel(db, channelId)
    if (!channel) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }

    const limit = Number.parseInt(c.req.query('limit') ?? '50', 10)
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

  // ――― New pin API (used by discord.py 2.7+) ――――――――――――――――――――――――――
  // Note: must be defined BEFORE GET /channels/:cid/messages/:mid.
  //   If defined after, "pins" would be interpreted as a message ID.
  // GET /channels/:channelId/messages/pins — List pinned messages (new API format)
  // → discord.py 2.7+ / new Discord API format:
  //   {"items":[{"pinned_at":ISO8601,"message":{...}}],"has_more":false}
  //   The legacy endpoint GET /channels/:cid/pins still returns a flat array
  app.get('/channels/:channelId/messages/pins', (c) => {
    const { channelId } = c.req.param()
    const pins = getPinnedMessages(db, channelId, baseUrl)
    // Fetch pinned-at timestamps from the pins table
    const pinRows = db
      .prepare(
        'SELECT message_id, pinned_at FROM pins WHERE channel_id = ? ORDER BY pinned_at ASC'
      )
      .all(channelId) as { message_id: string; pinned_at: string }[]

    const pinnedAtMap = new Map(pinRows.map((r) => [r.message_id, r.pinned_at]))
    return c.json({
      items: pins.map((msg) => ({
        pinned_at: new Date(
          pinnedAtMap.get(msg.id) ?? msg.timestamp
        ).toISOString(),
        message: msg,
      })),
      has_more: false,
    })
  })

  // PUT /channels/:channelId/messages/pins/:messageId (new-format pin)
  app.put('/channels/:channelId/messages/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    const result = pinMessage(db, channelId, messageId)

    switch (result) {
      case 10_008: {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_MESSAGE,
          'Unknown Message',
          404
        )
        return c.json(err.body, 404)
      }
      case 40_041: {
        const err = discordError(
          DiscordErrorCode.ALREADY_PINNED,
          'This message was already pinned',
          400
        )
        return c.json(err.body, 400)
      }
      case 30_003: {
        const err = discordError(
          DiscordErrorCode.MAX_PINS_REACHED,
          'Maximum number of pins reached for the channel (50)',
          400
        )
        return c.json(err.body, 400)
      }
      case 50_019: {
        const err = discordError(
          DiscordErrorCode.WRONG_PIN_CHANNEL,
          'A message can only be pinned to the channel it was sent in',
          403
        )
        return c.json(err.body, 403)
      }
      default: {
        return c.body(null, 204)
      }
    }
  })

  // DELETE /channels/:channelId/messages/pins/:messageId (new-format unpin)
  app.delete('/channels/:channelId/messages/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    unpinMessage(db, channelId, messageId)
    return c.body(null, 204)
  })
  // ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――

  // GET /channels/:channelId/messages/:messageId — Retrieve a specific message
  app.get('/channels/:channelId/messages/:messageId', (c) => {
    const { messageId } = c.req.param()
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

  // POST /channels/:channelId/messages — Send a message
  app.post('/channels/:channelId/messages', async (c) => {
    const { channelId } = c.req.param()

    const channel = getChannel(db, channelId)
    if (!channel) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }

    let bot = c.get('bot')
    // If the auth middleware was not applied, look up the bot from the Authorization header
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
    const attachmentFiles: { name: string; data: ArrayBuffer; type: string }[] =
      []

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      const payloadJson = formData.get('payload_json')
      payload = payloadJson
        ? (JSON.parse(payloadJson as string) as Record<string, unknown>)
        : {}

      // Handle file attachments
      for (let i = 0; i < 10; i++) {
        const file = formData.get(`files[${i}]`) as File | null
        if (!file) break
        // File size check (25MB)
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

    // Save attachments (simplified implementation - actual file saving is skipped in in-memory environments)
    if (attachmentFiles.length > 0) {
      try {
        const { saveAttachment } = await import('../services/attachments.js')
        for (const f of attachmentFiles) {
          // Assign a unique Snowflake ID to each attachment (sequential numbers would cause PRIMARY KEY collisions)
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
      } catch {
        // Ignore if the upload directory does not exist
      }
    }

    return c.json(msg)
  })

  // PATCH /channels/:channelId/messages/:messageId — Edit a message
  app.patch('/channels/:channelId/messages/:messageId', async (c) => {
    const { messageId } = c.req.param()
    const bot = c.get('bot')

    const existing = getMessage(db, messageId, baseUrl)
    if (!existing) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
        404
      )
      return c.json(err.body, 404)
    }

    // Only the author's own messages can be edited
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

    // Validation
    const errors = validateMessageCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const updated = updateMessage(db, messageId, payload, baseUrl)
    return c.json(updated)
  })

  // DELETE /channels/:channelId/messages/:messageId — Delete a message
  app.delete('/channels/:channelId/messages/:messageId', (c) => {
    const { messageId } = c.req.param()
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

  // POST /channels/:channelId/messages/bulk-delete — Bulk delete messages
  app.post('/channels/:channelId/messages/bulk-delete', async (c) => {
    c.req.param() // The channel ID exists as a route parameter but is not used in this handler

    // JSON.parse converts 19-digit Snowflake integers to floating point and loses precision (JavaScript behavior).
    // Libraries like discord.py send Snowflakes as numbers, so extract them from the raw text with a regex to preserve precision.
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

    // Check that no message is older than 2 weeks
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
      deleteMessage(db, msgId)
    }

    return c.body(null, 204)
  })

  // PUT /channels/:channelId/messages/:messageId/reactions/:emoji/@me — Add own reaction
  app.put(
    '/channels/:channelId/messages/:messageId/reactions/:emoji/@me',
    (c) => {
      const { messageId, emoji } = c.req.param()
      const bot = c.get('bot')
      const userId = bot?.user_id ?? '000000000000000000'
      const decodedEmoji = decodeURIComponent(emoji)

      const msg = getMessage(db, messageId, baseUrl)
      if (!msg) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_MESSAGE,
          'Unknown Message',
          404
        )
        return c.json(err.body, 404)
      }

      addReaction(db, messageId, userId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/@me — Remove own reaction
  app.delete(
    '/channels/:channelId/messages/:messageId/reactions/:emoji/@me',
    (c) => {
      const { messageId, emoji } = c.req.param()
      const bot = c.get('bot')
      const userId = bot?.user_id ?? '000000000000000000'
      const decodedEmoji = decodeURIComponent(emoji)

      removeReaction(db, messageId, userId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/:userId — Remove a specific user's reaction
  app.delete(
    '/channels/:channelId/messages/:messageId/reactions/:emoji/:userId',
    (c) => {
      const { messageId, emoji, userId } = c.req.param()
      const decodedEmoji = decodeURIComponent(emoji)

      removeReaction(db, messageId, userId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // GET /channels/:channelId/messages/:messageId/reactions/:emoji — List users who reacted
  app.get('/channels/:channelId/messages/:messageId/reactions/:emoji', (c) => {
    const { messageId, emoji } = c.req.param()
    const decodedEmoji = decodeURIComponent(emoji)
    const limit = Number.parseInt(c.req.query('limit') ?? '25', 10)
    const after = c.req.query('after')

    const users = getReactionUsers(db, messageId, decodedEmoji, limit, after)
    return c.json(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        discriminator: u.discriminator,
        avatar: u.avatar,
        bot: u.bot === 1,
      }))
    )
  })

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji — Remove all reactions for an emoji
  app.delete(
    '/channels/:channelId/messages/:messageId/reactions/:emoji',
    (c) => {
      const { messageId, emoji } = c.req.param()
      const decodedEmoji = decodeURIComponent(emoji)
      removeEmojiReactions(db, messageId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // DELETE /channels/:channelId/messages/:messageId/reactions — Remove all reactions from a message
  app.delete('/channels/:channelId/messages/:messageId/reactions', (c) => {
    const { messageId } = c.req.param()
    removeAllReactions(db, messageId)
    return c.body(null, 204)
  })

  // GET /channels/:channelId/pins — List pinned messages (legacy API format)
  app.get('/channels/:channelId/pins', (c) => {
    const { channelId } = c.req.param()
    const pins = getPinnedMessages(db, channelId, baseUrl)
    return c.json(pins)
  })

  // PUT /channels/:channelId/pins/:messageId — Pin a message (legacy API format)
  app.put('/channels/:channelId/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    const result = pinMessage(db, channelId, messageId)

    switch (result) {
      case 10_008: {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_MESSAGE,
          'Unknown Message',
          404
        )
        return c.json(err.body, 404)
      }
      case 40_041: {
        const err = discordError(
          DiscordErrorCode.ALREADY_PINNED,
          'This message was already pinned',
          400
        )
        return c.json(err.body, 400)
      }
      case 30_003: {
        const err = discordError(
          DiscordErrorCode.MAX_PINS_REACHED,
          'Maximum number of pins reached for the channel (50)',
          400
        )
        return c.json(err.body, 400)
      }
      case 50_019: {
        const err = discordError(
          DiscordErrorCode.WRONG_PIN_CHANNEL,
          'A message can only be pinned to the channel it was sent in',
          403
        )
        return c.json(err.body, 403)
      }
      default: {
        return c.body(null, 204)
      }
    }
  })

  // DELETE /channels/:channelId/pins/:messageId — Unpin a message (legacy API format)
  app.delete('/channels/:channelId/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    unpinMessage(db, channelId, messageId)
    return c.body(null, 204)
  })

  // GET /channels/:channelId/webhooks — List webhooks for a channel
  app.get('/channels/:channelId/webhooks', (c) => {
    const { channelId } = c.req.param()
    const webhooks = getChannelWebhooks(db, channelId)
    return c.json(webhooks)
  })

  // POST /channels/:channelId/webhooks — Create a webhook
  app.post('/channels/:channelId/webhooks', async (c) => {
    const { channelId } = c.req.param()

    // Verify the channel exists
    const channel = getChannel(db, channelId)
    if (!channel) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }

    // Webhook limit check (15 per channel)
    const existingWebhooks = getChannelWebhooks(db, channelId)
    if (existingWebhooks.length >= WEBHOOK_LIMITS.CHANNEL_WEBHOOKS_MAX) {
      const err = discordError(
        DiscordErrorCode.MAX_WEBHOOKS_REACHED,
        'Maximum number of webhooks reached (15)',
        400
      )
      return c.json(err.body, 400)
    }

    const payload = await c.req.json<{ name: string; avatar?: string | null }>()

    // Validation
    const errors = validateWebhookCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const webhookId = generateSnowflake()
    const webhookToken = generateSnowflake() + generateSnowflake()

    const webhook = createWebhook(db, {
      webhookId,
      channelId,
      guildId: channel.guild_id,
      name: payload.name,
      avatar: payload.avatar,
      token: webhookToken,
    })

    return c.json(webhook)
  })

  return app
}
