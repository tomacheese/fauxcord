/** Application profile, asset, emoji, entitlement, and role metadata service. */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from '../db'
import { generateSnowflake } from '../snowflake'

/** Mutable fields accepted by the application profile endpoints. */
export interface ApplicationUpdatePayload {
  description?: { default: string } | null
  icon?: string | null
  cover_image?: string | null
  flags?: number | null
  max_participants?: number | null
  tags?: string[] | null
  custom_install_url?: string | null
  install_params?: { scopes?: string[]; permissions?: string } | null
  integration_types_config?: Record<string, unknown> | null
  type?: number | null
}

/** Discord-compatible private application response. */
export interface ApplicationObject {
  id: string
  name: string
  icon: string | null
  description: string
  type: number | null
  cover_image?: string
  primary_sku_id?: string
  guild_id?: string
  rpc_origins: string[]
  bot_public: boolean
  bot_require_code_grant: boolean
  custom_install_url?: string
  install_params?: { scopes?: string[]; permissions?: string }
  integration_types_config: Record<string, unknown>
  verify_key: string
  flags: number
  flags_new: string
  max_participants: number | null
  tags: string[]
  redirect_uris: string[]
  interactions_endpoint_url: null
  role_connections_verification_url: null
  owner: UserObject
  approximate_guild_count: number
  approximate_user_install_count: number
  approximate_user_authorization_count: number
  explicit_content_filter: number
  team: null
  eligible_oauth2_scopes: string[]
}

/** Minimal user shape required by application and emoji responses. */
export interface UserObject {
  id: string
  username: string
  avatar: string | null
  discriminator: string
  public_flags: number
  flags: number
  bot?: boolean
  global_name: null
  primary_guild: null
}

interface ApplicationRow {
  id: string
  owner_id: string
  name: string
  icon: string | null
  description: string
  type: number | null
  cover_image: string | null
  primary_sku_id: string | null
  guild_id: string | null
  rpc_origins: string
  bot_public: number
  bot_require_code_grant: number
  custom_install_url: string | null
  install_params: string | null
  integration_types_config: string
  verify_key: string
  flags: number
  flags_new: string
  max_participants: number | null
  tags: string
}

interface UserRow {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  bot: number
}

/** Embedded activity instance response. */
export interface ActivityInstanceObject {
  application_id: string
  instance_id: string
  launch_id: string
  location: { id: string; kind: 'pc'; channel_id: string }
  users: string[]
}

/** Application emoji response. */
export interface ApplicationEmojiObject {
  id: string
  name: string
  user?: UserObject
  roles: string[]
  require_colons: boolean
  managed: boolean
  animated: boolean
  available: boolean
}

interface ApplicationEmojiRow {
  id: string
  application_id: string
  name: string
  user_id: string | null
  roles: string
  require_colons: number
  managed: number
  animated: number
  available: number
}

/** Test entitlement creation payload. */
export interface EntitlementCreatePayload {
  sku_id: string
  owner_id: string
  owner_type: 1 | 2
}

/** Entitlement list filters supported by the route. */
export interface EntitlementListOptions {
  userId?: string
  skuIds?: string[]
  guildId?: string
  before?: string
  after?: string
  limit?: number
  excludeEnded?: boolean
  excludeDeleted?: boolean
  onlyActive?: boolean
}

/** Discord-compatible entitlement response. */
export interface EntitlementObject {
  id: string
  sku_id: string
  application_id: string
  user_id: string | null
  guild_id: string | null
  deleted: boolean
  starts_at: string | null
  ends_at: string | null
  type: number
  fulfilled_at: string | null
  fulfillment_status: number | null
  consumed: boolean
  gifter_user_id: string | null
  parent_id: string | null
}

interface EntitlementRow {
  id: string
  sku_id: string
  application_id: string
  user_id: string | null
  guild_id: string | null
  deleted: number
  starts_at: string | null
  ends_at: string | null
  type: number
  fulfilled_at: string | null
  fulfillment_status: number | null
  consumed: number
  gifter_user_id: string | null
  parent_id: string | null
}

/** Application role connection metadata item. */
export interface RoleConnectionMetadataItem {
  type: number
  key: string
  name: string
  name_localizations?: Record<string, string> | null
  description: string
  description_localizations?: Record<string, string> | null
}

interface RoleConnectionMetadataRow {
  type: number
  key: string
  name: string
  name_localizations: string | null
  description: string
  description_localizations: string | null
}

/** Uploaded application attachment response. */
export interface ApplicationAttachmentObject {
  id: string
  filename: string
  size: number
  url: string
  proxy_url: string
  content_type: string
}

/** Converts a database user into an API response. */
function toUserObject(row: UserRow): UserObject {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    discriminator: row.discriminator,
    public_flags: 0,
    flags: 0,
    ...(row.bot === 1 && { bot: true }),
    global_name: null,
    primary_guild: null,
  }
}

/** Converts an application database row into an API response. */
function toApplicationObject(
  row: ApplicationRow,
  owner: UserRow,
  redirectUris: string[]
): ApplicationObject {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    type: row.type,
    ...(row.cover_image && { cover_image: row.cover_image }),
    ...(row.primary_sku_id && { primary_sku_id: row.primary_sku_id }),
    ...(row.guild_id && { guild_id: row.guild_id }),
    rpc_origins: JSON.parse(row.rpc_origins) as string[],
    bot_public: row.bot_public === 1,
    bot_require_code_grant: row.bot_require_code_grant === 1,
    ...(row.custom_install_url && {
      custom_install_url: row.custom_install_url,
    }),
    ...(row.install_params && {
      install_params: JSON.parse(row.install_params) as {
        scopes?: string[]
        permissions?: string
      },
    }),
    integration_types_config: JSON.parse(
      row.integration_types_config
    ) as Record<string, unknown>,
    verify_key: row.verify_key,
    flags: row.flags,
    flags_new: row.flags_new,
    max_participants: row.max_participants,
    tags: JSON.parse(row.tags) as string[],
    redirect_uris: redirectUris,
    interactions_endpoint_url: null,
    role_connections_verification_url: null,
    owner: toUserObject(owner),
    approximate_guild_count: 0,
    approximate_user_install_count: 0,
    approximate_user_authorization_count: 0,
    explicit_content_filter: 0,
    team: null,
    eligible_oauth2_scopes: [],
  }
}

/** Retrieves a private application by ID. */
export function getApplication(
  db: Database,
  applicationId: string
): ApplicationObject | null {
  const row = db
    .prepare('SELECT * FROM applications WHERE id = ?')
    .get(applicationId) as ApplicationRow | undefined
  if (!row) return null
  const owner = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(row.owner_id) as UserRow | undefined
  if (!owner) return null
  const client = db
    .prepare('SELECT redirect_uris FROM oauth2_clients WHERE client_id = ?')
    .get(applicationId) as { redirect_uris: string } | undefined
  return toApplicationObject(
    row,
    owner,
    client ? (JSON.parse(client.redirect_uris) as string[]) : []
  )
}

/** Updates mutable application fields and returns the stored profile. */
export function updateApplication(
  db: Database,
  applicationId: string,
  payload: ApplicationUpdatePayload
): ApplicationObject | null {
  if (!getApplication(db, applicationId)) return null
  const assignments: string[] = []
  const values: (string | number | null)[] = []
  const add = (column: string, value: string | number | null): void => {
    assignments.push(`${column} = ?`)
    values.push(value)
  }
  if (payload.description !== undefined) {
    add('description', payload.description?.default ?? '')
  }
  if (payload.icon !== undefined) add('icon', payload.icon)
  if (payload.cover_image !== undefined) add('cover_image', payload.cover_image)
  if (payload.flags !== undefined) add('flags', payload.flags ?? 0)
  if (payload.max_participants !== undefined) {
    add('max_participants', payload.max_participants)
  }
  if (payload.tags !== undefined)
    add('tags', JSON.stringify(payload.tags ?? []))
  if (payload.custom_install_url !== undefined) {
    add('custom_install_url', payload.custom_install_url)
  }
  if (payload.install_params !== undefined) {
    add(
      'install_params',
      payload.install_params === null
        ? null
        : JSON.stringify(payload.install_params)
    )
  }
  if (payload.integration_types_config !== undefined) {
    add(
      'integration_types_config',
      JSON.stringify(payload.integration_types_config ?? {})
    )
  }
  if (payload.type !== undefined) add('type', payload.type)
  if (assignments.length > 0) {
    db.prepare(
      `UPDATE applications SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).run(...values, applicationId)
  }
  return getApplication(db, applicationId)
}

/** Returns a deterministic local activity instance for an existing application. */
export function getActivityInstance(
  db: Database,
  applicationId: string,
  instanceId: string
): ActivityInstanceObject | null {
  const application = db
    .prepare('SELECT owner_id FROM applications WHERE id = ?')
    .get(applicationId) as { owner_id: string } | undefined
  if (!application) return null
  return {
    application_id: applicationId,
    instance_id: instanceId,
    launch_id: `launch-${instanceId}`,
    location: {
      id: `location-${instanceId}`,
      kind: 'pc',
      channel_id: applicationId,
    },
    users: [application.owner_id],
  }
}

/** Converts an application emoji row into an API response. */
function toApplicationEmojiObject(
  db: Database,
  row: ApplicationEmojiRow
): ApplicationEmojiObject {
  const user = row.user_id
    ? (db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as
        UserRow | undefined)
    : undefined
  return {
    id: row.id,
    name: row.name,
    ...(user && { user: toUserObject(user) }),
    roles: JSON.parse(row.roles) as string[],
    require_colons: row.require_colons === 1,
    managed: row.managed === 1,
    animated: row.animated === 1,
    available: row.available === 1,
  }
}

/** Lists all emojis owned by an application. */
export function listApplicationEmojis(
  db: Database,
  applicationId: string
): ApplicationEmojiObject[] {
  const rows = db
    .prepare(
      'SELECT * FROM application_emojis WHERE application_id = ? ORDER BY id'
    )
    .all(applicationId) as ApplicationEmojiRow[]
  return rows.map((row) => toApplicationEmojiObject(db, row))
}

/** Retrieves one application emoji in its owning application scope. */
export function getApplicationEmoji(
  db: Database,
  applicationId: string,
  emojiId: string
): ApplicationEmojiObject | null {
  const row = db
    .prepare(
      'SELECT * FROM application_emojis WHERE application_id = ? AND id = ?'
    )
    .get(applicationId, emojiId) as ApplicationEmojiRow | undefined
  return row ? toApplicationEmojiObject(db, row) : null
}

/** Creates an application emoji. */
export function createApplicationEmoji(
  db: Database,
  applicationId: string,
  userId: string,
  name: string
): ApplicationEmojiObject {
  const emojiId = generateSnowflake()
  db.prepare(
    `INSERT INTO application_emojis (id, application_id, name, user_id)
     VALUES (?, ?, ?, ?)`
  ).run(emojiId, applicationId, name, userId)
  const emoji = getApplicationEmoji(db, applicationId, emojiId)
  if (!emoji) throw new Error('Failed to create application emoji')
  return emoji
}

/** Updates the name of an application emoji. */
export function updateApplicationEmoji(
  db: Database,
  applicationId: string,
  emojiId: string,
  name: string
): ApplicationEmojiObject | null {
  const result = db
    .prepare(
      'UPDATE application_emojis SET name = ? WHERE application_id = ? AND id = ?'
    )
    .run(name, applicationId, emojiId)
  return result.changes === 0
    ? null
    : getApplicationEmoji(db, applicationId, emojiId)
}

/** Deletes an application emoji in its owning application scope. */
export function deleteApplicationEmoji(
  db: Database,
  applicationId: string,
  emojiId: string
): boolean {
  return (
    db
      .prepare(
        'DELETE FROM application_emojis WHERE application_id = ? AND id = ?'
      )
      .run(applicationId, emojiId).changes > 0
  )
}

/** Converts an entitlement row into an API response. */
function toEntitlementObject(row: EntitlementRow): EntitlementObject {
  return {
    id: row.id,
    sku_id: row.sku_id,
    application_id: row.application_id,
    user_id: row.user_id,
    guild_id: row.guild_id,
    deleted: row.deleted === 1,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    type: row.type,
    fulfilled_at: row.fulfilled_at,
    fulfillment_status: row.fulfillment_status,
    consumed: row.consumed === 1,
    gifter_user_id: row.gifter_user_id,
    parent_id: row.parent_id,
  }
}

/** Creates a test entitlement when the SKU and owner belong to local state. */
export function createEntitlement(
  db: Database,
  applicationId: string,
  payload: EntitlementCreatePayload
): EntitlementObject | null {
  const create = db.transaction(() => {
    const sku = db
      .prepare('SELECT id FROM skus WHERE id = ? AND application_id = ?')
      .get(payload.sku_id, applicationId)
    if (!sku) return null
    const table = payload.owner_type === 1 ? 'guilds' : 'users'
    if (
      !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(payload.owner_id)
    ) {
      return null
    }
    const entitlementId = generateSnowflake()
    db.prepare(
      `INSERT INTO entitlements
         (id, sku_id, application_id, user_id, guild_id, type)
       VALUES (?, ?, ?, ?, ?, 8)`
    ).run(
      entitlementId,
      payload.sku_id,
      applicationId,
      payload.owner_type === 2 ? payload.owner_id : null,
      payload.owner_type === 1 ? payload.owner_id : null
    )
    return entitlementId
  })
  const entitlementId = create()
  if (!entitlementId) return null
  const row = db
    .prepare('SELECT * FROM entitlements WHERE application_id = ? AND id = ?')
    .get(applicationId, entitlementId) as EntitlementRow
  return toEntitlementObject(row)
}

/** Lists application entitlements using Discord query filters. */
export function listEntitlements(
  db: Database,
  applicationId: string,
  options: EntitlementListOptions = {}
): EntitlementObject[] {
  const where = ['application_id = ?']
  const values: (string | number)[] = [applicationId]
  if (options.userId) {
    where.push('user_id = ?')
    values.push(options.userId)
  }
  if (options.guildId) {
    where.push('guild_id = ?')
    values.push(options.guildId)
  }
  if (options.skuIds && options.skuIds.length > 0) {
    where.push(`sku_id IN (${options.skuIds.map(() => '?').join(', ')})`)
    values.push(...options.skuIds)
  }
  if (options.before) {
    where.push('id < ?')
    values.push(options.before)
  }
  if (options.after) {
    where.push('id > ?')
    values.push(options.after)
  }
  if (options.excludeDeleted) where.push('deleted = 0')
  if (options.excludeEnded || options.onlyActive) {
    where.push("(ends_at IS NULL OR datetime(ends_at) > datetime('now'))")
  }
  if (options.onlyActive) {
    where.push("(starts_at IS NULL OR datetime(starts_at) <= datetime('now'))")
  }
  values.push(options.limit ?? 100)
  const rows = db
    .prepare(
      `SELECT * FROM entitlements WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`
    )
    .all(...values) as EntitlementRow[]
  return rows.map((row) => toEntitlementObject(row))
}

/** Retrieves one entitlement in its owning application scope. */
export function getEntitlement(
  db: Database,
  applicationId: string,
  entitlementId: string
): EntitlementObject | null {
  const row = db
    .prepare('SELECT * FROM entitlements WHERE application_id = ? AND id = ?')
    .get(applicationId, entitlementId) as EntitlementRow | undefined
  return row ? toEntitlementObject(row) : null
}

/** Deletes an entitlement transactionally. */
export function deleteEntitlement(
  db: Database,
  applicationId: string,
  entitlementId: string
): boolean {
  return db.transaction(() => {
    const result = db
      .prepare('DELETE FROM entitlements WHERE application_id = ? AND id = ?')
      .run(applicationId, entitlementId)
    return result.changes > 0
  })()
}

/** Marks an entitlement consumed and records its consumption transactionally. */
export function consumeEntitlement(
  db: Database,
  applicationId: string,
  entitlementId: string
): boolean {
  return db.transaction(() => {
    const result = db
      .prepare(
        'UPDATE entitlements SET consumed = 1 WHERE application_id = ? AND id = ?'
      )
      .run(applicationId, entitlementId)
    if (result.changes === 0) return false
    db.prepare(
      'INSERT OR IGNORE INTO entitlement_consumptions (entitlement_id) VALUES (?)'
    ).run(entitlementId)
    return true
  })()
}

/** Converts a role connection metadata row into an API response. */
function toRoleConnectionMetadataItem(
  row: RoleConnectionMetadataRow
): RoleConnectionMetadataItem {
  return {
    type: row.type,
    key: row.key,
    name: row.name,
    ...(row.name_localizations && {
      name_localizations: JSON.parse(row.name_localizations) as Record<
        string,
        string
      >,
    }),
    description: row.description,
    ...(row.description_localizations && {
      description_localizations: JSON.parse(
        row.description_localizations
      ) as Record<string, string>,
    }),
  }
}

/** Retrieves configured application role connection metadata. */
export function getRoleConnectionMetadata(
  db: Database,
  applicationId: string
): RoleConnectionMetadataItem[] {
  const rows = db
    .prepare(
      `SELECT type, key, name, name_localizations, description,
              description_localizations
       FROM application_role_connection_metadata
       WHERE application_id = ? ORDER BY rowid`
    )
    .all(applicationId) as RoleConnectionMetadataRow[]
  return rows.map((row) => toRoleConnectionMetadataItem(row))
}

/** Atomically replaces application role connection metadata. */
export function replaceRoleConnectionMetadata(
  db: Database,
  applicationId: string,
  metadata: RoleConnectionMetadataItem[]
): RoleConnectionMetadataItem[] {
  db.transaction(() => {
    db.prepare(
      'DELETE FROM application_role_connection_metadata WHERE application_id = ?'
    ).run(applicationId)
    const insert = db.prepare(
      `INSERT INTO application_role_connection_metadata
         (application_id, type, key, name, name_localizations, description,
          description_localizations)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const item of metadata) {
      insert.run(
        applicationId,
        item.type,
        item.key,
        item.name,
        item.name_localizations
          ? JSON.stringify(item.name_localizations)
          : null,
        item.description,
        item.description_localizations
          ? JSON.stringify(item.description_localizations)
          : null
      )
    }
  })()
  return getRoleConnectionMetadata(db, applicationId)
}

/** Stores an application attachment in the shared attachment asset tree. */
export async function saveApplicationAttachment(
  uploadPath: string,
  baseUrl: string,
  applicationId: string,
  filename: string,
  contentType: string,
  data: ArrayBuffer | Uint8Array
): Promise<ApplicationAttachmentObject> {
  const attachmentId = generateSnowflake()
  const safeFilename = path.basename(filename)
  const directory = path.join(uploadPath, applicationId, attachmentId)
  await mkdir(directory, { recursive: true })
  const buffer =
    data instanceof Uint8Array
      ? Buffer.from(data)
      : Buffer.from(new Uint8Array(data))
  await writeFile(path.join(directory, safeFilename), buffer)
  const url = `${baseUrl}/_mock/attachments/${applicationId}/${attachmentId}/${encodeURIComponent(safeFilename)}`
  return {
    id: attachmentId,
    filename: safeFilename,
    size: buffer.byteLength,
    url,
    proxy_url: url,
    content_type: contentType,
  }
}
