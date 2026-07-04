/**
 * Guild core operations service
 *
 * Provides CRUD operations for the guild entity itself. Role and member
 * operations live in `guild-roles.ts` and `guild-members.ts`.
 */

import type { Database } from '../db'
import { getGuildRoles, type RoleObject } from './guild-roles'

/** Guild record type retrieved from the DB */
interface GuildRow {
  id: string
  name: string
  icon: string | null
  owner_id: string
  bot_token: string
  verification_level: number
  default_message_notifications: number
  explicit_content_filter: number
  premium_tier: number
  preferred_locale: string
}

/** Guild object for API responses */
export interface GuildObject {
  id: string
  name: string
  icon: string | null
  owner_id: string
  afk_timeout: number
  verification_level: number
  default_message_notifications: number
  explicit_content_filter: number
  roles: RoleObject[]
  emojis: never[]
  features: never[]
  mfa_level: number
  system_channel_id: null
  premium_tier: number
  premium_subscription_count: number
  preferred_locale: string
  channels?: unknown[]
  approximate_member_count?: number
}

/**
 * Converts a DB guild record into the API response format.
 * @param row - DB record
 * @param roles - Array of role objects
 * @returns Object for API responses
 */
function toGuildObject(row: GuildRow, roles: RoleObject[]): GuildObject {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    owner_id: row.owner_id,
    afk_timeout: 300,
    verification_level: row.verification_level,
    default_message_notifications: row.default_message_notifications,
    explicit_content_filter: row.explicit_content_filter,
    roles,
    emojis: [],
    features: [],
    mfa_level: 0,
    system_channel_id: null,
    premium_tier: row.premium_tier,
    premium_subscription_count: 0,
    preferred_locale: row.preferred_locale,
  }
}

/**
 * Retrieves a guild by ID.
 * @param db - Database
 * @param guildId - Guild ID
 * @param withCounts - Whether to include approximate_member_count
 * @returns Guild object, or null
 */
export function getGuild(
  db: Database,
  guildId: string,
  withCounts = false
): GuildObject | null {
  const row = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId) as
    | GuildRow
    | undefined
  if (!row) return null

  const guild = toGuildObject(row, getGuildRoles(db, guildId))

  if (withCounts) {
    const memberCount = (
      db
        .prepare('SELECT COUNT(*) as cnt FROM guild_members WHERE guild_id = ?')
        .get(guildId) as { cnt: number }
    ).cnt
    guild.approximate_member_count = memberCount
  }

  return guild
}

/** Guild update parameters */
export interface GuildUpdateParams {
  name?: string
}

/**
 * Updates a guild's information.
 * @param db - Database
 * @param guildId - Guild ID
 * @param payload - Update payload
 * @returns Updated guild object, or null
 */
export function updateGuild(
  db: Database,
  guildId: string,
  payload: GuildUpdateParams
): GuildObject | null {
  const current = db
    .prepare('SELECT * FROM guilds WHERE id = ?')
    .get(guildId) as GuildRow | undefined
  if (!current) return null

  if (payload.name !== undefined) {
    db.prepare('UPDATE guilds SET name = ? WHERE id = ?').run(
      payload.name,
      guildId
    )
  }

  return getGuild(db, guildId)
}

/**
 * Deletes a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @returns true on successful deletion
 */
export function deleteGuild(db: Database, guildId: string): boolean {
  const result = db.prepare('DELETE FROM guilds WHERE id = ?').run(guildId)
  return result.changes > 0
}

/**
 * Retrieves the list of guilds a Bot belongs to.
 * @param db - Database
 * @param botToken - Bot token
 * @returns Array of simplified guild objects (as returned by
 * `GET /users/@me/guilds`)
 */
export function getBotGuilds(
  db: Database,
  botToken: string
): {
  id: string
  name: string
  icon: string | null
  /** Guild banner hash (always null in the mock) */
  banner: string | null
  owner: boolean
  permissions: string
  features: string[]
}[] {
  const rows = db
    .prepare('SELECT * FROM guilds WHERE bot_token = ?')
    .all(botToken) as GuildRow[]

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    banner: null,
    owner: false,
    permissions: '0',
    features: [],
  }))
}
