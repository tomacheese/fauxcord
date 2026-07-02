/**
 * Guild role operations service
 *
 * Provides CRUD operations for guild roles.
 */

import type { Database } from '../db.js'
// Used for compile-time type drift detection.
import type { APIRole } from 'discord-api-types/v10'

/**
 * Compile-time guard: ensures the safe-field subset of RoleObject is
 * structurally compatible with APIRole.
 * Fails to compile when discord-api-types renames or retypes these fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RoleCompatGuard =
  Pick<
    APIRole,
    | 'id'
    | 'name'
    | 'color'
    | 'hoist'
    | 'position'
    | 'permissions'
    | 'managed'
    | 'mentionable'
  > extends Pick<
    RoleObject,
    | 'id'
    | 'name'
    | 'color'
    | 'hoist'
    | 'position'
    | 'permissions'
    | 'managed'
    | 'mentionable'
  >
    ? true
    : never

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

/** Role color fields (single/gradient) for API responses */
export interface RoleColors {
  primary_color: number
  secondary_color: number | null
  tertiary_color: number | null
}

/** Role object for API responses */
export interface RoleObject {
  id: string
  name: string
  color: number
  colors: RoleColors
  hoist: boolean
  icon: string | null
  unicode_emoji: string | null
  position: number
  permissions: string
  managed: boolean
  mentionable: boolean
  tags: Record<string, never>
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
    tags: {},
    flags: 0,
  }
}

/**
 * Retrieves the list of roles for a guild, ordered by position.
 * @param db - Database
 * @param guildId - Guild ID
 * @returns Array of role objects
 */
export function getGuildRoles(db: Database, guildId: string): RoleObject[] {
  const rows = db
    .prepare('SELECT * FROM roles WHERE guild_id = ? ORDER BY position')
    .all(guildId) as RoleRow[]
  return rows.map((row) => toRoleObject(row))
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
        'SELECT COALESCE(MAX(position), 0) as maxPos FROM roles WHERE guild_id = ?'
      )
      .get(params.guildId) as { maxPos: number }
  ).maxPos

  db.prepare(
    `INSERT INTO roles (id, guild_id, name, color, hoist, position, permissions, managed, mentionable)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
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
 * Retrieves a role by ID within a guild.
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
  permissions?: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
  position?: number
}

/**
 * Updates a role's information.
 * @param db - Database
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @param payload - Update payload
 * @returns Updated role object, or null
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
  if (payload.permissions !== undefined) {
    updates.permissions = payload.permissions
  }
  if (payload.mentionable !== undefined) {
    updates.mentionable = payload.mentionable ? 1 : 0
  }
  if (payload.position !== undefined) updates.position = payload.position

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
 * Deletes a role.
 * @param db - Database
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @returns true on successful deletion
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
