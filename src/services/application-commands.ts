/**
 * Application command operations service
 *
 * Provides CRUD and bulk-overwrite operations for both global and
 * guild-scoped slash commands, plus per-guild command permission overrides.
 */

import type { Database } from '../db'
import { generateSnowflake } from '../snowflake'
import type {
  ApplicationCommandCreatePayload,
  ApplicationCommandOption,
} from '../validators/application-command'

/** Command object for API responses */
export interface ApplicationCommandObject {
  id: string
  application_id: string
  guild_id?: string
  type: number
  name: string
  description: string
  options: ApplicationCommandOption[]
  default_member_permissions: string | null
  dm_permission?: boolean | null
  nsfw: boolean
  version: string
}

/** Command record type retrieved from the DB */
interface ApplicationCommandRow {
  id: string
  application_id: string
  guild_id: string | null
  type: number
  name: string
  description: string
  options: string
  default_member_permissions: string | null
  dm_permission: number | null
  nsfw: number
  version: string
  created_at: string
}

/**
 * Converts a DB command record into the API response format.
 * `dm_permission` is only meaningful (and only included) for global commands;
 * guild-scoped commands include `guild_id` instead.
 * @param row - DB record
 * @returns Object for API responses
 */
function toApplicationCommandObject(
  row: ApplicationCommandRow
): ApplicationCommandObject {
  const base: ApplicationCommandObject = {
    id: row.id,
    application_id: row.application_id,
    type: row.type,
    name: row.name,
    description: row.description,
    options: JSON.parse(row.options) as ApplicationCommandOption[],
    default_member_permissions: row.default_member_permissions,
    nsfw: row.nsfw === 1,
    version: row.version,
  }
  if (row.guild_id) {
    base.guild_id = row.guild_id
  } else {
    base.dm_permission =
      row.dm_permission === null ? null : row.dm_permission === 1
  }
  return base
}

/**
 * Normalizes a command name: CHAT_INPUT (type 1) names must be lowercase;
 * USER/MESSAGE (type 2/3) names are display names and are left as-is.
 * @param name - Raw command name
 * @param type - Command type
 * @returns Normalized name
 */
function normalizeName(name: string, type: number): string {
  return type === 1 ? name.toLowerCase() : name
}

/** Result of a command create/update attempt */
export type CommandWriteResult =
  | { ok: true; command: ApplicationCommandObject }
  | { ok: false; reason: 'duplicate_name' }

/**
 * Retrieves all commands in a scope.
 * @param db - Database
 * @param applicationId - Application (= bot user) ID
 * @param guildId - Guild ID, or `null` for global commands
 * @returns Command objects, ordered by ID
 */
export function getCommands(
  db: Database,
  applicationId: string,
  guildId: string | null
): ApplicationCommandObject[] {
  const rows = (
    guildId === null
      ? db
          .prepare(
            'SELECT * FROM application_commands WHERE application_id = ? AND guild_id IS NULL ORDER BY id'
          )
          .all(applicationId)
      : db
          .prepare(
            'SELECT * FROM application_commands WHERE application_id = ? AND guild_id = ? ORDER BY id'
          )
          .all(applicationId, guildId)
  ) as ApplicationCommandRow[]
  return rows.map((row) => toApplicationCommandObject(row))
}

/**
 * Retrieves a single command by ID within a scope.
 * @param db - Database
 * @param applicationId - Application ID
 * @param guildId - Guild ID, or `null` for global commands
 * @param commandId - Command ID
 * @returns Command object, or null if not found in this scope
 */
export function getCommand(
  db: Database,
  applicationId: string,
  guildId: string | null,
  commandId: string
): ApplicationCommandObject | null {
  const row = (
    guildId === null
      ? db
          .prepare(
            'SELECT * FROM application_commands WHERE application_id = ? AND guild_id IS NULL AND id = ?'
          )
          .get(applicationId, commandId)
      : db
          .prepare(
            'SELECT * FROM application_commands WHERE application_id = ? AND guild_id = ? AND id = ?'
          )
          .get(applicationId, guildId, commandId)
  ) as ApplicationCommandRow | undefined
  return row ? toApplicationCommandObject(row) : null
}

/**
 * Finds an existing command by (application_id, guild_id, type, name),
 * optionally excluding a specific command ID (used by update-name-change
 * conflict checks).
 * @param db - Database
 * @param applicationId - Application ID
 * @param guildId - Guild ID, or `null` for global commands
 * @param type - Command type
 * @param name - Normalized command name
 * @param excludeId - Command ID to exclude from the match, if any
 * @returns The conflicting row's ID, or undefined
 */
function findDuplicate(
  db: Database,
  applicationId: string,
  guildId: string | null,
  type: number,
  name: string,
  excludeId?: string
): string | undefined {
  const row = (
    guildId === null
      ? db
          .prepare(
            `SELECT id FROM application_commands
             WHERE application_id = ? AND guild_id IS NULL AND type = ? AND name = ? AND id != ?`
          )
          .get(applicationId, type, name, excludeId ?? '')
      : db
          .prepare(
            `SELECT id FROM application_commands
             WHERE application_id = ? AND guild_id = ? AND type = ? AND name = ? AND id != ?`
          )
          .get(applicationId, guildId, type, name, excludeId ?? '')
  ) as { id: string } | undefined
  return row?.id
}

/**
 * Creates a command in the given scope.
 * @param db - Database
 * @param applicationId - Application ID
 * @param guildId - Guild ID, or `null` for a global command
 * @param payload - Validated command payload
 * @returns The created command, or a duplicate_name failure
 */
export function createCommand(
  db: Database,
  applicationId: string,
  guildId: string | null,
  payload: ApplicationCommandCreatePayload
): CommandWriteResult {
  const type = payload.type ?? 1
  const name = normalizeName(payload.name, type)
  const description = type === 1 ? (payload.description ?? '') : ''

  if (findDuplicate(db, applicationId, guildId, type, name)) {
    return { ok: false, reason: 'duplicate_name' }
  }

  const id = generateSnowflake()
  const version = generateSnowflake()
  db.prepare(
    `INSERT INTO application_commands
       (id, application_id, guild_id, type, name, description, options,
        default_member_permissions, dm_permission, nsfw, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    applicationId,
    guildId,
    type,
    name,
    description,
    JSON.stringify(payload.options ?? []),
    payload.default_member_permissions ?? null,
    payload.dm_permission === undefined || payload.dm_permission === null
      ? null
      : payload.dm_permission
        ? 1
        : 0,
    payload.nsfw ? 1 : 0,
    version
  )

  const row = db
    .prepare('SELECT * FROM application_commands WHERE id = ?')
    .get(id) as ApplicationCommandRow
  return { ok: true, command: toApplicationCommandObject(row) }
}

/**
 * Updates a command in place (partial update).
 * @param db - Database
 * @param applicationId - Application ID
 * @param guildId - Guild ID, or `null` for a global command
 * @param commandId - Command ID
 * @param payload - Partial update payload
 * @returns The updated command, a duplicate_name failure, or not_found
 */
export function updateCommand(
  db: Database,
  applicationId: string,
  guildId: string | null,
  commandId: string,
  payload: Partial<ApplicationCommandCreatePayload>
): CommandWriteResult | { ok: false; reason: 'not_found' } {
  const current = getCommand(db, applicationId, guildId, commandId)
  if (!current) return { ok: false, reason: 'not_found' }

  const type = payload.type ?? current.type
  const name =
    payload.name === undefined
      ? current.name
      : normalizeName(payload.name, type)
  const description =
    type === 1 ? (payload.description ?? current.description) : ''

  if (
    (name !== current.name || type !== current.type) &&
    findDuplicate(db, applicationId, guildId, type, name, commandId)
  ) {
    return { ok: false, reason: 'duplicate_name' }
  }

  const options = payload.options ?? current.options
  const defaultMemberPermissions =
    payload.default_member_permissions === undefined
      ? current.default_member_permissions
      : payload.default_member_permissions
  const dmPermission =
    payload.dm_permission === undefined
      ? (current.dm_permission ?? null)
      : payload.dm_permission
  const nsfw = payload.nsfw ?? current.nsfw

  db.prepare(
    `UPDATE application_commands SET
       type = ?, name = ?, description = ?, options = ?,
       default_member_permissions = ?, dm_permission = ?, nsfw = ?
     WHERE id = ?`
  ).run(
    type,
    name,
    description,
    JSON.stringify(options),
    defaultMemberPermissions ?? null,
    dmPermission === null ? null : dmPermission ? 1 : 0,
    nsfw ? 1 : 0,
    commandId
  )

  const row = db
    .prepare('SELECT * FROM application_commands WHERE id = ?')
    .get(commandId) as ApplicationCommandRow
  return { ok: true, command: toApplicationCommandObject(row) }
}

/**
 * Deletes a command from the given scope.
 * @param db - Database
 * @param applicationId - Application ID
 * @param guildId - Guild ID, or `null` for a global command
 * @param commandId - Command ID
 * @returns true on successful deletion
 */
export function deleteCommand(
  db: Database,
  applicationId: string,
  guildId: string | null,
  commandId: string
): boolean {
  const result =
    guildId === null
      ? db
          .prepare(
            'DELETE FROM application_commands WHERE application_id = ? AND guild_id IS NULL AND id = ?'
          )
          .run(applicationId, commandId)
      : db
          .prepare(
            'DELETE FROM application_commands WHERE application_id = ? AND guild_id = ? AND id = ?'
          )
          .run(applicationId, guildId, commandId)
  return result.changes > 0
}
