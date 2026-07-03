/**
 * Message pin operations service
 *
 * Provides pin/unpin/list operations for channel message pins.
 */

import type { Database } from '../db.js'
import {
  hydrateMessageRow,
  type MessageRow,
  type MessageObject,
} from './messages.js'

/**
 * Retrieves the list of pinned messages.
 * @param db - Database
 * @param channelId - Channel ID
 * @param baseUrl - Base URL
 * @returns Array of message objects
 */
export function getPinnedMessages(
  db: Database,
  channelId: string,
  baseUrl: string
): MessageObject[] {
  const rows = db
    .prepare(
      `SELECT m.* FROM messages m
       JOIN pins p ON p.message_id = m.id
       WHERE p.channel_id = ?
       ORDER BY p.pinned_at ASC`
    )
    .all(channelId) as MessageRow[]

  return rows
    .map((r) => hydrateMessageRow(db, r, baseUrl))
    .filter((m): m is MessageObject => m !== null)
}

/**
 * Pins a message.
 * @param db - Database
 * @param channelId - Channel ID
 * @param messageId - Message ID
 * @returns Error code (0 = success, 10008 = message not found, 40041 = already pinned, 30003 = limit reached, 50019 = different channel)
 */
export function pinMessage(
  db: Database,
  channelId: string,
  messageId: string
): 0 | 10_008 | 40_041 | 30_003 | 50_019 {
  // Verify the message is in the same channel
  const msg = db
    .prepare('SELECT channel_id FROM messages WHERE id = ?')
    .get(messageId) as { channel_id: string } | undefined

  // Like real Discord, a nonexistent message returns 404 Unknown Message
  if (!msg) return 10_008
  if (msg.channel_id !== channelId) return 50_019

  // Already-pinned check
  const existing = db
    .prepare('SELECT 1 FROM pins WHERE channel_id = ? AND message_id = ?')
    .get(channelId, messageId)
  if (existing) return 40_041

  // Limit check
  const count = (
    db
      .prepare('SELECT COUNT(*) as cnt FROM pins WHERE channel_id = ?')
      .get(channelId) as { cnt: number }
  ).cnt
  if (count >= 50) return 30_003

  db.prepare('INSERT INTO pins (channel_id, message_id) VALUES (?, ?)').run(
    channelId,
    messageId
  )
  db.prepare('UPDATE messages SET pinned = 1 WHERE id = ?').run(messageId)
  return 0
}

/**
 * Unpins a message.
 * @param db - Database
 * @param channelId - Channel ID
 * @param messageId - Message ID
 */
export function unpinMessage(
  db: Database,
  channelId: string,
  messageId: string
): void {
  db.prepare('DELETE FROM pins WHERE channel_id = ? AND message_id = ?').run(
    channelId,
    messageId
  )
  // Set pinned=0 unless still pinned in another channel
  const stillPinned = db
    .prepare('SELECT 1 FROM pins WHERE message_id = ?')
    .get(messageId)
  if (!stillPinned) {
    db.prepare('UPDATE messages SET pinned = 0 WHERE id = ?').run(messageId)
  }
}
