/**
 * Permission calculation service
 *
 * Computes the guild-level and channel-level permission bitfields exposed by
 * the /guilds/:guildId/permissions/* and /channels/:channelId/permissions/*
 * GET endpoints.
 */

import type { Database } from '../db'
import { getChannelOverwrites } from './channels'

const ADMINISTRATOR = 1n << 3n

/** Every defined permission bit; returned for owners and administrators. */
const ALL_PERMISSIONS = (1n << 64n) - 1n

/** Overwrite target type for a member (0 is a role) */
const OVERWRITE_TYPE_MEMBER = 1

/**
 * Reads a role's guild-level permission bitfield.
 * @param db - Database
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @returns The bitfield, or null if the role is not in the guild
 */
function readRolePermissions(
  db: Database,
  guildId: string,
  roleId: string
): bigint | null {
  const row = db
    .prepare('SELECT permissions FROM roles WHERE id = ? AND guild_id = ?')
    .get(roleId, guildId) as { permissions: string } | undefined
  return row ? BigInt(row.permissions) : null
}

/**
 * Lists the IDs of the roles assigned to a member (excluding @everyone).
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - Member user ID
 * @returns Role IDs
 */
function readMemberRoleIds(
  db: Database,
  guildId: string,
  userId: string
): string[] {
  const rows = db
    .prepare(
      `SELECT mr.role_id AS id FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id AND r.guild_id = mr.guild_id
       WHERE mr.guild_id = ? AND mr.user_id = ?`
    )
    .all(guildId, userId) as { id: string }[]
  return rows.map((row) => row.id)
}

/**
 * Applies a single overwrite: deny is cleared first, then allow is set.
 * @param base - Current permissions
 * @param allow - Allowed bits
 * @param deny - Denied bits
 * @returns The updated permissions
 */
function applyOverwrite(base: bigint, allow: bigint, deny: bigint): bigint {
  return (base & ~deny) | allow
}

/**
 * Computes a member's guild-level permissions.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - Member user ID
 * @returns The bitfield, or null if the user is not a member of the guild
 */
export function getGuildMemberPermissions(
  db: Database,
  guildId: string,
  userId: string
): bigint | null {
  const member = db
    .prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId)
  if (!member) return null

  const guild = db
    .prepare('SELECT owner_id FROM guilds WHERE id = ?')
    .get(guildId) as { owner_id: string } | undefined
  if (guild?.owner_id === userId) return ALL_PERMISSIONS

  let base = readRolePermissions(db, guildId, guildId) ?? 0n
  for (const roleId of readMemberRoleIds(db, guildId, userId)) {
    base |= readRolePermissions(db, guildId, roleId) ?? 0n
  }
  return base & ADMINISTRATOR ? ALL_PERMISSIONS : base
}

/**
 * Computes the guild-level permissions a role grants, combined with @everyone.
 * @param db - Database
 * @param guildId - Guild ID
 * @param roleId - Role ID (the guild ID selects @everyone)
 * @returns The bitfield, or null if the role is not in the guild
 */
export function getGuildRolePermissions(
  db: Database,
  guildId: string,
  roleId: string
): bigint | null {
  const role = readRolePermissions(db, guildId, roleId)
  if (role === null) return null

  const base = (readRolePermissions(db, guildId, guildId) ?? 0n) | role
  return base & ADMINISTRATOR ? ALL_PERMISSIONS : base
}

/**
 * Computes a member's permissions in a channel, applying the channel's
 * overwrites in the order @everyone, roles, member.
 * @param db - Database
 * @param guildId - Guild ID the channel belongs to
 * @param channelId - Channel ID
 * @param userId - Member user ID
 * @returns The bitfield, or null if the user is not a member of the guild
 */
export function getChannelMemberPermissions(
  db: Database,
  guildId: string,
  channelId: string,
  userId: string
): bigint | null {
  const base = getGuildMemberPermissions(db, guildId, userId)
  if (base === null || base === ALL_PERMISSIONS) return base

  const overwrites = getChannelOverwrites(db, channelId)
  const roleIds = new Set(readMemberRoleIds(db, guildId, userId))
  let permissions = base

  const everyone = overwrites.find(
    (o) => o.id === guildId && o.type !== OVERWRITE_TYPE_MEMBER
  )
  if (everyone) {
    permissions = applyOverwrite(
      permissions,
      BigInt(everyone.allow),
      BigInt(everyone.deny)
    )
  }

  let roleAllow = 0n
  let roleDeny = 0n
  for (const o of overwrites) {
    if (o.type === OVERWRITE_TYPE_MEMBER || !roleIds.has(o.id)) {
      continue
    }

    roleAllow |= BigInt(o.allow)
    roleDeny |= BigInt(o.deny)
  }
  permissions = applyOverwrite(permissions, roleAllow, roleDeny)

  const own = overwrites.find(
    (o) => o.id === userId && o.type === OVERWRITE_TYPE_MEMBER
  )
  if (own) {
    permissions = applyOverwrite(
      permissions,
      BigInt(own.allow),
      BigInt(own.deny)
    )
  }
  return permissions
}

/**
 * Computes the permissions a role grants in a channel: the guild-level
 * permissions with the @everyone overwrite and then the role's own overwrite.
 * @param db - Database
 * @param guildId - Guild ID the channel belongs to
 * @param channelId - Channel ID
 * @param roleId - Role ID (the guild ID selects @everyone)
 * @returns The bitfield, or null if the role is not in the guild
 */
export function getChannelRolePermissions(
  db: Database,
  guildId: string,
  channelId: string,
  roleId: string
): bigint | null {
  const base = getGuildRolePermissions(db, guildId, roleId)
  if (base === null || base === ALL_PERMISSIONS) return base

  const overwrites = getChannelOverwrites(db, channelId)
  let permissions = base

  const targetIds = roleId === guildId ? [guildId] : [guildId, roleId]
  for (const id of targetIds) {
    const o = overwrites.find(
      (x) => x.id === id && x.type !== OVERWRITE_TYPE_MEMBER
    )
    if (o) {
      permissions = applyOverwrite(permissions, BigInt(o.allow), BigInt(o.deny))
    }
  }
  return permissions
}
