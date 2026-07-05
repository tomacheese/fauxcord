// src/services/guilds.ts
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
  splash: string | null
  discovery_splash: string | null
  banner: string | null
  home_header: string | null
  owner_id: string
  region: string
  afk_channel_id: string | null
  afk_timeout: number
  widget_enabled: boolean
  widget_channel_id: string | null
  verification_level: number
  default_message_notifications: number
  explicit_content_filter: number
  roles: RoleObject[]
  emojis: never[]
  features: never[]
  mfa_level: number
  application_id: string | null
  system_channel_id: null
  system_channel_flags: number
  rules_channel_id: string | null
  public_updates_channel_id: string | null
  safety_alerts_channel_id: string | null
  max_presences: number | null
  max_members: number
  max_video_channel_users: number
  max_stage_video_channel_users: number
  vanity_url_code: string | null
  description: string | null
  premium_tier: number
  premium_subscription_count: number
  premium_progress_bar_enabled: boolean
  preferred_locale: string
  nsfw: boolean
  nsfw_level: number
  stickers: never[]
  incidents_data: null
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
  // Fields not backed by the mock's DB are populated with Discord's documented
  // default/empty values so the object satisfies the spec-required GuildResponse
  // shape (strict deserializers such as serenity's PartialGuild reject a guild
  // object missing any spec-required field).
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    splash: null,
    discovery_splash: null,
    banner: null,
    home_header: null,
    owner_id: row.owner_id,
    region: 'deprecated',
    afk_channel_id: null,
    afk_timeout: 300,
    widget_enabled: false,
    widget_channel_id: null,
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
    public_updates_channel_id: null,
    safety_alerts_channel_id: null,
    max_presences: null,
    max_members: 500_000,
    max_video_channel_users: 25,
    max_stage_video_channel_users: 50,
    vanity_url_code: null,
    description: null,
    premium_tier: row.premium_tier,
    premium_subscription_count: 0,
    premium_progress_bar_enabled: false,
    preferred_locale: row.preferred_locale,
    nsfw: false,
    nsfw_level: 0,
    stickers: [],
    incidents_data: null,
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
