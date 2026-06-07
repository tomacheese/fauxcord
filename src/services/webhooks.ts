/**
 * Webhook操作サービス
 *
 * WebhookのCRUD操作・実行を提供します。
 */

import type { Database } from '../db.js'
import type { MessageObject } from './messages.js'
import { createMessage } from './messages.js'

/** DBから取得したWebhookレコードの型 */
interface WebhookRow {
  id: string
  type: number
  guild_id: string | null
  channel_id: string
  name: string
  avatar: string | null
  token: string
}

/** APIレスポンス用Webhookオブジェクト */
export interface WebhookObject {
  id: string
  type: number
  guild_id: string | null
  channel_id: string
  name: string
  avatar: string | null
  token: string
}

/**
 * DBのWebhookレコードをAPIレスポンス形式に変換します。
 * @param row - DBレコード
 * @returns APIレスポンス用オブジェクト
 */
function toWebhookObject(row: WebhookRow): WebhookObject {
  return {
    id: row.id,
    type: row.type,
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    name: row.name,
    avatar: row.avatar,
    token: row.token,
  }
}

/**
 * WebhookをIDで取得します。
 * @param db - データベース
 * @param webhookId - Webhook ID
 * @returns WebhookオブジェクトまたはNull
 */
export function getWebhook(
  db: Database,
  webhookId: string
): WebhookObject | null {
  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow | undefined
  return row ? toWebhookObject(row) : null
}

/**
 * Webhook IDとTokenでWebhookを取得します。
 * @param db - データベース
 * @param webhookId - Webhook ID
 * @param token - Webhookトークン
 * @returns WebhookオブジェクトまたはNull
 */
export function getWebhookByToken(
  db: Database,
  webhookId: string,
  token: string
): WebhookObject | null {
  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ? AND token = ?')
    .get(webhookId, token) as WebhookRow | undefined
  return row ? toWebhookObject(row) : null
}

/**
 * チャンネルのWebhook一覧を取得します。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @returns Webhookオブジェクトの配列
 */
export function getChannelWebhooks(
  db: Database,
  channelId: string
): WebhookObject[] {
  const rows = db
    .prepare('SELECT * FROM webhooks WHERE channel_id = ?')
    .all(channelId) as WebhookRow[]
  return rows.map((row) => toWebhookObject(row))
}

/**
 * GuildのWebhook一覧を取得します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @returns Webhookオブジェクトの配列
 */
export function getGuildWebhooks(
  db: Database,
  guildId: string
): WebhookObject[] {
  const rows = db
    .prepare('SELECT * FROM webhooks WHERE guild_id = ?')
    .all(guildId) as WebhookRow[]
  return rows.map((row) => toWebhookObject(row))
}

/** Webhook作成パラメータ */
export interface WebhookCreateParams {
  webhookId: string
  channelId: string
  guildId: string | null
  name: string
  avatar?: string | null
  token: string
}

/**
 * Webhookを作成します。
 * @param db - データベース
 * @param params - Webhook作成パラメータ
 * @returns 作成したWebhookオブジェクト
 */
export function createWebhook(
  db: Database,
  params: WebhookCreateParams
): WebhookObject {
  db.prepare(
    'INSERT INTO webhooks (id, guild_id, channel_id, name, avatar, token) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    params.webhookId,
    params.guildId,
    params.channelId,
    params.name,
    params.avatar ?? null,
    params.token
  )

  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(params.webhookId) as WebhookRow
  return toWebhookObject(row)
}

/**
 * Webhookを更新します。
 * @param db - データベース
 * @param webhookId - Webhook ID
 * @param payload - 更新内容（avatarはnullでクリア）
 * @returns 更新後のWebhookオブジェクトまたはNull
 */
export function updateWebhook(
  db: Database,
  webhookId: string,
  payload: { name?: string; avatar?: string | null; channel_id?: string }
): WebhookObject | null {
  const current = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow | undefined
  if (!current) return null

  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) updates.name = payload.name
  if (payload.avatar !== undefined) updates.avatar = payload.avatar
  if (payload.channel_id !== undefined) {
    updates.channel_id = payload.channel_id
    // Guild IDも更新
    const channel = db
      .prepare('SELECT guild_id FROM channels WHERE id = ?')
      .get(payload.channel_id) as { guild_id: string | null } | undefined
    if (channel) updates.guild_id = channel.guild_id
  }

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(', ')
    db.prepare(`UPDATE webhooks SET ${setClauses} WHERE id = ?`).run(
      ...Object.values(updates),
      webhookId
    )
  }

  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow
  return toWebhookObject(row)
}

/**
 * Webhookを削除します。
 * @param db - データベース
 * @param webhookId - Webhook ID
 * @returns 削除成功ならtrue
 */
export function deleteWebhook(db: Database, webhookId: string): boolean {
  const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(webhookId)
  return result.changes > 0
}

/** Webhook実行パラメータ */
export interface WebhookExecuteParams {
  messageId: string
  channelId: string
  /** Webhook ID（メッセージのauthor.id / webhook_idとして使用） */
  webhookId: string
  /** Webhook名（usernameオーバーライドがない場合のデフォルト表示名） */
  webhookName?: string
  content?: string
  username?: string
  tts?: boolean
  embeds?: unknown[]
}

/**
 * Webhookを実行してメッセージを送信します。
 * @param db - データベース
 * @param params - Webhook実行パラメータ
 * @param baseUrl - ベースURL
 * @returns 作成したメッセージオブジェクト
 */
export function executeWebhook(
  db: Database,
  params: WebhookExecuteParams,
  baseUrl: string
): MessageObject {
  // 実Discordと同様に、Webhook IDをauthor.idとして使用する
  const webhookUserId = params.webhookId
  const username = params.username ?? params.webhookName ?? 'Webhook'

  // ユーザーが存在しない場合は作成（Webhookユーザーのdiscriminatorは'0000'）
  const existingUser = db
    .prepare('SELECT id FROM users WHERE id = ?')
    .get(webhookUserId)
  if (existingUser) {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(
      username,
      webhookUserId
    )
  } else {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, ?, '0000', 1)"
    ).run(webhookUserId, username)
  }

  return createMessage(
    db,
    {
      messageId: params.messageId,
      channelId: params.channelId,
      authorId: webhookUserId,
      authorToken: 'webhook',
      content: params.content,
      tts: params.tts,
      embeds: params.embeds,
    },
    baseUrl
  )
}
