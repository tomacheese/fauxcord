/**
 * Guild operations service
 *
 * Provides guild CRUD operations and member/role management.
 */

import type { Database } from '../db.js'
// Used for compile-time type drift detection.
import type { APIRole, APIGuildMember, APIUser } from 'discord-api-types/v10'

/**
 * Compile-time guard: ensures the safe-field subset of RoleObject is
 * structurally compatible with APIRole.
 * Numeric enum fields (color, flags, permissions string) are excluded.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RoleCompatGuard =
  Pick<
    APIRole,
    'id' | 'name' | 'hoist' | 'managed' | 'mentionable'
  > extends Pick<
    RoleObject,
    'id' | 'name' | 'hoist' | 'managed' | 'mentionable'
  >
    ? true
    : never

/**
 * Compile-time guard: ensures the safe-field subset of GuildMemberObject is
 * structurally compatible with APIGuildMember.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MemberCompatGuard =
  Pick<
    APIGuildMember,
    'nick' | 'joined_at' | 'pending' | 'flags' | 'deaf' | 'mute'
  > extends Pick<
    GuildMemberObject,
    'nick' | 'joined_at' | 'pending' | 'flags' | 'deaf' | 'mute'
  >
    ? true
    : never

/**
 * Compile-time guard: ensures the safe-field subset of MemberUserObject is
 * structurally compatible with APIUser.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _UserCompatGuard =
  Pick<
    APIUser,
    'id' | 'username' | 'discriminator' | 'avatar' | 'bot' | 'global_name'
  > extends Pick<
    MemberUserObject,
    'id' | 'username' | 'discriminator' | 'avatar' | 'bot' | 'global_name'
  >
    ? true
    : never

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

/** Role record type retrieved from the DB */
interface RoleRow {
  id: string
  guild_id: string
  name: string
  color: number
  hoist: number
  position: number
  permissions: string
  managed: number
  mentionable: number
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
 * Role color gradient object (GuildRoleColorsResponse).
 * The mock always uses a flat single color (no gradient), so secondary and
 * tertiary colors are null and primary_color mirrors the role's `color` field.
 */
export interface RoleColors {
  /** Primary role color (mirrors the `color` field) */
  primary_color: number
  /** Secondary gradient color (always null in the mock) */
  secondary_color: number | null
  /** Tertiary gradient color (always null in the mock) */
  tertiary_color: number | null
}

/** Role object for API responses */
export interface RoleObject {
  id: string
  name: string
  color: number
  /** Role color gradient preset (always uses primary_color = color, no gradient) */
  colors: RoleColors
  hoist: boolean
  /** Role icon hash (always null in the mock) */
  icon: string | null
  /** Role unicode emoji (always null in the mock) */
  unicode_emoji: string | null
  position: number
  permissions: string
  managed: boolean
  mentionable: boolean
  /** Role flags bitset (always 0 in the mock) */
  flags: number
}

/**
 * Converts a DB role record into the API response format.
 * @param row - DB record
 * @returns Object for API responses
 */
function toRoleObject(row: RoleRow): RoleObject {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    colors: {
      primary_color: row.color,
      secondary_color: null,
      tertiary_color: null,
    },
    hoist: row.hoist === 1,
    icon: null,
    unicode_emoji: null,
    position: row.position,
    permissions: row.permissions,
    managed: row.managed === 1,
    mentionable: row.mentionable === 1,
    flags: 0,
  }
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

  const roles = db
    .prepare('SELECT * FROM roles WHERE guild_id = ? ORDER BY position')
    .all(guildId) as RoleRow[]

  const guild = toGuildObject(
    row,
    roles.map((r) => toRoleObject(r))
  )

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
 * Updates a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param payload - Update payload
 * @returns Updated guild object, or null if the guild does not exist
 */
export function updateGuild(
  db: Database,
  guildId: string,
  payload: GuildUpdateParams
): GuildObject | null {
  const current = db.prepare('SELECT id FROM guilds WHERE id = ?').get(guildId)
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
 * @returns true on successful deletion (false if the guild does not exist)
 */
export function deleteGuild(db: Database, guildId: string): boolean {
  const result = db.prepare('DELETE FROM guilds WHERE id = ?').run(guildId)
  return result.changes > 0
}

/**
 * Retrieves the list of guilds the bot has joined (for /users/@me/guilds).
 * @param db - Database
 * @param botToken - Bot token in "Bot xxx" format
 * @returns Array of guild summary objects
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
  features: never[]
}[] {
  const rows = db
    .prepare('SELECT * FROM guilds WHERE bot_token = ?')
    .all(botToken) as GuildRow[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    banner: null,
    owner: false,
    permissions: '0',
    features: [],
  }))
}

/**
 * Retrieves the list of roles in a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @returns Array of role objects
 */
export function getGuildRoles(db: Database, guildId: string): RoleObject[] {
  const rows = db
    .prepare('SELECT * FROM roles WHERE guild_id = ? ORDER BY position')
    .all(guildId) as RoleRow[]
  return rows.map((r) => toRoleObject(r))
}

/** Role creation parameters */
export interface RoleCreateParams {
  roleId: string
  guildId: string
  name?: string
  permissions?: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
}

/**
 * Creates a role in a guild.
 * @param db - Database
 * @param params - Role creation parameters
 * @returns Created role object
 */
export function createRole(db: Database, params: RoleCreateParams): RoleObject {
  const maxPosition = (
    db
      .prepare(
        'SELECT COALESCE(MAX(position), 0) as pos FROM roles WHERE guild_id = ?'
      )
      .get(params.guildId) as { pos: number }
  ).pos

  db.prepare(
    `INSERT INTO roles (id, guild_id, name, color, hoist, position, permissions, mentionable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.roleId,
    params.guildId,
    params.name ?? 'new role',
    params.color ?? 0,
    params.hoist ? 1 : 0,
    maxPosition + 1,
    params.permissions ?? '0',
    params.mentionable ? 1 : 0
  )

  const row = db
    .prepare('SELECT * FROM roles WHERE id = ?')
    .get(params.roleId) as RoleRow
  return toRoleObject(row)
}

/**
 * Retrieves a single role from a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @returns Role object, or null
 */
export function getRole(
  db: Database,
  guildId: string,
  roleId: string
): RoleObject | null {
  const row = db
    .prepare('SELECT * FROM roles WHERE id = ? AND guild_id = ?')
    .get(roleId, guildId) as RoleRow | undefined
  return row ? toRoleObject(row) : null
}

/** Role update parameters */
export interface RoleUpdateParams {
  name?: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
  permissions?: string
}

/**
 * Updates a role in a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @param payload - Update payload
 * @returns Updated role object, or null if the role does not exist
 */
export function updateRole(
  db: Database,
  guildId: string,
  roleId: string,
  payload: RoleUpdateParams
): RoleObject | null {
  const current = db
    .prepare('SELECT * FROM roles WHERE id = ? AND guild_id = ?')
    .get(roleId, guildId) as RoleRow | undefined
  if (!current) return null

  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) updates.name = payload.name
  if (payload.color !== undefined) updates.color = payload.color
  if (payload.hoist !== undefined) updates.hoist = payload.hoist ? 1 : 0
  if (payload.mentionable !== undefined)
    updates.mentionable = payload.mentionable ? 1 : 0
  if (payload.permissions !== undefined)
    updates.permissions = payload.permissions

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(', ')
    db.prepare(`UPDATE roles SET ${setClauses} WHERE id = ?`).run(
      ...Object.values(updates),
      roleId
    )
  }

  const row = db
    .prepare('SELECT * FROM roles WHERE id = ?')
    .get(roleId) as RoleRow
  return toRoleObject(row)
}

/**
 * Deletes a role from a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @returns true on successful deletion (false if the role does not exist)
 */
export function deleteRole(
  db: Database,
  guildId: string,
  roleId: string
): boolean {
  const result = db
    .prepare('DELETE FROM roles WHERE id = ? AND guild_id = ?')
    .run(roleId, guildId)
  return result.changes > 0
}

/** Member record type */
interface MemberRow {
  guild_id: string
  user_id: string
  nick: string | null
  joined_at: string
  deaf: number
  mute: number
  flags: number
}

/** User sub-object embedded in GuildMemberObject */
export interface MemberUserObject {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  bot: boolean
  /** User account flags (always 0 in the mock) */
  flags: number
  /** User public flags bitset (always 0 in the mock) */
  public_flags: number
  /** Display name (always null in the mock) */
  global_name: string | null
  /** Primary guild info (always null in the mock) */
  primary_guild: string | null
}

/** GuildMember object for API responses */
export interface GuildMemberObject {
  /** Member's guild-specific avatar hash (always null in the mock) */
  avatar: string | null
  /** Member's guild-specific banner hash (always null in the mock) */
  banner: string | null
  /** Timestamp when the member's timeout expires (always null in the mock) */
  communication_disabled_until: string | null
  flags: number
  joined_at: string
  nick: string | null
  /** Whether the member has not yet passed the guild's membership screening (always false in the mock) */
  pending: boolean
  /** Timestamp when the member started boosting the guild (always null in the mock) */
  premium_since: string | null
  roles: string[]
  user: MemberUserObject
  mute: boolean
  deaf: boolean
}

/**
 * Retrieves the list of role IDs assigned to a member.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @returns Array of role IDs
 */
function getMemberRoleIds(
  db: Database,
  guildId: string,
  userId: string
): string[] {
  const rows = db
    .prepare(
      'SELECT role_id FROM member_roles WHERE guild_id = ? AND user_id = ? ORDER BY role_id'
    )
    .all(guildId, userId) as { role_id: string }[]
  return rows.map((r) => r.role_id)
}

/**
 * Retrieves a guild member by ID.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @returns GuildMember object, or null
 */
export function getGuildMember(
  db: Database,
  guildId: string,
  userId: string
): GuildMemberObject | null {
  const member = db
    .prepare('SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as MemberRow | undefined
  if (!member) return null

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | {
        id: string
        username: string
        discriminator: string
        avatar: string | null
        bot: number
      }
    | undefined
  if (!user) return null

  return {
    avatar: null,
    banner: null,
    communication_disabled_until: null,
    flags: member.flags,
    joined_at: new Date(member.joined_at).toISOString(),
    nick: member.nick,
    pending: false,
    premium_since: null,
    roles: getMemberRoleIds(db, guildId, userId),
    user: {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
      bot: user.bot === 1,
      flags: 0,
      public_flags: 0,
      global_name: null,
      primary_guild: null,
    },
    mute: member.mute === 1,
    deaf: member.deaf === 1,
  }
}

/**
 * Retrieves the list of guild members.
 * @param db - Database
 * @param guildId - Guild ID
 * @param limit - Number of items to retrieve (max 1000)
 * @param after - Pagination cursor
 * @returns Array of GuildMember objects
 */
export function getGuildMembers(
  db: Database,
  guildId: string,
  limit = 1,
  after = '0'
): GuildMemberObject[] {
  const clampedLimit = Math.min(limit, 1000)
  const members = db
    .prepare(
      `SELECT gm.*, u.username, u.discriminator, u.avatar, u.bot
       FROM guild_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.guild_id = ? AND gm.user_id > ?
       ORDER BY gm.user_id ASC LIMIT ?`
    )
    .all(guildId, after, clampedLimit) as (MemberRow & {
    username: string
    discriminator: string
    avatar: string | null
    bot: number
  })[]

  return members.map((m) => ({
    avatar: null,
    banner: null,
    communication_disabled_until: null,
    flags: m.flags,
    joined_at: new Date(m.joined_at).toISOString(),
    nick: m.nick,
    pending: false,
    premium_since: null,
    roles: getMemberRoleIds(db, guildId, m.user_id),
    user: {
      id: m.user_id,
      username: m.username,
      discriminator: m.discriminator,
      avatar: m.avatar,
      bot: m.bot === 1,
      flags: 0,
      public_flags: 0,
      global_name: null,
      primary_guild: null,
    },
    mute: m.mute === 1,
    deaf: m.deaf === 1,
  }))
}

/** Member update parameters */
export interface GuildMemberUpdateParams {
  /** Nickname (null to clear) */
  nick?: string | null
  /** Array of role IDs to assign (full replacement) */
  roles?: string[]
}

/**
 * Updates a guild member (nickname and roles).
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @param payload - Update payload
 * @returns Updated GuildMember object, or null if the member does not exist
 */
export function updateGuildMember(
  db: Database,
  guildId: string,
  userId: string,
  payload: GuildMemberUpdateParams
): GuildMemberObject | null {
  const member = db
    .prepare('SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as MemberRow | undefined
  if (!member) return null

  if (payload.nick !== undefined) {
    db.prepare(
      'UPDATE guild_members SET nick = ? WHERE guild_id = ? AND user_id = ?'
    ).run(payload.nick, guildId, userId)
  }

  if (payload.roles !== undefined) {
    // Fully replace the roles
    const replaceRoles = db.transaction((roleIds: string[]) => {
      db.prepare(
        'DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?'
      ).run(guildId, userId)
      const insert = db.prepare(
        'INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'
      )
      for (const roleId of roleIds) {
        insert.run(guildId, userId, roleId)
      }
    })
    replaceRoles(payload.roles)
  }

  return getGuildMember(db, guildId, userId)
}

/**
 * Removes (kicks) a guild member.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @returns true on successful removal (false if the member does not exist)
 */
export function removeGuildMember(
  db: Database,
  guildId: string,
  userId: string
): boolean {
  const result = db
    .prepare('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .run(guildId, userId)
  if (result.changes === 0) return false

  // Also delete the role assignments the member had
  db.prepare('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?').run(
    guildId,
    userId
  )
  return true
}

/**
 * Adds a role to a guild member (idempotent).
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @param roleId - Role ID to add
 * @returns true if the member and role both exist (regardless of whether the role was already assigned), false otherwise
 */
export function addMemberRole(
  db: Database,
  guildId: string,
  userId: string,
  roleId: string
): boolean {
  const member = db
    .prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId)
  if (!member) return false

  // member_roles.role_id has a FOREIGN KEY constraint on roles(id), so a
  // missing role would make INSERT OR IGNORE silently no-op. Guard against
  // that here instead of relying solely on callers to validate the role.
  const role = db
    .prepare('SELECT 1 FROM roles WHERE id = ? AND guild_id = ?')
    .get(roleId, guildId)
  if (!role) return false

  db.prepare(
    'INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'
  ).run(guildId, userId, roleId)
  return true
}

/**
 * Removes a role from a guild member (idempotent).
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @param roleId - Role ID to remove
 * @returns true if the member exists (regardless of whether the role was assigned), false if the member does not exist
 */
export function removeMemberRole(
  db: Database,
  guildId: string,
  userId: string,
  roleId: string
): boolean {
  const member = db
    .prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId)
  if (!member) return false

  db.prepare(
    'DELETE FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'
  ).run(guildId, userId, roleId)
  return true
}
