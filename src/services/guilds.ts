/**
 * Guild操作サービス
 *
 * GuildのCRUD操作・メンバー・ロール管理を提供します。
 */

import type { Database } from '../db.js'

/** DBから取得したGuildレコードの型 */
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

/** DBから取得したRoleレコードの型 */
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

/** APIレスポンス用Guildオブジェクト */
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

/** APIレスポンス用Roleオブジェクト */
export interface RoleObject {
  id: string
  name: string
  color: number
  hoist: boolean
  position: number
  permissions: string
  managed: boolean
  mentionable: boolean
}

/**
 * DBのRoleレコードをAPIレスポンス形式に変換します。
 * @param row - DBレコード
 * @returns APIレスポンス用オブジェクト
 */
function toRoleObject(row: RoleRow): RoleObject {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    hoist: row.hoist === 1,
    position: row.position,
    permissions: row.permissions,
    managed: row.managed === 1,
    mentionable: row.mentionable === 1,
  }
}

/**
 * DBのGuildレコードをAPIレスポンス形式に変換します。
 * @param row - DBレコード
 * @param roles - Roleオブジェクトの配列
 * @returns APIレスポンス用オブジェクト
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
 * GuildをIDで取得します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param withCounts - approximate_member_countを含めるか
 * @returns GuildオブジェクトまたはNull
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

/** Guild更新パラメータ */
export interface GuildUpdateParams {
  name?: string
}

/**
 * Guildを更新します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param payload - 更新内容
 * @returns 更新後のGuildオブジェクトまたはNull（Guild不存在時）
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
 * Guildを削除します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @returns 削除成功ならtrue（Guild不存在時はfalse）
 */
export function deleteGuild(db: Database, guildId: string): boolean {
  const result = db.prepare('DELETE FROM guilds WHERE id = ?').run(guildId)
  return result.changes > 0
}

/**
 * Botが参加しているGuild一覧を取得します（/users/@me/guilds用）。
 * @param db - データベース
 * @param botToken - BotトークンのBot xxx形式
 * @returns Guild概要オブジェクトの配列
 */
export function getBotGuilds(
  db: Database,
  botToken: string
): {
  id: string
  name: string
  icon: string | null
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
    owner: false,
    permissions: '0',
    features: [],
  }))
}

/**
 * Guildのロール一覧を取得します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @returns Roleオブジェクトの配列
 */
export function getGuildRoles(db: Database, guildId: string): RoleObject[] {
  const rows = db
    .prepare('SELECT * FROM roles WHERE guild_id = ? ORDER BY position')
    .all(guildId) as RoleRow[]
  return rows.map((r) => toRoleObject(r))
}

/** ロール作成パラメータ */
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
 * Guildにロールを作成します。
 * @param db - データベース
 * @param params - ロール作成パラメータ
 * @returns 作成したRoleオブジェクト
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
 * Guildのロールを1件取得します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @returns RoleオブジェクトまたはNull
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

/** ロール更新パラメータ */
export interface RoleUpdateParams {
  name?: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
  permissions?: string
}

/**
 * Guildのロールを更新します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @param payload - 更新内容
 * @returns 更新後のRoleオブジェクトまたはNull（Role不存在時）
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
 * Guildのロールを削除します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param roleId - Role ID
 * @returns 削除成功ならtrue（Role不存在時はfalse）
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

/** メンバーレコードの型 */
interface MemberRow {
  guild_id: string
  user_id: string
  nick: string | null
  joined_at: string
  deaf: number
  mute: number
  flags: number
}

/** APIレスポンス用GuildMemberオブジェクト */
export interface GuildMemberObject {
  user: {
    id: string
    username: string
    discriminator: string
    avatar: string | null
    bot: boolean
  }
  nick: string | null
  roles: string[]
  joined_at: string
  deaf: boolean
  mute: boolean
  flags: number
}

/**
 * メンバーに付与されているロールID一覧を取得します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param userId - ユーザーID
 * @returns ロールIDの配列
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
 * GuildメンバーをIDで取得します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param userId - ユーザーID
 * @returns GuildMemberオブジェクトまたはNull
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
    user: {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
      bot: user.bot === 1,
    },
    nick: member.nick,
    roles: getMemberRoleIds(db, guildId, userId),
    joined_at: new Date(member.joined_at).toISOString(),
    deaf: member.deaf === 1,
    mute: member.mute === 1,
    flags: member.flags,
  }
}

/**
 * Guildメンバー一覧を取得します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param limit - 取得件数（最大1000）
 * @param after - ページネーション
 * @returns GuildMemberオブジェクトの配列
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
    user: {
      id: m.user_id,
      username: m.username,
      discriminator: m.discriminator,
      avatar: m.avatar,
      bot: m.bot === 1,
    },
    nick: m.nick,
    roles: getMemberRoleIds(db, guildId, m.user_id),
    joined_at: new Date(m.joined_at).toISOString(),
    deaf: m.deaf === 1,
    mute: m.mute === 1,
    flags: m.flags,
  }))
}

/** メンバー更新パラメータ */
export interface GuildMemberUpdateParams {
  /** ニックネーム（nullでクリア） */
  nick?: string | null
  /** 付与するロールIDの配列（全置換） */
  roles?: string[]
}

/**
 * Guildメンバーを更新します（ニックネーム・ロール）。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param userId - ユーザーID
 * @param payload - 更新内容
 * @returns 更新後のGuildMemberオブジェクトまたはNull（メンバー不存在時）
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
    // ロールを全置換する
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
 * Guildメンバーを削除（キック）します。
 * @param db - データベース
 * @param guildId - Guild ID
 * @param userId - ユーザーID
 * @returns 削除成功ならtrue（メンバー不存在時はfalse）
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

  // メンバーに付与されていたロールの割り当ても削除する
  db.prepare('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?').run(
    guildId,
    userId
  )
  return true
}
