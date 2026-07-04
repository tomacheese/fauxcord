/**
 * Message operations service
 *
 * Provides CRUD operations for messages, and a shared row-hydration helper
 * reused by the message-list, single-message, and pin-list queries.
 */

import type { Database } from '../db'
import { snowflakeToTimestamp } from '../snowflake'
// Used for compile-time type drift detection.
// When Renovate bumps discord-api-types, `pnpm lint:tsc` will fail if the
// safe-field subset of MessageResponse is renamed or retyped upstream.
import type { APIMessage } from 'discord-api-types/v10'

/**
 * Compile-time guard: ensures the safe-field subset of MessageObject is
 * structurally compatible with APIMessage.
 * Fails to compile when discord-api-types renames or retypes these fields.
 * String/boolean fields are checked here; numeric enum fields (type, flags)
 * use `number` in the mock for flexibility and are excluded from this check.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MessageCompatGuard =
  Pick<
    APIMessage,
    | 'id'
    | 'channel_id'
    | 'content'
    | 'timestamp'
    | 'edited_timestamp'
    | 'tts'
    | 'mention_everyone'
    | 'pinned'
  > extends Pick<
    MessageObject,
    | 'id'
    | 'channel_id'
    | 'content'
    | 'timestamp'
    | 'edited_timestamp'
    | 'tts'
    | 'mention_everyone'
    | 'pinned'
  >
    ? true
    : never

/** Message record type retrieved from the DB */
export interface MessageRow {
  id: string
  channel_id: string
  author_id: string
  author_token: string | null
  content: string
  tts: number
  mention_everyone: number
  pinned: number
  type: number
  flags: number
  referenced_message_id: string | null
  created_at: string
  edited_at: string | null
}

/** User record type retrieved from the DB */
export interface UserRow {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  bot: number
}

/** Embed record type retrieved from the DB */
interface EmbedRow {
  id: number
  message_id: string
  data: string
  position: number
}

/** Attachment record type retrieved from the DB */
interface AttachmentRow {
  id: string
  message_id: string
  filename: string
  size: number
  content_type: string
  file_path: string
}

/** Reaction aggregation record type retrieved from the DB */
interface ReactionAggRow {
  emoji: string
  count: number
}

/** Reaction object */
export interface ReactionObject {
  /** Reaction count */
  count: number
  /** Whether the requesting user has reacted (always false in the mock) */
  me: boolean
  /** Emoji information */
  emoji: {
    /** Custom emoji ID (null for standard emoji) */
    id: string | null
    /** Emoji string (Unicode emoji or custom emoji name) */
    name: string
  }
}

/** Message object for API responses */
export interface MessageObject {
  id: string
  channel_id: string
  author: {
    id: string
    username: string
    discriminator: string
    bot: boolean
    avatar: string | null
    /** Public flags bitset (always 0 in the mock) */
    public_flags: number
    /** Account flags bitset (always 0 in the mock) */
    flags: number
    /** Display name (always null in the mock) */
    global_name: string | null
    /** Primary guild info (always null in the mock) */
    primary_guild: string | null
  }
  content: string
  timestamp: string
  edited_timestamp: string | null
  tts: boolean
  mention_everyone: boolean
  mentions: never[]
  mention_roles: never[]
  attachments: AttachmentObject[]
  embeds: unknown[]
  /** Message components (slash command components, always empty in the mock) */
  components: never[]
  /** Reaction list (the field itself is omitted when there are no reactions) */
  reactions?: ReactionObject[]
  pinned: boolean
  type: number
  flags: number
  message_reference?: { message_id: string }
  /** Webhook ID when the message was sent via a webhook */
  webhook_id?: string
}

/** Attachment object for API responses */
export interface AttachmentObject {
  id: string
  filename: string
  size: number
  url: string
  proxy_url: string
  content_type: string
}

/**
 * Converts a DB message record into the API response format.
 * @param row - Message DB record
 * @param author - Author user record
 * @param embeds - Array of embed records
 * @param attachments - Array of attachment records
 * @param reactions - Array of reaction aggregation records
 * @param baseUrl - Base URL (for generating attachment URLs)
 * @returns Object for API responses
 */
export function toMessageObject(
  row: MessageRow,
  author: UserRow,
  embeds: EmbedRow[],
  attachments: AttachmentRow[],
  reactions: ReactionAggRow[],
  baseUrl: string
): MessageObject {
  const obj: MessageObject = {
    id: row.id,
    channel_id: row.channel_id,
    author: {
      id: author.id,
      username: author.username,
      discriminator: author.discriminator,
      bot: author.bot === 1,
      avatar: author.avatar,
      public_flags: 0,
      flags: 0,
      global_name: null,
      primary_guild: null,
    },
    content: row.content,
    timestamp: new Date(row.created_at).toISOString(),
    edited_timestamp: row.edited_at
      ? new Date(row.edited_at).toISOString()
      : null,
    tts: row.tts === 1,
    mention_everyone: row.mention_everyone === 1,
    mentions: [],
    mention_roles: [],
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      url: `${baseUrl}/_mock/attachments/${row.channel_id}/${row.id}/${a.filename}`,
      proxy_url: `${baseUrl}/_mock/attachments/${row.channel_id}/${row.id}/${a.filename}`,
      content_type: a.content_type,
    })),
    embeds: embeds
      .toSorted((a, b) => a.position - b.position)
      .map((e) => JSON.parse(e.data) as unknown),
    components: [],
    pinned: row.pinned === 1,
    type: row.type,
    flags: row.flags,
  }

  if (row.referenced_message_id) {
    obj.message_reference = { message_id: row.referenced_message_id }
  }

  // Add webhook_id to messages sent via webhook (author_id = webhook ID)
  if (row.author_token === 'webhook') {
    obj.webhook_id = row.author_id
  }

  // Add the reactions field only when reactions exist (conforming to the Discord API spec)
  if (reactions.length > 0) {
    obj.reactions = reactions.map((r) => ({
      count: r.count,
      me: false, // Always false in the mock (the requesting user is not identified)
      emoji: {
        id: null, // Always null because these are standard emoji
        name: r.emoji,
      },
    }))
  }

  return obj
}

/**
 * Loads a message row's related author/embeds/attachments/reactions and
 * converts it into the API response format. Returns null if the author no
 * longer exists (e.g. a deleted user), matching the filtering behavior the
 * call sites relied on before this helper existed.
 * @param db - Database
 * @param row - Message DB record
 * @param baseUrl - Base URL
 * @returns Message object, or null if the author record is missing
 */
export function hydrateMessageRow(
  db: Database,
  row: MessageRow,
  baseUrl: string
): MessageObject | null {
  const author = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(row.author_id) as UserRow | undefined
  if (!author) return null

  const embeds = db
    .prepare('SELECT * FROM embeds WHERE message_id = ? ORDER BY position')
    .all(row.id) as EmbedRow[]

  const attachments = db
    .prepare('SELECT * FROM attachments WHERE message_id = ?')
    .all(row.id) as AttachmentRow[]

  const reactions = db
    .prepare(
      'SELECT emoji, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY emoji'
    )
    .all(row.id) as ReactionAggRow[]

  return toMessageObject(row, author, embeds, attachments, reactions, baseUrl)
}

/**
 * Retrieves a message from the DB and converts it into the API response format.
 * @param db - Database
 * @param messageId - Message ID
 * @param baseUrl - Base URL
 * @returns Message object, or null if it does not exist
 */
export function getMessage(
  db: Database,
  messageId: string,
  baseUrl: string
): MessageObject | null {
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(messageId) as MessageRow | undefined
  if (!row) return null

  return hydrateMessageRow(db, row, baseUrl)
}

/** Query parameters for listing messages */
export interface MessageListParams {
  limit?: number
  before?: string
  after?: string
  around?: string
}

/**
 * Retrieves the list of messages in a channel.
 * @param db - Database
 * @param channelId - Channel ID
 * @param params - Pagination parameters
 * @param baseUrl - Base URL
 * @returns Array of message objects (newest first)
 */
export function getMessages(
  db: Database,
  channelId: string,
  params: MessageListParams,
  baseUrl: string
): MessageObject[] {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100)

  let query: string
  let queryParams: unknown[]

  if (params.before) {
    query =
      'SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
    queryParams = [channelId, params.before, limit]
  } else if (params.after) {
    query =
      'SELECT * FROM messages WHERE channel_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
    queryParams = [channelId, params.after, limit]
  } else if (params.around) {
    const half = Math.floor(limit / 2)
    // Messages before "around" (fetch half items in newest-first order)
    const beforeRows = db
      .prepare(
        'SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
      )
      .all(channelId, params.around, half) as MessageRow[]
    // Messages from "around" onward, inclusive (fetch (limit - half) items in oldest-first order)
    const afterRows = db
      .prepare(
        'SELECT * FROM messages WHERE channel_id = ? AND id >= ? ORDER BY id ASC LIMIT ?'
      )
      .all(channelId, params.around, limit - half) as MessageRow[]
    // beforeRows is fetched in descending (newest-first) order and afterRows in ascending (oldest-first) order,
    // so reverse afterRows to align with descending order, then concatenate afterRows → beforeRows
    // so the whole list is newest-first (descending)
    const rows = [...afterRows.toReversed(), ...beforeRows]

    return rows
      .map((r) => hydrateMessageRow(db, r, baseUrl))
      .filter((m): m is MessageObject => m !== null)
  } else {
    query =
      'SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?'
    queryParams = [channelId, limit]
  }

  const rows = db.prepare(query).all(...queryParams) as MessageRow[]

  // "after" is fetched in oldest-first (ASC) order, so reverse it to newest-first.
  // "before" and the default case are already fetched in descending (DESC) order, so return as-is
  const orderedRows = params.after ? rows.toReversed() : rows

  return orderedRows
    .map((r) => hydrateMessageRow(db, r, baseUrl))
    .filter((m): m is MessageObject => m !== null)
}

/** Message creation parameters */
export interface MessageCreateParams {
  channelId: string
  authorId: string
  authorToken: string
  messageId: string
  content?: string
  tts?: boolean
  embeds?: unknown[]
  messageReference?: { message_id?: string }
  flags?: number
}

/**
 * Creates a message.
 * @param db - Database
 * @param params - Message creation parameters
 * @param baseUrl - Base URL
 * @returns Created message object
 */
export function createMessage(
  db: Database,
  params: MessageCreateParams,
  baseUrl: string
): MessageObject {
  db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, author_token, content, tts, flags, referenced_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.messageId,
    params.channelId,
    params.authorId,
    params.authorToken,
    params.content ?? '',
    params.tts ? 1 : 0,
    params.flags ?? 0,
    params.messageReference?.message_id ?? null
  )

  // Save embeds
  if (params.embeds) {
    for (let i = 0; i < params.embeds.length; i++) {
      db.prepare(
        'INSERT INTO embeds (message_id, data, position) VALUES (?, ?, ?)'
      ).run(params.messageId, JSON.stringify(params.embeds[i]), i)
    }
  }

  // Update the channel's last_message_id
  db.prepare('UPDATE channels SET last_message_id = ? WHERE id = ?').run(
    params.messageId,
    params.channelId
  )

  const msg = getMessage(db, params.messageId, baseUrl)
  if (!msg) throw new Error('Failed to create message')
  return msg
}

/**
 * Updates a message.
 * @param db - Database
 * @param messageId - Message ID
 * @param payload - Update payload
 * @param baseUrl - Base URL
 * @returns Updated message object
 */
export function updateMessage(
  db: Database,
  messageId: string,
  payload: { content?: string; embeds?: unknown[] | null },
  baseUrl: string
): MessageObject | null {
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(messageId) as MessageRow | undefined
  if (!row) return null

  if (payload.content !== undefined) {
    db.prepare(
      "UPDATE messages SET content = ?, edited_at = datetime('now') WHERE id = ?"
    ).run(payload.content, messageId)
  }

  // null is equivalent to an empty array (delete all embeds). undefined means "no change" and is ignored
  if (payload.embeds !== undefined) {
    db.prepare('DELETE FROM embeds WHERE message_id = ?').run(messageId)
    const embedsArray = Array.isArray(payload.embeds) ? payload.embeds : []
    for (const [i, element] of embedsArray.entries()) {
      db.prepare(
        'INSERT INTO embeds (message_id, data, position) VALUES (?, ?, ?)'
      ).run(messageId, JSON.stringify(element), i)
    }
  }

  return getMessage(db, messageId, baseUrl)
}

/**
 * Deletes a message. When `channelId` is provided, the deletion is scoped to
 * that channel so a message can only be removed through the channel it belongs
 * to (matching Discord's per-channel message endpoints).
 * @param db - Database
 * @param messageId - Message ID
 * @param channelId - Optional channel ID the message must belong to
 * @returns true on successful deletion
 */
export function deleteMessage(
  db: Database,
  messageId: string,
  channelId?: string
): boolean {
  const result =
    channelId === undefined
      ? db.prepare('DELETE FROM messages WHERE id = ?').run(messageId)
      : db
          .prepare('DELETE FROM messages WHERE id = ? AND channel_id = ?')
          .run(messageId, channelId)
  return result.changes > 0
}

/** Two-week timestamp (milliseconds) */
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Checks whether a message is older than 2 weeks.
 *
 * Like the real Discord API, the elapsed time is determined from the timestamp
 * embedded in the Snowflake ID, regardless of whether the message exists.
 * @param db - Database
 * @param messageId - Message ID
 * @returns true if older than 2 weeks
 */
export function isTooOldForBulkDelete(
  db: Database,
  messageId: string
): boolean {
  // Recover the timestamp from the Snowflake ID to make the determination (same behavior as real Discord)
  try {
    const createdAt = snowflakeToTimestamp(messageId).getTime()
    return Date.now() - createdAt > TWO_WEEKS_MS
  } catch {
    // For IDs that cannot be interpreted as Snowflakes, fall back to the DB's created_at
    const row = db
      .prepare('SELECT created_at FROM messages WHERE id = ?')
      .get(messageId) as { created_at: string } | undefined
    if (!row) return false

    const createdAt = new Date(row.created_at).getTime()
    return Date.now() - createdAt > TWO_WEEKS_MS
  }
}
