/**
 * Guild ban operations service
 *
 * Provides listing, retrieval, creation, and removal of guild bans.
 */

import type { Database } from '../db.js'
import { getUser, type UserObject } from './users.js'

/** Guild ban object for API responses (GuildBanResponse) */
export interface GuildBanObject {
  user: UserObject
  reason: string | null
}

/** Guild ban record type retrieved from the DB */
interface BanRow {
  guild_id: string
  user_id: string
  reason: string | null
}

/**
 * Resolves the user object for a ban. Falls back to a minimal schema-valid
 * user when the user is not present in the `users` table (Discord allows
 * banning users who are not, or never were, guild members).
 * @param db - Database
 * @param userId - Banned user ID
 * @returns User object for the ban response
 */
function resolveBanUser(db: Database, userId: string): UserObject {
  const user = getUser(db, userId)
  if (user) return user
  return {
    id: userId,
    username: 'Unknown User',
    discriminator: '0',
    avatar: null,
    bot: false,
    flags: 0,
    public_flags: 0,
    global_name: null,
    primary_guild: null,
  }
}

/**
 * Retrieves a single guild ban.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - Banned user ID
 * @returns Guild ban object, or null when no ban exists
 */
export function getGuildBan(
  db: Database,
  guildId: string,
  userId: string
): GuildBanObject | null {
  const row = db
    .prepare('SELECT * FROM guild_bans WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as BanRow | undefined
  if (!row) return null
  return { user: resolveBanUser(db, userId), reason: row.reason }
}

/**
 * Retrieves the list of bans for a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param limit - Number of items to retrieve (clamped to 1000, default 1000)
 * @param before - Pagination cursor; only bans with user_id lower than this
 * @param after - Pagination cursor; only bans with user_id greater than this
 * @returns Array of guild ban objects ordered by user_id ascending
 */
export function getGuildBans(
  db: Database,
  guildId: string,
  limit = 1000,
  before?: string,
  after?: string
): GuildBanObject[] {
  const clampedLimit = Math.min(limit, 1000)
  const conditions = ['guild_id = ?']
  const params: (string | number)[] = [guildId]
  if (after !== undefined) {
    conditions.push('user_id > ?')
    params.push(after)
  }
  if (before !== undefined) {
    conditions.push('user_id < ?')
    params.push(before)
  }
  params.push(clampedLimit)

  const rows = db
    .prepare(
      `SELECT * FROM guild_bans WHERE ${conditions.join(' AND ')}
       ORDER BY user_id ASC LIMIT ?`
    )
    .all(...params) as BanRow[]

  return rows.map((row) => ({
    user: resolveBanUser(db, row.user_id),
    reason: row.reason,
  }))
}

/**
 * Creates or updates a guild ban and removes the user's guild membership.
 * Banning a user implies kicking them, so their `guild_members` and
 * `member_roles` rows are deleted in the same transaction.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID to ban
 * @param reason - Ban reason (from the X-Audit-Log-Reason header), or null
 */
export function createGuildBan(
  db: Database,
  guildId: string,
  userId: string,
  reason: string | null
): void {
  const banUser = db.transaction(() => {
    db.prepare(
      `INSERT INTO guild_bans (guild_id, user_id, reason) VALUES (?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason`
    ).run(guildId, userId, reason)
    db.prepare(
      'DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?'
    ).run(guildId, userId)
    db.prepare(
      'DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?'
    ).run(guildId, userId)
  })
  banUser()
}

/**
 * Removes a guild ban (unban).
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - Banned user ID
 * @returns true on successful removal; false when no ban existed
 */
export function removeGuildBan(
  db: Database,
  guildId: string,
  userId: string
): boolean {
  const result = db
    .prepare('DELETE FROM guild_bans WHERE guild_id = ? AND user_id = ?')
    .run(guildId, userId)
  return result.changes > 0
}
