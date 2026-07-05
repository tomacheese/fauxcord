/**
 * Reaction operations service
 *
 * Provides add/remove/list operations for message reactions.
 */

import type { Database } from '../db'
import type { UserRow } from './messages'
import { gatewayBus } from '../gateway/bus'
import { getGuildIdForChannel } from './messages'

/**
 * Gets the channel ID that a message belongs to, given its message ID.
 * @param db - Database
 * @param messageId - Message ID
 * @returns Channel ID, or undefined if the message doesn't exist
 */
function getChannelIdForMessage(
  db: Database,
  messageId: string
): string | undefined {
  const row = db
    .prepare('SELECT channel_id FROM messages WHERE id = ?')
    .get(messageId) as { channel_id: string } | undefined
  return row?.channel_id
}

/**
 * Adds a reaction.
 * @param db - Database
 * @param messageId - Message ID
 * @param userId - User ID
 * @param emoji - Emoji
 * @returns true on successful addition
 */
export function addReaction(
  db: Database,
  messageId: string,
  userId: string,
  emoji: string
): boolean {
  try {
    db.prepare(
      'INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
    ).run(messageId, userId, emoji)
  } catch {
    return false
  }

  // Gateway emission happens outside the try/catch so a listener throwing
  // synchronously cannot make this function incorrectly report a DB failure.
  const channelId = getChannelIdForMessage(db, messageId)
  if (channelId !== undefined) {
    gatewayBus.emit('message.reaction.add', {
      guildId: getGuildIdForChannel(db, channelId),
      channelId,
      messageId,
      userId,
      emoji: { id: null, name: emoji },
    })
  }

  return true
}

/**
 * Removes a reaction (the user's own reaction).
 * @param db - Database
 * @param messageId - Message ID
 * @param userId - User ID
 * @param emoji - Emoji
 */
export function removeReaction(
  db: Database,
  messageId: string,
  userId: string,
  emoji: string
): void {
  db.prepare(
    'DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).run(messageId, userId, emoji)

  const channelId = getChannelIdForMessage(db, messageId)
  if (channelId !== undefined) {
    gatewayBus.emit('message.reaction.remove', {
      guildId: getGuildIdForChannel(db, channelId),
      channelId,
      messageId,
      userId,
      emoji: { id: null, name: emoji },
    })
  }
}

/**
 * Removes all reactions for the specified emoji.
 * @param db - Database
 * @param messageId - Message ID
 * @param emoji - Emoji
 */
export function removeEmojiReactions(
  db: Database,
  messageId: string,
  emoji: string
): void {
  db.prepare('DELETE FROM reactions WHERE message_id = ? AND emoji = ?').run(
    messageId,
    emoji
  )
}

/**
 * Removes all reactions from a message.
 * @param db - Database
 * @param messageId - Message ID
 */
export function removeAllReactions(db: Database, messageId: string): void {
  db.prepare('DELETE FROM reactions WHERE message_id = ?').run(messageId)
}

/**
 * Retrieves the list of users who reacted.
 * @param db - Database
 * @param messageId - Message ID
 * @param emoji - Emoji
 * @param limit - Number of items to retrieve (clamped to 100, default 25)
 * @param after - Pagination cursor (user ID)
 * @returns Array of user records
 */
export function getReactionUsers(
  db: Database,
  messageId: string,
  emoji: string,
  limit = 25,
  after?: string
): UserRow[] {
  const clampedLimit = Math.min(limit, 100)
  if (after) {
    return db
      .prepare(
        `SELECT u.* FROM users u
         JOIN reactions r ON r.user_id = u.id
         WHERE r.message_id = ? AND r.emoji = ? AND u.id > ?
         ORDER BY u.id ASC LIMIT ?`
      )
      .all(messageId, emoji, after, clampedLimit) as UserRow[]
  }
  return db
    .prepare(
      `SELECT u.* FROM users u
       JOIN reactions r ON r.user_id = u.id
       WHERE r.message_id = ? AND r.emoji = ?
       ORDER BY u.id ASC LIMIT ?`
    )
    .all(messageId, emoji, clampedLimit) as UserRow[]
}
