/**
 * チャンネル操作サービス
 *
 * チャンネルのCRUD操作を提供します。
 */

import type { Database } from '../db.js'

/** DBから取得したチャンネルレコードの型 */
interface ChannelRow {
  id: string
  guild_id: string | null
  type: number
  name: string | null
  topic: string | null
  nsfw: number
  position: number
  rate_limit_per_user: number
  parent_id: string | null
  last_message_id: string | null
}

/** API レスポンス用チャンネルオブジェクト */
export interface ChannelObject {
  id: string
  type: number
  guild_id: string | null
  position: number
  name: string | null
  topic: string | null
  nsfw: boolean
  last_message_id: string | null
  rate_limit_per_user: number
  parent_id: string | null
  permission_overwrites: never[]
}

/**
 * DBのチャンネルレコードをAPIレスポンス形式に変換します。
 * @param row - DBレコード
 * @returns APIレスポンス用オブジェクト
 */
function toChannelObject(row: ChannelRow): ChannelObject {
  return {
    id: row.id,
    type: row.type,
    guild_id: row.guild_id,
    position: row.position,
    name: row.name,
    topic: row.topic,
    nsfw: row.nsfw === 1,
    last_message_id: row.last_message_id,
    rate_limit_per_user: row.rate_limit_per_user,
    parent_id: row.parent_id,
    permission_overwrites: [],
  }
}

/**
 * チャンネルをIDで取得します。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @returns チャンネルオブジェクト（存在しない場合null）
 */
export function getChannel(
  db: Database,
  channelId: string
): ChannelObject | null {
  const row = db
    .prepare('SELECT * FROM channels WHERE id = ?')
    .get(channelId) as ChannelRow | undefined
  return row ? toChannelObject(row) : null
}

/** チャンネル更新リクエストの型 */
export interface ChannelUpdatePayload {
  name?: string
  topic?: string | null
  nsfw?: boolean
  rate_limit_per_user?: number
  position?: number
}

/**
 * チャンネル情報を更新します。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @param payload - 更新内容
 * @returns 更新後のチャンネルオブジェクト（存在しない場合null）
 */
export function updateChannel(
  db: Database,
  channelId: string,
  payload: ChannelUpdatePayload
): ChannelObject | null {
  const current = db
    .prepare('SELECT * FROM channels WHERE id = ?')
    .get(channelId) as ChannelRow | undefined
  if (!current) return null

  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) updates.name = payload.name
  if (payload.topic !== undefined) updates.topic = payload.topic
  if (payload.nsfw !== undefined) updates.nsfw = payload.nsfw ? 1 : 0
  if (payload.rate_limit_per_user !== undefined)
    updates.rate_limit_per_user = payload.rate_limit_per_user
  if (payload.position !== undefined) updates.position = payload.position

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(', ')
    db.prepare(`UPDATE channels SET ${setClauses} WHERE id = ?`).run(
      ...Object.values(updates),
      channelId
    )
  }

  const updated = db
    .prepare('SELECT * FROM channels WHERE id = ?')
    .get(channelId) as ChannelRow
  return toChannelObject(updated)
}

/**
 * チャンネルを削除します。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @returns 削除したチャンネルオブジェクト（存在しない場合null）
 */
export function deleteChannel(
  db: Database,
  channelId: string
): ChannelObject | null {
  const row = db
    .prepare('SELECT * FROM channels WHERE id = ?')
    .get(channelId) as ChannelRow | undefined
  if (!row) return null

  db.prepare('DELETE FROM channels WHERE id = ?').run(channelId)
  return toChannelObject(row)
}

/**
 * Guildのチャンネル一覧を取得します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @returns チャンネルオブジェクトの配列
 */
export function getGuildChannels(
  db: Database,
  guildId: string
): ChannelObject[] {
  const rows = db
    .prepare('SELECT * FROM channels WHERE guild_id = ? ORDER BY position, id')
    .all(guildId) as ChannelRow[]
  return rows.map((row) => toChannelObject(row))
}
