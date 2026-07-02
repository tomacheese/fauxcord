/**
 * Channel operations service
 *
 * Provides CRUD operations for channels.
 */

import type { Database } from '../db.js'
// Used for compile-time type drift detection.
import type { APIGuildTextChannel } from 'discord-api-types/v10'
import type { ChannelType } from 'discord-api-types/v10'
import { generateSnowflake } from '../snowflake.js'

/**
 * Compile-time guard: ensures the safe-field subset of ChannelObject is
 * structurally compatible with APIGuildTextChannel.
 * Fails to compile when discord-api-types renames or retypes these fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ChannelCompatGuard =
  Pick<
    APIGuildTextChannel<ChannelType.GuildText>,
    'id' | 'guild_id' | 'position' | 'name' | 'flags'
  > extends Pick<
    ChannelObject,
    'id' | 'guild_id' | 'position' | 'name' | 'flags'
  >
    ? true
    : never

/** Channel record type retrieved from the DB */
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

/** Channel object for API responses */
export interface ChannelObject {
  id: string
  type: number
  /** Channel flags bitset (always 0 in the mock) */
  flags: number
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
 * Converts a DB channel record into the API response format.
 * @param row - DB record
 * @returns Object for API responses
 */
function toChannelObject(row: ChannelRow): ChannelObject {
  return {
    id: row.id,
    type: row.type,
    flags: 0,
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
 * Retrieves a channel by ID.
 * @param db - Database
 * @param channelId - Channel ID
 * @returns Channel object, or null if it does not exist
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

/** Channel update request type */
export interface ChannelUpdatePayload {
  name?: string
  topic?: string | null
  nsfw?: boolean
  rate_limit_per_user?: number
  position?: number
}

/**
 * Updates channel information.
 * @param db - Database
 * @param channelId - Channel ID
 * @param payload - Update payload
 * @returns Updated channel object, or null if it does not exist
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
 * Deletes a channel.
 * @param db - Database
 * @param channelId - Channel ID
 * @returns Deleted channel object, or null if it does not exist
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
 * Retrieves the list of channels in a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @returns Array of channel objects
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

/** Guild channel creation parameters */
export interface GuildChannelCreateParams {
  guildId: string
  name: string
  type?: number
  topic?: string | null
  nsfw?: boolean
  parentId?: string | null
  position: number
}

/**
 * Creates a channel within a guild.
 * @param db - Database
 * @param params - Channel creation parameters
 * @returns Created channel object
 */
export function createGuildChannel(
  db: Database,
  params: GuildChannelCreateParams
): ChannelObject {
  const channelId = generateSnowflake()
  db.prepare(
    `INSERT INTO channels (id, guild_id, name, type, topic, nsfw, position, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    channelId,
    params.guildId,
    params.name,
    params.type ?? 0,
    params.topic ?? null,
    params.nsfw ? 1 : 0,
    params.position,
    params.parentId ?? null
  )

  const row = db
    .prepare('SELECT * FROM channels WHERE id = ?')
    .get(channelId) as ChannelRow
  return toChannelObject(row)
}
