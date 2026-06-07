/**
 * Channels API ルーティング
 *
 * /channels/* エンドポイントを実装します。
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
 * Channels APIルートを作成します。
 * @param db - データベース
 * @param baseUrl - ベースURL
 * @returns Honoルーターインスタンス
 */
export function createChannelRoutes(
  db: Database,
  baseUrl: string
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /channels/:channelId
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

  // PATCH /channels/:channelId
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

  // DELETE /channels/:channelId
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

  // GET /channels/:channelId/messages
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

  // ――― 新ピン API（discord.py 2.7+が使用）――――――――――――――――――――――――――
  // ※ 必ず GET /channels/:cid/messages/:mid より先に定義すること。
  //   後に定義すると "pins" がメッセージIDとして解釈されてしまう。
  // GET /channels/:channelId/messages/pins
  // → discord.py 2.7+ / 新 Discord API 形式:
  //   {"items":[{"pinned_at":ISO8601,"message":{...}}],"has_more":false}
  //   旧エンドポイント GET /channels/:cid/pins はフラット配列のまま
  app.get('/channels/:channelId/messages/pins', (c) => {
    const { channelId } = c.req.param()
    const pins = getPinnedMessages(db, channelId, baseUrl)
    // ピン留め日時を pins テーブルから取得
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

  // PUT /channels/:channelId/messages/pins/:messageId（新形式ピン留め）
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

  // DELETE /channels/:channelId/messages/pins/:messageId（新形式ピン解除）
  app.delete('/channels/:channelId/messages/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    unpinMessage(db, channelId, messageId)
    return c.body(null, 204)
  })
  // ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――

  // GET /channels/:channelId/messages/:messageId
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

  // POST /channels/:channelId/messages
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
    // authミドルウェアを経由しない場合、Authorizationヘッダーからbotを取得
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

      // ファイル添付の処理
      for (let i = 0; i < 10; i++) {
        const file = formData.get(`files[${i}]`) as File | null
        if (!file) break
        // ファイルサイズチェック（25MB）
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

    // 空メッセージチェック
    if (isEmptyMessage(payload, hasAttachments)) {
      const err = discordError(
        DiscordErrorCode.EMPTY_MESSAGE,
        'Cannot send an empty message',
        400
      )
      return c.json(err.body, 400)
    }

    // バリデーション
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

    // 添付ファイルの保存（簡略実装 - インメモリ環境では実際のファイル保存はスキップ）
    if (attachmentFiles.length > 0) {
      try {
        const { saveAttachment } = await import('../services/attachments.js')
        for (const [i, f] of attachmentFiles.entries()) {
          await saveAttachment(
            db,
            '/data/uploads',
            baseUrl,
            channelId,
            messageId,
            String(i),
            f.name,
            f.type,
            f.data
          )
        }
      } catch {
        // アップロードディレクトリが存在しない場合は無視
      }
    }

    return c.json(msg)
  })

  // PATCH /channels/:channelId/messages/:messageId
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

    // 自分のメッセージのみ編集可能
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

    // バリデーション
    const errors = validateMessageCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const updated = updateMessage(db, messageId, payload, baseUrl)
    return c.json(updated)
  })

  // DELETE /channels/:channelId/messages/:messageId
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

  // POST /channels/:channelId/messages/bulk-delete
  app.post('/channels/:channelId/messages/bulk-delete', async (c) => {
    c.req.param() // チャンネルIDはルートパラメータとして存在するが、このハンドラでは使用しない

    // JSON.parse は 19 桁の Snowflake 整数を浮動小数点に変換し精度を失う（JavaScript の仕様）。
    // discord.py などは数値型で Snowflake を送るため、生テキストから正規表現で抽出して精度を保持する。
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

    // 2週間以上前のメッセージが含まれていないかチェック
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

  // PUT /channels/:channelId/messages/:messageId/reactions/:emoji/@me
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

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/@me
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

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/:userId
  app.delete(
    '/channels/:channelId/messages/:messageId/reactions/:emoji/:userId',
    (c) => {
      const { messageId, emoji, userId } = c.req.param()
      const decodedEmoji = decodeURIComponent(emoji)

      removeReaction(db, messageId, userId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // GET /channels/:channelId/messages/:messageId/reactions/:emoji
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

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji
  app.delete(
    '/channels/:channelId/messages/:messageId/reactions/:emoji',
    (c) => {
      const { messageId, emoji } = c.req.param()
      const decodedEmoji = decodeURIComponent(emoji)
      removeEmojiReactions(db, messageId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // DELETE /channels/:channelId/messages/:messageId/reactions
  app.delete('/channels/:channelId/messages/:messageId/reactions', (c) => {
    const { messageId } = c.req.param()
    removeAllReactions(db, messageId)
    return c.body(null, 204)
  })

  // GET /channels/:channelId/pins
  app.get('/channels/:channelId/pins', (c) => {
    const { channelId } = c.req.param()
    const pins = getPinnedMessages(db, channelId, baseUrl)
    return c.json(pins)
  })

  // PUT /channels/:channelId/pins/:messageId
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

  // DELETE /channels/:channelId/pins/:messageId
  app.delete('/channels/:channelId/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    unpinMessage(db, channelId, messageId)
    return c.body(null, 204)
  })

  // GET /channels/:channelId/webhooks
  app.get('/channels/:channelId/webhooks', (c) => {
    const { channelId } = c.req.param()
    const webhooks = getChannelWebhooks(db, channelId)
    return c.json(webhooks)
  })

  // POST /channels/:channelId/webhooks
  app.post('/channels/:channelId/webhooks', async (c) => {
    const { channelId } = c.req.param()

    // チャンネルの存在確認
    const channel = getChannel(db, channelId)
    if (!channel) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }

    // Webhook上限チェック（15件/チャンネル）
    const existingWebhooks = getChannelWebhooks(db, channelId)
    if (existingWebhooks.length >= WEBHOOK_LIMITS.NAME_MAX) {
      const err = discordError(
        DiscordErrorCode.MAX_WEBHOOKS_REACHED,
        'Maximum number of webhooks reached (15)',
        400
      )
      return c.json(err.body, 400)
    }

    const payload = await c.req.json<{ name: string; avatar?: string | null }>()

    // バリデーション
    const errors = validateWebhookCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    // Webhook数チェック（チャンネルごと15件）
    const channelWebhookCount = existingWebhooks.length
    if (channelWebhookCount >= 15) {
      const err = discordError(
        DiscordErrorCode.MAX_WEBHOOKS_REACHED,
        'Maximum number of webhooks reached (15)',
        400
      )
      return c.json(err.body, 400)
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
