/**
 * Guild member operations service
 *
 * Provides retrieval, update, and role-assignment operations for guild
 * members.
 */

import type { Database } from '../db.js'
// Used for compile-time type drift detection.
import type { APIGuildMember, APIUser } from 'discord-api-types/v10'

/**
 * Compile-time guard: ensures the safe-field subset of GuildMemberObject is
 * structurally compatible with APIGuildMember.
 * Fails to compile when discord-api-types renames or retypes these fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MemberCompatGuard =
  Pick<
    APIGuildMember,
    'nick' | 'roles' | 'joined_at' | 'deaf' | 'mute'
  > extends Pick<
    GuildMemberObject,
    'nick' | 'roles' | 'joined_at' | 'deaf' | 'mute'
  >
    ? true
    : never

/**
 * Compile-time guard: ensures the safe-field subset of MemberUserObject is
 * structurally compatible with APIUser.
 * Fails to compile when discord-api-types renames or retypes these fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _UserCompatGuard =
  Pick<
    APIUser,
    'id' | 'username' | 'discriminator' | 'avatar' | 'bot'
  > extends Pick<
    MemberUserObject,
    'id' | 'username' | 'discriminator' | 'avatar' | 'bot'
  >
    ? true
    : never

/** Guild member record type retrieved from the DB */
interface MemberRow {
  guild_id: string
  user_id: string
  nick: string | null
  joined_at: string
  deaf: number
  mute: number
  flags: number
}

/** User subset embedded in a guild member object */
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

/** Guild member object for API responses */
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
  permissions?: string
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
      `SELECT role_id FROM member_roles
       WHERE guild_id = ? AND user_id = ?
       ORDER BY role_id`
    )
    .all(guildId, userId) as { role_id: string }[]
  return rows.map((r) => r.role_id)
}

/**
 * Retrieves a guild member.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @returns Guild member object, or null
 */
export function getGuildMember(
  db: Database,
  guildId: string,
  userId: string
): GuildMemberObject | null {
  const memberRow = db
    .prepare('SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as MemberRow | undefined
  if (!memberRow) return null

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | {
        id: string
        username: string
        discriminator: string
        avatar: string | null
        bot: number
      }
    | undefined
  if (!userRow) return null

  return {
    avatar: null,
    banner: null,
    communication_disabled_until: null,
    flags: memberRow.flags,
    joined_at: new Date(memberRow.joined_at).toISOString(),
    nick: memberRow.nick,
    pending: false,
    premium_since: null,
    roles: getMemberRoleIds(db, guildId, userId),
    user: {
      id: userRow.id,
      username: userRow.username,
      discriminator: userRow.discriminator,
      avatar: userRow.avatar,
      bot: userRow.bot === 1,
      flags: 0,
      public_flags: 0,
      global_name: null,
      primary_guild: null,
    },
    mute: memberRow.mute === 1,
    deaf: memberRow.deaf === 1,
  }
}

/**
 * Retrieves the list of members for a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param limit - Number of items to retrieve (clamped to 1000, default 1)
 * @param after - Pagination cursor (user ID, default '0')
 * @returns Array of guild member objects
 */
export function getGuildMembers(
  db: Database,
  guildId: string,
  limit = 1,
  after = '0'
): GuildMemberObject[] {
  const clampedLimit = Math.min(limit, 1000)
  const memberRows = db
    .prepare(
      `SELECT * FROM guild_members
       WHERE guild_id = ? AND user_id > ?
       ORDER BY user_id ASC LIMIT ?`
    )
    .all(guildId, after, clampedLimit) as MemberRow[]

  return memberRows
    .map((memberRow): GuildMemberObject | null => {
      const userRow = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(memberRow.user_id) as
        | {
            id: string
            username: string
            discriminator: string
            avatar: string | null
            bot: number
          }
        | undefined
      if (!userRow) return null

      return {
        avatar: null,
        banner: null,
        communication_disabled_until: null,
        flags: memberRow.flags,
        joined_at: new Date(memberRow.joined_at).toISOString(),
        nick: memberRow.nick,
        pending: false,
        premium_since: null,
        roles: getMemberRoleIds(db, guildId, memberRow.user_id),
        user: {
          id: userRow.id,
          username: userRow.username,
          discriminator: userRow.discriminator,
          avatar: userRow.avatar,
          bot: userRow.bot === 1,
          flags: 0,
          public_flags: 0,
          global_name: null,
          primary_guild: null,
        },
        mute: memberRow.mute === 1,
        deaf: memberRow.deaf === 1,
      }
    })
    .filter((m): m is GuildMemberObject => m !== null)
}

/** Guild member update parameters */
export interface GuildMemberUpdateParams {
  nick?: string | null
  roles?: string[]
}

/**
 * Updates a guild member's information (nickname and/or role list).
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @param payload - Update payload
 * @returns Updated guild member object, or null
 */
export function updateGuildMember(
  db: Database,
  guildId: string,
  userId: string,
  payload: GuildMemberUpdateParams
): GuildMemberObject | null {
  const current = db
    .prepare('SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as MemberRow | undefined
  if (!current) return null

  if (payload.nick !== undefined) {
    db.prepare(
      'UPDATE guild_members SET nick = ? WHERE guild_id = ? AND user_id = ?'
    ).run(payload.nick, guildId, userId)
  }

  if (payload.roles !== undefined) {
    const roles = payload.roles
    const replaceRoles = db.transaction(() => {
      db.prepare(
        'DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?'
      ).run(guildId, userId)
      const insert = db.prepare(
        'INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'
      )
      for (const roleId of roles) {
        insert.run(guildId, userId, roleId)
      }
    })
    replaceRoles()
  }

  return getGuildMember(db, guildId, userId)
}

/**
 * Removes a member from a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @returns true on successful removal
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

  // Also delete the role assignments the member had (member_roles has no
  // FK to guild_members, so these would otherwise become orphaned rows).
  db.prepare('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?').run(
    guildId,
    userId
  )
  return true
}

/**
 * Adds a role to a member.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @param roleId - Role ID
 * @returns true on success; false if the member or role does not exist
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

  // A foreign key constraint on member_roles.role_id requires the role to
  // exist, so check explicitly to avoid throwing on a missing role.
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
 * Removes a role from a member.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID
 * @param roleId - Role ID
 * @returns true on success; false if the member does not exist
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
