// src/services/guilds.ts
/**
 * Guild core operations service
 *
 * Provides CRUD operations for the guild entity itself. Role and member
 * operations live in `guild-roles.ts` and `guild-members.ts`.
 */

import type { Database } from '../db.js'
import { getGuildRoles, type RoleObject } from './guild-roles.js'

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
  region: string
  afk_channel_id: null
  afk_timeout: number
  verification_level: number
  default_message_notifications: number
  explicit_content_filter: number
  roles: RoleObject[]
  emojis: unknown[]
  features: string[]
  mfa_level: number
  application_id: null
  system_channel_id: null
  system_channel_flags: number
  rules_channel_id: null
  vanity_url_code: null
  description: null
  banner: null
  premium_tier: number
  premium_subscription_count: number
  preferred_locale: string
  public_updates_channel_id: null
  nsfw_level: number
  stickers: unknown[]
  premium_progress_bar_enabled: boolean
  safety_alerts_channel_id: null
  approximate_member_count?: number
  approximate_presence_count?: number
}

/**
 * Converts a DB guild record into the API response format.
 * @param row - DB record
 * @param roles - Guild's role list
 * @returns Object for API responses
 */
function toGuildObject(row: GuildRow, roles: RoleObject[]): GuildObject {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    owner_id: row.owner_id,
    region: 'us-east',
    afk_channel_id: null,
    afk_timeout: 300,
    verification_level: row.verification_level,
    default_message_notifications: row.default_message_notifications,
    explicit_content_filter: row.explicit_content_filter,
    roles,
    emojis: [],
    features: [],
    mfa_level: 0,
    application_id: null,
    system_channel_id: null,
    system_channel_flags: 0,
    rules_channel_id: null,
    vanity_url_code: null,
    description: null,
    banner: null,
    premium_tier: row.premium_tier,
    premium_subscription_count: 0,
    preferred_locale: row.preferred_locale,
    public_updates_channel_id: null,
    nsfw_level: 0,
    stickers: [],
    premium_progress_bar_enabled: false,
    safety_alerts_channel_id: null,
  }
}

/**
 * Retrieves a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param withCounts - Whether to include approximate member/presence counts
 * @returns Guild object, or null
 */
export function getGuild(
  db: Database,
  guildId: string,
  withCounts = false
): GuildObject | null {
  const row = db
    .prepare('SELECT * FROM guilds WHERE id = ?')
    .get(guildId) as GuildRow | undefined
  if (!row) return null

  const guild = toGuildObject(row, getGuildRoles(db, guildId))

  if (withCounts) {
    const memberCount = (
      db
        .prepare(
          'SELECT COUNT(*) as cnt FROM guild_members WHERE guild_id = ?'
        )
        .get(guildId) as { cnt: number }
    ).cnt
    guild.approximate_member_count = memberCount
    guild.approximate_presence_count = memberCount
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
