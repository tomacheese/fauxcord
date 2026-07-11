/**
 * Guild core operations service
 *
 * Provides CRUD operations for the guild entity itself. Role and member
 * operations live in `guild-roles.ts` and `guild-members.ts`.
 */

import type { Database } from '../db'
import { getGuildRoles, type RoleObject } from './guild-roles'
import { getGuildChannels } from './channels'
import { getGuildMembers } from './guild-members'
import { toDiscordTimestamp } from '../timestamp'

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
  description: string | null
  home_header: string | null
  splash: string | null
  discovery_splash: string | null
  banner: string | null
  owner_id: string
  application_id: string | null
  region: string
  afk_channel_id: string | null
  afk_timeout: number
  system_channel_id: string | null
  system_channel_flags: number
  widget_enabled: boolean
  widget_channel_id: string | null
  verification_level: number
  roles: RoleObject[]
  default_message_notifications: number
  mfa_level: number
  explicit_content_filter: number
  max_presences: number | null
  max_members: number
  max_stage_video_channel_users: number
  max_video_channel_users: number
  vanity_url_code: string | null
  premium_tier: number
  premium_subscription_count: number
  preferred_locale: string
  rules_channel_id: string | null
  safety_alerts_channel_id: string | null
  public_updates_channel_id: string | null
  premium_progress_bar_enabled: boolean
  nsfw: boolean
  nsfw_level: number
  emojis: never[]
  features: never[]
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
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: null,
    home_header: null,
    splash: null,
    discovery_splash: null,
    banner: null,
    owner_id: row.owner_id,
    application_id: null,
    region: 'deprecated',
    afk_channel_id: null,
    afk_timeout: 300,
    system_channel_id: null,
    system_channel_flags: 0,
    widget_enabled: false,
    widget_channel_id: null,
    verification_level: row.verification_level,
    roles,
    default_message_notifications: row.default_message_notifications,
    mfa_level: 0,
    explicit_content_filter: row.explicit_content_filter,
    max_presences: null,
    max_members: 500_000,
    max_stage_video_channel_users: 50,
    max_video_channel_users: 25,
    vanity_url_code: null,
    premium_tier: row.premium_tier,
    premium_subscription_count: 0,
    preferred_locale: row.preferred_locale,
    rules_channel_id: null,
    safety_alerts_channel_id: null,
    public_updates_channel_id: null,
    premium_progress_bar_enabled: false,
    nsfw: false,
    nsfw_level: 0,
    emojis: [],
    features: [],
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

/**
 * Builds the payload for a Gateway `GUILD_CREATE` Dispatch event.
 *
 * `GUILD_CREATE` sends everything the plain `GuildObject` (the REST shape)
 * has, plus a set of Gateway-only "extra fields" (member_count, large,
 * joined_at, channels, members, ...) that some client libraries (e.g. JDA)
 * require to be present -- and correctly typed -- to parse the event at all.
 * See https://discord.com/developers/docs/topics/gateway-events#guild-create-guild-create-extra-fields
 * @param db - Database
 * @param guildId - Guild ID
 * @returns The GUILD_CREATE payload, or null if the guild does not exist
 */
export function buildGuildCreatePayload(
  db: Database,
  guildId: string
): (GuildObject & Record<string, unknown>) | null {
  const guild = getGuild(db, guildId)
  if (!guild) return null

  const memberCount = (
    db
      .prepare('SELECT COUNT(*) as cnt FROM guild_members WHERE guild_id = ?')
      .get(guildId) as { cnt: number }
  ).cnt

  return {
    ...guild,
    // `joined_at` is meant to record when the bot joined this guild; the
    // mock has no such history, so "now" is used as a plausible stand-in.
    // Uses `toDiscordTimestamp` (matching every other timestamp field in the
    // mock) rather than `Date#toISOString()`: real Discord always emits
    // ISO 8601 with microsecond precision and an explicit "+00:00" offset
    // (e.g. "2021-01-01T01:01:01.010000+00:00"), never the "Z"-suffixed,
    // millisecond-precision form `toISOString()` produces. Some strict
    // clients (e.g. twilight-model's `Timestamp` parser) reject the "Z" form
    // outright for being too short.
    joined_at: toDiscordTimestamp(new Date()),
    // Real Discord marks a guild "large" once its member count exceeds the
    // client's IDENTIFY `large_threshold` (default 50); the mock doesn't
    // track per-session thresholds, so Discord's own default is used here.
    large: memberCount > 50,
    unavailable: false,
    member_count: memberCount,
    voice_states: [],
    members: getGuildMembers(db, guildId, 1000),
    channels: getGuildChannels(db, guildId),
    threads: [],
    presences: [],
    stage_instances: [],
    guild_scheduled_events: [],
  }
}
