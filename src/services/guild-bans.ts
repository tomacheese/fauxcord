/**
 * Guild ban operations service
 *
 * Provides listing, retrieval, creation, and removal of guild bans.
 */

import type { Database } from '../database'
import { getUser, type UserObject } from './users'

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
 * @param database - Database
 * @param userId - Banned user ID
 * @returns User object for the ban response
 */
function resolveBanUser(database: Database, userId: string): UserObject {
  const user = getUser(database, userId)
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
 * @param database - Database
 * @param guildId - Guild ID
 * @param userId - Banned user ID
 * @returns Guild ban object, or null when no ban exists
 */
export function getGuildBan(
  database: Database,
  guildId: string,
  userId: string
): GuildBanObject | null {
  const row = database
    .prepare('SELECT * FROM guild_bans WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as BanRow | undefined
  if (!row) return null
  return { user: resolveBanUser(database, userId), reason: row.reason }
}

/**
 * Retrieves the list of bans for a guild.
 * @param database - Database
 * @param guildId - Guild ID
 * @param limit - Number of items to retrieve (clamped to 1000, default 1000)
 * @param before - Pagination cursor; only bans with user_id lower than this
 * @param after - Pagination cursor; only bans with user_id greater than this
 * @returns Array of guild ban objects ordered by user_id ascending
 */
export function getGuildBans(
  database: Database,
  guildId: string,
  limit = 1000,
  before?: string,
  after?: string
): GuildBanObject[] {
  const clampedLimit = Math.min(limit, 1000)
  const conditions = ['guild_id = ?']
  const parameters: (string | number)[] = [guildId]
  if (after !== undefined) {
    conditions.push('user_id > ?')
    parameters.push(after)
  }
  if (before !== undefined) {
    conditions.push('user_id < ?')
    parameters.push(before)
  }
  parameters.push(clampedLimit)

  const rows = database
    .prepare(
      `SELECT * FROM guild_bans WHERE ${conditions.join(' AND ')}
       ORDER BY user_id ASC LIMIT ?`
    )
    .all(...parameters) as BanRow[]

  return rows.map((row) => ({
    user: resolveBanUser(database, row.user_id),
    reason: row.reason,
  }))
}

/**
 * Creates or updates a guild ban and removes the user's guild membership.
 * Banning a user implies kicking them, so their `guild_members` and
 * `member_roles` rows are deleted in the same transaction. When
 * `messageDeleteSeconds` is greater than 0, the banned user's messages in the
 * guild's channels newer than that window are also deleted (matching Discord's
 * `delete_message_seconds` behavior).
 * @param database - Database
 * @param guildId - Guild ID
 * @param userId - User ID to ban
 * @param reason - Ban reason (from the X-Audit-Log-Reason header), or null
 * @param messageDeleteSeconds - Age window (seconds) of the user's messages to delete
 */
export function createGuildBan(
  database: Database,
  guildId: string,
  userId: string,
  reason: string | null,
  messageDeleteSeconds = 0
): void {
  const banUser = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO guild_bans (guild_id, user_id, reason) VALUES (?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason`
      )
      .run(guildId, userId, reason)
    database
      .prepare('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?')
      .run(guildId, userId)
    database
      .prepare('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?')
      .run(guildId, userId)
    if (messageDeleteSeconds > 0) {
      database
        .prepare(
          `DELETE FROM messages
         WHERE author_id = ?
           AND channel_id IN (SELECT id FROM channels WHERE guild_id = ?)
           AND created_at >= datetime('now', ?)`
        )
        .run(userId, guildId, `-${messageDeleteSeconds} seconds`)
    }
  })
  banUser()
}

/**
 * Removes a guild ban (unban).
 * @param database - Database
 * @param guildId - Guild ID
 * @param userId - Banned user ID
 * @returns true on successful removal; false when no ban existed
 */
export function didRemoveGuildBan(
  database: Database,
  guildId: string,
  userId: string
): boolean {
  const result = database
    .prepare('DELETE FROM guild_bans WHERE guild_id = ? AND user_id = ?')
    .run(guildId, userId)
  return result.changes > 0
}
