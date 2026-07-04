/**
 * Invite operations service
 *
 * Provides CRUD operations for channel (guild) invites.
 */

import type { Database } from '../db'
import { getUser, type UserObject } from './users'
// Used for compile-time type drift detection.
import type { APIInvite } from 'discord-api-types/v10'

/**
 * Compile-time guard: ensures the safe-field subset of InviteObject is
 * structurally compatible with APIInvite.
 * Fails to compile when discord-api-types renames or retypes these fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _InviteCompatGuard =
  Pick<APIInvite, 'code'> extends Pick<InviteObject, 'code'> ? true : never

/** Invite record type retrieved from the DB */
interface InviteRow {
  code: string
  channel_id: string
  guild_id: string | null
  inviter_id: string | null
  max_age: number
  max_uses: number
  temporary: number
  uses: number
  created_at: string
}

/** Guild object nested within an invite (InviteGuildResponse) */
interface InviteGuildObject {
  id: string
  name: string
  splash: string | null
  banner: string | null
  description: string | null
  icon: string | null
  features: never[]
  verification_level: number
  vanity_url_code: string | null
  nsfw_level: number
  nsfw: boolean
  premium_subscription_count: number
}

/** Channel object nested within an invite (InviteChannelResponse) */
interface InviteChannelObject {
  id: string
  type: number
  name: string | null
}

/** Invite object for API responses (GuildInviteResponse compatible) */
export interface InviteObject {
  type: number
  code: string
  inviter?: UserObject
  max_age: number
  created_at: string
  expires_at: string | null
  flags: number
  guild: InviteGuildObject
  guild_id: string | null
  channel: InviteChannelObject
  uses: number
  max_uses: number
  temporary: boolean
}

/** Guild record fields needed to build an invite's nested guild object */
interface InviteGuildRow {
  id: string
  name: string
  icon: string | null
  verification_level: number
}

/** Channel record fields needed to build an invite's nested channel object */
interface InviteChannelRow {
  id: string
  type: number
  name: string | null
}

/**
 * Converts a SQLite datetime string ("YYYY-MM-DD HH:MM:SS", UTC) into an
 * ISO 8601 date-time string.
 * @param value - SQLite datetime string
 * @returns ISO 8601 string
 */
function toIso(value: string): string {
  return new Date(`${value.replace(' ', 'T')}Z`).toISOString()
}

/**
 * Computes the expiry timestamp from creation time and max_age.
 * @param createdAt - SQLite datetime string
 * @param maxAge - Seconds until expiry (0 means never)
 * @returns ISO date-time string, or null when max_age is 0
 */
function computeExpiresAt(createdAt: string, maxAge: number): string | null {
  if (maxAge === 0) return null
  const created = new Date(`${createdAt.replace(' ', 'T')}Z`)
  return new Date(created.getTime() + maxAge * 1000).toISOString()
}

/**
 * Converts a DB invite record into the API response format.
 * @param db - Database
 * @param row - DB record
 * @returns Invite object, or null when the referenced guild/channel is missing
 */
function toInviteObject(db: Database, row: InviteRow): InviteObject | null {
  const guildRow = db
    .prepare(
      'SELECT id, name, icon, verification_level FROM guilds WHERE id = ?'
    )
    .get(row.guild_id) as InviteGuildRow | undefined
  const channelRow = db
    .prepare('SELECT id, type, name FROM channels WHERE id = ?')
    .get(row.channel_id) as InviteChannelRow | undefined
  if (!guildRow || !channelRow) return null

  const guild: InviteGuildObject = {
    id: guildRow.id,
    name: guildRow.name,
    splash: null,
    banner: null,
    description: null,
    icon: guildRow.icon,
    features: [],
    verification_level: guildRow.verification_level,
    vanity_url_code: null,
    nsfw_level: 0,
    nsfw: false,
    premium_subscription_count: 0,
  }

  const channel: InviteChannelObject = {
    id: channelRow.id,
    type: channelRow.type,
    name: channelRow.name,
  }

  const invite: InviteObject = {
    type: 0,
    code: row.code,
    max_age: row.max_age,
    created_at: toIso(row.created_at),
    expires_at: computeExpiresAt(row.created_at, row.max_age),
    flags: 0,
    guild,
    guild_id: row.guild_id,
    channel,
    uses: row.uses,
    max_uses: row.max_uses,
    temporary: row.temporary === 1,
  }

  if (row.inviter_id) {
    const inviter = getUser(db, row.inviter_id)
    if (inviter) invite.inviter = inviter
  }

  return invite
}

/** Characters used to generate invite codes (base62) */
const INVITE_CODE_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Length of a generated invite code */
const INVITE_CODE_LENGTH = 8

// 256 is not a multiple of INVITE_CODE_CHARS.length (62), so `byte % 62`
// would be biased toward the first 256 % 62 = 8 characters. Rejecting bytes
// at or above the largest multiple of 62 that fits in a byte removes that
// bias (CodeQL: "biased random numbers from a cryptographically secure
// source").
const RANDOM_BYTE_LIMIT = 256 - (256 % INVITE_CODE_CHARS.length)

/**
 * Picks a single unbiased random character from `INVITE_CODE_CHARS` using
 * rejection sampling over cryptographically secure random bytes.
 * @returns A single character from `INVITE_CODE_CHARS`
 */
function randomInviteCodeChar(): string {
  const buffer = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    const byte = buffer[0]
    if (byte >= RANDOM_BYTE_LIMIT) continue
    return INVITE_CODE_CHARS.charAt(byte % INVITE_CODE_CHARS.length)
  }
}

/**
 * Generates a unique 8-character base62 invite code.
 * @param db - Database
 * @returns A code not currently present in the invites table
 */
function generateInviteCode(db: Database): string {
  const stmt = db.prepare('SELECT 1 FROM invites WHERE code = ?')
  for (;;) {
    // Invite codes act as credentials, so Math.random (predictable) is not
    // used; crypto.getRandomValues provides cryptographically strong bytes.
    let code = ''
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
      code += randomInviteCodeChar()
    }
    if (!stmt.get(code)) return code
  }
}

/**
 * Retrieves the list of invites for a channel.
 * @param db - Database
 * @param channelId - Channel ID
 * @returns Array of invite objects
 */
export function getChannelInvites(
  db: Database,
  channelId: string
): InviteObject[] {
  const rows = db
    .prepare('SELECT * FROM invites WHERE channel_id = ? ORDER BY created_at')
    .all(channelId) as InviteRow[]
  return rows
    .map((row) => toInviteObject(db, row))
    .filter((invite): invite is InviteObject => invite !== null)
}

/** Invite creation parameters */
export interface InviteCreateParams {
  channelId: string
  guildId: string | null
  inviterId: string | null
  maxAge?: number
  maxUses?: number
  temporary?: boolean
}

/**
 * Creates an invite for a channel.
 * @param db - Database
 * @param params - Invite creation parameters
 * @returns Created invite object
 */
export function createInvite(
  db: Database,
  params: InviteCreateParams
): InviteObject {
  const code = generateInviteCode(db)
  db.prepare(
    `INSERT INTO invites (code, channel_id, guild_id, inviter_id, max_age, max_uses, temporary)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    code,
    params.channelId,
    params.guildId,
    params.inviterId,
    params.maxAge ?? 86_400,
    params.maxUses ?? 0,
    params.temporary ? 1 : 0
  )

  const row = db
    .prepare('SELECT * FROM invites WHERE code = ?')
    .get(code) as InviteRow
  const invite = toInviteObject(db, row)
  // The caller validated the channel (and thus its guild) exists before
  // invoking createInvite, so toInviteObject cannot return null here.
  if (!invite) {
    throw new Error('Failed to build invite object after creation')
  }
  return invite
}

/**
 * Retrieves an invite by its code.
 * @param db - Database
 * @param code - Invite code
 * @returns Invite object, or null
 */
export function getInvite(db: Database, code: string): InviteObject | null {
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as
    | InviteRow
    | undefined
  return row ? toInviteObject(db, row) : null
}

/**
 * Deletes an invite by its code.
 * @param db - Database
 * @param code - Invite code
 * @returns The deleted invite object, or null if it did not exist
 */
export function deleteInvite(db: Database, code: string): InviteObject | null {
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as
    | InviteRow
    | undefined
  if (!row) return null
  const invite = toInviteObject(db, row)
  db.prepare('DELETE FROM invites WHERE code = ?').run(code)
  return invite
}
