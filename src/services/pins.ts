/**
 * Message pin operations service
 *
 * Provides pin/unpin/list operations for channel message pins.
 */

import type { Database } from '../database'
import {
  hydrateMessageRow,
  type MessageRow,
  type MessageObject,
} from './messages'
import { toDiscordTimestamp } from '../timestamp'

/**
 * Retrieves the list of pinned messages.
 * @param database - Database
 * @param channelId - Channel ID
 * @param baseUrl - Base URL
 * @returns Array of message objects
 */
export function getPinnedMessages(
  database: Database,
  channelId: string,
  baseUrl: string
): MessageObject[] {
  const rows = database
    .prepare(
      `SELECT m.* FROM messages m
       JOIN pins p ON p.message_id = m.id
       WHERE p.channel_id = ?
       ORDER BY p.pinned_at ASC`
    )
    .all(channelId) as MessageRow[]

  return rows
    .map((r) => hydrateMessageRow(database, r, baseUrl))
    .filter((m): m is MessageObject => m !== null)
}

/** A pinned message paired with the timestamp it was pinned at. */
export interface PinnedMessageEntry {
  /** The pinned message object */
  message: MessageObject
  /** ISO-8601 UTC timestamp of when the message was pinned */
  pinnedAt: string
}

/**
 * Converts SQLite's naive "YYYY-MM-DD HH:MM:SS" UTC timestamp into an ISO-8601
 * UTC string. The space separator is normalized to "T" and a "Z" suffix is
 * appended so the value is parsed as UTC rather than the host's local timezone.
 * @param value - Naive UTC timestamp string from SQLite
 * @returns ISO-8601 UTC timestamp string
 */
function sqliteUtcToIso(value: string): string {
  return toDiscordTimestamp(new Date(`${value.replace(' ', 'T')}Z`))
}

/**
 * Retrieves pinned messages together with their pin timestamps using a single
 * joined query (avoiding a separate lookup of the `pins` table).
 * @param database - Database
 * @param channelId - Channel ID
 * @param baseUrl - Base URL
 * @returns Array of pinned message entries ordered by pin time (ascending)
 */
export function getPinnedMessageEntries(
  database: Database,
  channelId: string,
  baseUrl: string
): PinnedMessageEntry[] {
  const rows = database
    .prepare(
      `SELECT m.*, p.pinned_at AS pinned_at FROM messages m
       JOIN pins p ON p.message_id = m.id
       WHERE p.channel_id = ?
       ORDER BY p.pinned_at ASC`
    )
    .all(channelId) as (MessageRow & { pinned_at: string })[]

  const entries: PinnedMessageEntry[] = []
  for (const row of rows) {
    const message = hydrateMessageRow(database, row, baseUrl)
    if (message === null) continue
    entries.push({ message, pinnedAt: sqliteUtcToIso(row.pinned_at) })
  }
  return entries
}

/**
 * Pins a message.
 * @param database - Database
 * @param channelId - Channel ID
 * @param messageId - Message ID
 * @returns Error code (0 = success, 10008 = message not found, 30003 = limit reached, 50019 = different channel)
 */
export function pinMessage(
  database: Database,
  channelId: string,
  messageId: string
): 0 | 10_008 | 30_003 | 50_019 {
  // Verify the message is in the same channel
  const message = database
    .prepare('SELECT channel_id FROM messages WHERE id = ?')
    .get(messageId) as { channel_id: string } | undefined

  // Like real Discord, a nonexistent message returns 404 Unknown Message
  if (!message) return 10_008
  if (message.channel_id !== channelId) return 50_019

  // Pinning an already-pinned message is a no-op success, matching real
  // Discord's idempotent pin endpoint (relied on by discord.js/discord.py and
  // other client implementations). spec/openapi.json does not document this
  // case, but the spec's silence here is not evidence to the contrary.
  const existing = database
    .prepare('SELECT 1 FROM pins WHERE channel_id = ? AND message_id = ?')
    .get(channelId, messageId)
  if (existing) return 0

  // Limit check
  const count = (
    database
      .prepare('SELECT COUNT(*) as cnt FROM pins WHERE channel_id = ?')
      .get(channelId) as { cnt: number }
  ).cnt
  if (count >= 50) return 30_003

  database
    .prepare('INSERT INTO pins (channel_id, message_id) VALUES (?, ?)')
    .run(channelId, messageId)
  database.prepare('UPDATE messages SET pinned = 1 WHERE id = ?').run(messageId)
  return 0
}

/**
 * Unpins a message.
 * @param database - Database
 * @param channelId - Channel ID
 * @param messageId - Message ID
 */
export function unpinMessage(
  database: Database,
  channelId: string,
  messageId: string
): void {
  database
    .prepare('DELETE FROM pins WHERE channel_id = ? AND message_id = ?')
    .run(channelId, messageId)
  // Set pinned=0 unless still pinned in another channel
  const stillPinned = database
    .prepare('SELECT 1 FROM pins WHERE message_id = ?')
    .get(messageId)
  if (!stillPinned) {
    database
      .prepare('UPDATE messages SET pinned = 0 WHERE id = ?')
      .run(messageId)
  }
}
