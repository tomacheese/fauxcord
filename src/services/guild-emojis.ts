/**
 * Guild emoji operations service
 *
 * Provides CRUD operations for guild custom emojis.
 */

import type { Database } from '../database'
import { getUser, type UserObject } from './users'
// Used for compile-time type drift detection.
import type { APIEmoji } from 'discord-api-types/v10'

/**
 * Compile-time guard: ensures the safe-field subset of EmojiObject is
 * structurally compatible with APIEmoji.
 * Fails to compile when discord-api-types renames or retypes these fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _EmojiCompatGuard =
  Pick<
    APIEmoji,
    'id' | 'name' | 'managed' | 'animated' | 'available'
  > extends Pick<
    EmojiObject,
    'id' | 'name' | 'managed' | 'animated' | 'available'
  >
    ? true
    : never

/** Emoji record type retrieved from the DB */
interface EmojiRow {
  id: string
  guild_id: string
  name: string
  user_id: string | null
  roles: string
}

/** Emoji object for API responses (conforms to the spec EmojiResponse) */
export interface EmojiObject {
  id: string
  name: string
  user?: UserObject
  roles: string[]
  require_colons: boolean
  managed: boolean
  animated: boolean
  available: boolean
}

/**
 * Converts a DB emoji record into the API response format.
 * @param database - Database
 * @param row - DB record
 * @returns Object for API responses
 */
function toEmojiObject(database: Database, row: EmojiRow): EmojiObject {
  const roles = JSON.parse(row.roles) as string[]
  const emoji: EmojiObject = {
    id: row.id,
    name: row.name,
    roles,
    require_colons: true,
    managed: false,
    animated: false,
    available: true,
  }
  if (row.user_id) {
    const user = getUser(database, row.user_id)
    if (user) emoji.user = user
  }
  return emoji
}

/**
 * Retrieves the list of emojis for a guild, ordered by creation time.
 * @param database - Database
 * @param guildId - Guild ID
 * @returns Array of emoji objects
 */
export function getGuildEmojis(
  database: Database,
  guildId: string
): EmojiObject[] {
  const rows = database
    .prepare('SELECT * FROM emojis WHERE guild_id = ? ORDER BY created_at, id')
    .all(guildId) as EmojiRow[]
  return rows.map((row) => toEmojiObject(database, row))
}

/**
 * Retrieves an emoji by ID within a guild.
 * @param database - Database
 * @param guildId - Guild ID
 * @param emojiId - Emoji ID
 * @returns Emoji object, or null
 */
export function getEmoji(
  database: Database,
  guildId: string,
  emojiId: string
): EmojiObject | null {
  const row = database
    .prepare('SELECT * FROM emojis WHERE id = ? AND guild_id = ?')
    .get(emojiId, guildId) as EmojiRow | undefined
  return row ? toEmojiObject(database, row) : null
}

/** Emoji creation parameters */
export interface EmojiCreateParameters {
  emojiId: string
  guildId: string
  name: string
  userId: string | null
  roles?: string[] | null
}

/**
 * Creates an emoji in a guild.
 * @param database - Database
 * @param parameters - Emoji creation parameters
 * @returns Created emoji object
 */
export function createEmoji(
  database: Database,
  parameters: EmojiCreateParameters
): EmojiObject {
  database
    .prepare(
      'INSERT INTO emojis (id, guild_id, name, user_id, roles) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      parameters.emojiId,
      parameters.guildId,
      parameters.name,
      parameters.userId,
      JSON.stringify(parameters.roles ?? [])
    )
  const row = database
    .prepare('SELECT * FROM emojis WHERE id = ?')
    .get(parameters.emojiId) as EmojiRow
  return toEmojiObject(database, row)
}

/** Emoji update parameters */
export interface EmojiUpdateParameters {
  name?: string
  roles?: string[]
}

/**
 * Updates an emoji's information.
 * @param database - Database
 * @param guildId - Guild ID
 * @param emojiId - Emoji ID
 * @param payload - Update payload
 * @returns Updated emoji object, or null
 */
export function updateEmoji(
  database: Database,
  guildId: string,
  emojiId: string,
  payload: EmojiUpdateParameters
): EmojiObject | null {
  const current = database
    .prepare('SELECT * FROM emojis WHERE id = ? AND guild_id = ?')
    .get(emojiId, guildId) as EmojiRow | undefined
  if (!current) return null

  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) updates.name = payload.name
  if (payload.roles !== undefined) {
    updates.roles = JSON.stringify(payload.roles)
  }

  if (Object.keys(updates).length > 0) {
    const assignmentClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(', ')
    database
      .prepare(`UPDATE emojis SET ${assignmentClauses} WHERE id = ?`)
      .run(...Object.values(updates), emojiId)
  }

  const row = database
    .prepare('SELECT * FROM emojis WHERE id = ?')
    .get(emojiId) as EmojiRow
  return toEmojiObject(database, row)
}

/**
 * Deletes an emoji.
 * @param database - Database
 * @param guildId - Guild ID
 * @param emojiId - Emoji ID
 * @returns true on successful deletion
 */
export function didDeleteEmoji(
  database: Database,
  guildId: string,
  emojiId: string
): boolean {
  const result = database
    .prepare('DELETE FROM emojis WHERE id = ? AND guild_id = ?')
    .run(emojiId, guildId)
  return result.changes > 0
}
