/**
 * Reaction operations service
 *
 * Provides add/remove/list operations for message reactions.
 */

import type { Database } from '../database'
import type { UserRow } from './messages'
import { gatewayBus } from '../gateway/bus'
import { getGuildIdForChannel } from './messages'

/**
 * Gets the channel ID that a message belongs to, given its message ID.
 * @param database - Database
 * @param messageId - Message ID
 * @returns Channel ID, or undefined if the message doesn't exist
 */
function getChannelIdForMessage(
  database: Database,
  messageId: string
): string | undefined {
  const row = database
    .prepare('SELECT channel_id FROM messages WHERE id = ?')
    .get(messageId) as { channel_id: string } | undefined
  return row?.channel_id
}

/**
 * Adds a reaction.
 * @param database - Database
 * @param messageId - Message ID
 * @param userId - User ID
 * @param emoji - Emoji
 * @returns true on successful addition
 */
export function didAddReaction(
  database: Database,
  messageId: string,
  userId: string,
  emoji: string
): boolean {
  let isInserted: boolean
  try {
    const result = database
      .prepare(
        'INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
      )
      .run(messageId, userId, emoji)
    isInserted = result.changes > 0
  } catch {
    return false
  }

  // Gateway emission happens outside the try/catch so a listener throwing
  // synchronously cannot make this function incorrectly report a DB failure.
  // Only emit when the row was actually inserted, so a duplicate reaction
  // (INSERT OR IGNORE with no state change) does not produce a spurious
  // MESSAGE_REACTION_ADD dispatch.
  if (isInserted) {
    const channelId = getChannelIdForMessage(database, messageId)
    if (channelId !== undefined) {
      gatewayBus.emit('message.reaction.add', {
        guildId: getGuildIdForChannel(database, channelId),
        channelId,
        messageId,
        userId,
        emoji: { id: null, name: emoji },
      })
    }
  }

  return true
}

/**
 * Removes a reaction (the user's own reaction).
 * @param database - Database
 * @param messageId - Message ID
 * @param userId - User ID
 * @param emoji - Emoji
 */
export function removeReaction(
  database: Database,
  messageId: string,
  userId: string,
  emoji: string
): void {
  const result = database
    .prepare(
      'DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    )
    .run(messageId, userId, emoji)

  // Only emit when a reaction was actually deleted, so removing a
  // non-existent reaction does not produce a misleading
  // MESSAGE_REACTION_REMOVE dispatch.
  if (result.changes > 0) {
    const channelId = getChannelIdForMessage(database, messageId)
    if (channelId !== undefined) {
      gatewayBus.emit('message.reaction.remove', {
        guildId: getGuildIdForChannel(database, channelId),
        channelId,
        messageId,
        userId,
        emoji: { id: null, name: emoji },
      })
    }
  }
}

/**
 * Removes all reactions for the specified emoji.
 * @param database - Database
 * @param messageId - Message ID
 * @param emoji - Emoji
 */
export function removeEmojiReactions(
  database: Database,
  messageId: string,
  emoji: string
): void {
  database
    .prepare('DELETE FROM reactions WHERE message_id = ? AND emoji = ?')
    .run(messageId, emoji)
}

/**
 * Removes all reactions from a message.
 * @param database - Database
 * @param messageId - Message ID
 */
export function removeAllReactions(
  database: Database,
  messageId: string
): void {
  database.prepare('DELETE FROM reactions WHERE message_id = ?').run(messageId)
}

/**
 * Retrieves the list of users who reacted.
 * @param database - Database
 * @param messageId - Message ID
 * @param emoji - Emoji
 * @param limit - Number of items to retrieve (clamped to 100, default 25)
 * @param after - Pagination cursor (user ID)
 * @returns Array of user records
 */
export function getReactionUsers(
  database: Database,
  messageId: string,
  emoji: string,
  limit = 25,
  after?: string
): UserRow[] {
  const clampedLimit = Math.min(limit, 100)
  if (after) {
    return database
      .prepare(
        `SELECT u.* FROM users u
         JOIN reactions r ON r.user_id = u.id
         WHERE r.message_id = ? AND r.emoji = ? AND u.id > ?
         ORDER BY u.id ASC LIMIT ?`
      )
      .all(messageId, emoji, after, clampedLimit) as UserRow[]
  }
  return database
    .prepare(
      `SELECT u.* FROM users u
       JOIN reactions r ON r.user_id = u.id
       WHERE r.message_id = ? AND r.emoji = ?
       ORDER BY u.id ASC LIMIT ?`
    )
    .all(messageId, emoji, clampedLimit) as UserRow[]
}
