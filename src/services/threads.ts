/**
 * Thread operations service
 *
 * Threads are stored as rows in the `channels` table (type 10/11/12) with
 * additional thread-specific columns, plus a `thread_members` join table.
 */

import type { Database } from '../database'
import { generateSnowflake } from '../snowflake'
import { toDiscordTimestamp } from '../timestamp'
import { THREAD_AUTO_ARCHIVE_DURATIONS } from '../validators/thread'
import { getGuildMember, type GuildMemberObject } from './guild-members'

/** Default thread type when the request omits `type` (Public Thread). */
const DEFAULT_THREAD_TYPE = 11

/** Thread (channel) record retrieved from the DB. */
export interface ThreadRow {
  id: string
  guild_id: string | null
  type: number
  name: string | null
  parent_id: string | null
  owner_id: string | null
  rate_limit_per_user: number
  last_message_id: string | null
  archived: number
  auto_archive_duration: number
  locked: number
  invitable: number
  archive_timestamp: string | null
  created_at: string
}

/** Thread member record retrieved from the DB. */
export interface ThreadMemberRow {
  thread_id: string
  user_id: string
  join_timestamp: string
  flags: number
}

/** Thread metadata sub-object (ThreadMetadataResponse). */
export interface ThreadMetadataObject {
  archived: boolean
  // Discord's spec (discord-api-types APIThreadMetadata) declares this a
  // non-nullable string: it is set at thread creation time and only updated
  // when the archived state changes, never left null.
  archive_timestamp: string
  auto_archive_duration: number
  locked: boolean
  create_timestamp: string
  invitable: boolean
}

/** Thread object for API responses (CreatedThreadResponse / ThreadResponse). */
export interface ThreadObject {
  id: string
  type: number
  /** Channel flags bitset (always 0 in the mock) */
  flags: number
  guild_id: string | null
  name: string | null
  parent_id: string | null
  owner_id: string | null
  rate_limit_per_user: number
  last_message_id: string | null
  message_count: number
  member_count: number
  total_message_sent: number
  thread_metadata: ThreadMetadataObject
}

/** Thread member object for API responses (ThreadMemberResponse). */
export interface ThreadMemberObject {
  id: string
  user_id: string
  join_timestamp: string
  flags: number
  // Only present when the request set `with_member=true` (matches real
  // Discord's `GET /channels/{channel_id}/thread-members[/{user_id}]`).
  // JDA's EntityBuilder.createThreadMember always requests this and throws
  // a DataObjectParsingException if the `member` key is absent entirely.
  member?: GuildMemberObject
}

/**
 * Normalizes an arbitrary auto-archive-duration value to a value in
 * `THREAD_AUTO_ARCHIVE_DURATIONS`, defaulting to 1440 (one day) when invalid.
 * @param value - Raw value from the request or DB
 * @returns A valid ThreadAutoArchiveDuration
 */
export function normalizeAutoArchiveDuration(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return (THREAD_AUTO_ARCHIVE_DURATIONS as readonly number[]).includes(n)
    ? n
    : 1440
}

/**
 * Converts a thread DB row into the API response format, computing message and
 * member counts from related tables.
 * @param database - Database
 * @param row - Thread DB record
 * @returns Thread object for API responses
 */
export function toThreadObject(
  database: Database,
  row: ThreadRow
): ThreadObject {
  const messageCount = (
    database
      .prepare('SELECT COUNT(*) AS c FROM messages WHERE channel_id = ?')
      .get(row.id) as { c: number }
  ).c
  const memberCount = (
    database
      .prepare('SELECT COUNT(*) AS c FROM thread_members WHERE thread_id = ?')
      .get(row.id) as { c: number }
  ).c

  return {
    id: row.id,
    type: row.type,
    flags: 0,
    guild_id: row.guild_id,
    name: row.name,
    parent_id: row.parent_id,
    owner_id: row.owner_id,
    rate_limit_per_user: row.rate_limit_per_user,
    last_message_id: row.last_message_id,
    message_count: messageCount,
    member_count: memberCount,
    total_message_sent: messageCount,
    thread_metadata: {
      archived: row.archived === 1,
      // Falls back to the creation timestamp when never explicitly archived
      // (matches real Discord: archive_timestamp starts at creation time and
      // is never null — confirmed via discord-api-types' APIThreadMetadata).
      archive_timestamp: toDiscordTimestamp(
        new Date(row.archive_timestamp ?? row.created_at)
      ),
      auto_archive_duration: normalizeAutoArchiveDuration(
        row.auto_archive_duration
      ),
      locked: row.locked === 1,
      create_timestamp: toDiscordTimestamp(new Date(row.created_at)),
      invitable: row.invitable === 1,
    },
  }
}

/**
 * Converts a thread member DB row into the API response format.
 * @param row - Thread member DB record
 * @returns Thread member object for API responses
 */
export function toThreadMemberObject(
  row: ThreadMemberRow,
  member?: GuildMemberObject
): ThreadMemberObject {
  return {
    id: row.thread_id,
    user_id: row.user_id,
    join_timestamp: toDiscordTimestamp(new Date(row.join_timestamp)),
    flags: row.flags,
    ...(member && { member }),
  }
}

/** Parameters for creating a thread. */
export interface ThreadCreateParameters {
  /** Parent channel ID */
  parentId: string
  /** Thread name */
  name: string
  /** Thread creator user ID */
  ownerId: string
  /** Optional explicit thread ID (used when creating from a message). */
  threadId?: string
  /** Thread type (defaults to 11 Public Thread). */
  type?: number
  /** Requested auto-archive duration (normalized to a valid enum value). */
  autoArchiveDuration?: unknown
  /** Slow-mode rate limit per user (seconds). */
  rateLimitPerUser?: number
  /** Whether non-moderators can invite others to a private thread. */
  invitable?: boolean
}

/**
 * Retrieves a thread (channel row restricted to thread types) by ID.
 * @param database - Database
 * @param threadId - Thread ID
 * @returns Thread object, or null if it is not a thread
 */
export function getThread(
  database: Database,
  threadId: string
): ThreadObject | null {
  const row = database
    .prepare('SELECT * FROM channels WHERE id = ? AND type IN (10, 11, 12)')
    .get(threadId) as ThreadRow | undefined
  return row ? toThreadObject(database, row) : null
}

/**
 * Adds a user to a thread's member list (idempotent).
 * @param database - Database
 * @param threadId - Thread ID
 * @param userId - User ID
 */
export function addThreadMember(
  database: Database,
  threadId: string,
  userId: string
): void {
  database
    .prepare(
      'INSERT OR IGNORE INTO thread_members (thread_id, user_id) VALUES (?, ?)'
    )
    .run(threadId, userId)
}

/**
 * Removes a user from a thread's member list.
 * @param database - Database
 * @param threadId - Thread ID
 * @param userId - User ID
 */
export function removeThreadMember(
  database: Database,
  threadId: string,
  userId: string
): void {
  database
    .prepare('DELETE FROM thread_members WHERE thread_id = ? AND user_id = ?')
    .run(threadId, userId)
}

/**
 * Retrieves a single thread member.
 * @param database - Database
 * @param threadId - Thread ID
 * @param userId - User ID
 * @param guildId - Guild ID the thread belongs to; when provided together
 * with `shouldIncludeMember`, the response embeds the guild member object (matches
 * real Discord's `?with_member=true` query parameter)
 * @param shouldIncludeMember - Whether to embed the guild member object
 * @returns Thread member object, or null if not a member
 */
export function getThreadMember(
  database: Database,
  threadId: string,
  userId: string,
  guildId?: string | null,
  shouldIncludeMember = false
): ThreadMemberObject | null {
  const row = database
    .prepare('SELECT * FROM thread_members WHERE thread_id = ? AND user_id = ?')
    .get(threadId, userId) as ThreadMemberRow | undefined
  if (!row) return null
  const member =
    shouldIncludeMember && guildId
      ? (getGuildMember(database, guildId, userId) ?? undefined)
      : undefined
  return toThreadMemberObject(row, member)
}

/**
 * Retrieves the members of a thread, paginated by user ID.
 *
 * Discord's `GET /channels/{channel.id}/thread-members` supports `after`
 * (a user-ID cursor) and `limit` query parameters, returning members whose
 * user ID is greater than `after`, sorted ascending. Honoring the cursor is
 * required for correctness with cursor-based client paginators: hikari's
 * `ThreadMembersIterator`, for example, keeps requesting pages (advancing
 * `after`) until it receives an empty page, so an implementation that ignored
 * `after` and always returned the full list would make such a paginator loop
 * forever instead of terminating. Mirrors `getGuildMembers`'s cursor pattern.
 * @param database - Database
 * @param threadId - Thread ID
 * @param limit - Maximum number of members to return
 * @param after - User-ID cursor; only members with a greater user ID are returned
 * @param guildId - Guild ID the thread belongs to; when provided together
 * with `shouldIncludeMember`, each entry embeds the guild member object (matches
 * real Discord's `?with_member=true` query parameter)
 * @param shouldIncludeMember - Whether to embed the guild member object
 * @returns Array of thread member objects
 */
export function getThreadMembers(
  database: Database,
  threadId: string,
  limit = 100,
  after = '0',
  guildId?: string | null,
  shouldIncludeMember = false
): ThreadMemberObject[] {
  // `limit` can arrive as NaN (e.g. `?limit=abc`) or negative; both must be
  // rejected here rather than passed to SQLite's LIMIT, which would either
  // throw (NaN) or disable the limit entirely (SQLite treats LIMIT -1 as
  // "no limit").
  const clampedLimit = Number.isFinite(limit)
    ? Math.min(Math.max(limit, 0), 100)
    : 100
  const rows = database
    .prepare(
      `SELECT * FROM thread_members
       WHERE thread_id = ? AND user_id > ?
       ORDER BY user_id ASC LIMIT ?`
    )
    .all(threadId, after, clampedLimit) as ThreadMemberRow[]
  return rows.map((r) =>
    toThreadMemberObject(
      r,
      shouldIncludeMember && guildId
        ? (getGuildMember(database, guildId, r.user_id) ?? undefined)
        : undefined
    )
  )
}

/**
 * Creates a thread as a channel row and adds the owner as the first member.
 * @param database - Database
 * @param parameters - Thread creation parameters
 * @returns Created thread object
 */
export function createThread(
  database: Database,
  parameters: ThreadCreateParameters
): ThreadObject {
  const parent = database
    .prepare('SELECT guild_id FROM channels WHERE id = ?')
    .get(parameters.parentId) as { guild_id: string | null } | undefined

  const threadId = parameters.threadId ?? generateSnowflake()
  const type = parameters.type ?? DEFAULT_THREAD_TYPE
  const autoArchive = normalizeAutoArchiveDuration(
    parameters.autoArchiveDuration
  )

  // Wrap the channel insert and owner membership insert in a transaction so a
  // failure mid-way cannot leave a thread row without its owner member.
  const insertThread = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO channels
         (id, guild_id, type, name, parent_id, owner_id, rate_limit_per_user,
          archived, auto_archive_duration, locked, invitable)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`
      )
      .run(
        threadId,
        parent?.guild_id ?? null,
        type,
        parameters.name,
        parameters.parentId,
        parameters.ownerId,
        parameters.rateLimitPerUser ?? 0,
        autoArchive,
        parameters.invitable === false ? 0 : 1
      )

    addThreadMember(database, threadId, parameters.ownerId)
  })
  insertThread()

  const row = database
    .prepare('SELECT * FROM channels WHERE id = ?')
    .get(threadId) as ThreadRow
  return toThreadObject(database, row)
}

/** Options for listing archived threads. */
export interface ArchivedThreadOptions {
  /** When true, list private threads (type 12); otherwise public (10, 11). */
  private: boolean
  /** When set, restrict the listing to threads the given user has joined. */
  joinedUserId?: string
  /**
   * When set, populate `members` with this user's ThreadMember record for each
   * returned thread they belong to, without filtering the listing itself.
   */
  memberUserId?: string
}

/** Response shape for archived-thread listings (ThreadsResponse). */
export interface ThreadsListResponse {
  threads: ThreadObject[]
  members: ThreadMemberObject[]
  has_more: boolean
}

/**
 * Lists archived threads under a parent channel.
 * @param database - Database
 * @param parentId - Parent channel ID
 * @param options - Filtering options
 * @returns ThreadsResponse-shaped object (has_more always false in the mock)
 */
export function getArchivedThreads(
  database: Database,
  parentId: string,
  options: ArchivedThreadOptions
): ThreadsListResponse {
  const typeClause = options.private ? 'type = 12' : 'type IN (10, 11)'
  let sql = `SELECT * FROM channels WHERE parent_id = ? AND archived = 1 AND ${typeClause}`
  const sqlParameters: unknown[] = [parentId]
  if (options.joinedUserId) {
    sql += ' AND id IN (SELECT thread_id FROM thread_members WHERE user_id = ?)'
    sqlParameters.push(options.joinedUserId)
  }
  const rows = database.prepare(sql).all(...sqlParameters) as ThreadRow[]
  const threads = rows.map((r) => toThreadObject(database, r))

  // "members" holds the calling user's ThreadMember for each returned thread
  // (Discord returns the requester's membership records). The listing itself is
  // filtered only by `joinedUserId`; `memberUserId` just drives member lookup.
  const members: ThreadMemberObject[] = []
  const memberUserId = options.memberUserId ?? options.joinedUserId
  if (memberUserId) {
    for (const t of threads) {
      const m = getThreadMember(database, t.id, memberUserId)
      if (m) members.push(m)
    }
  }

  return { threads, members, has_more: false }
}

/** Response shape for thread search (ThreadSearchResponse). */
export interface ThreadSearchResult {
  threads: ThreadObject[]
  members: ThreadMemberObject[]
  has_more: boolean
  total_results: number
}

/**
 * Searches threads under a parent channel. The mock has no search index, so it
 * returns all threads whose `parent_id` matches.
 * @param database - Database
 * @param parentId - Parent channel ID
 * @returns ThreadSearchResponse-shaped object
 */
export function searchThreads(
  database: Database,
  parentId: string
): ThreadSearchResult {
  const rows = database
    .prepare(
      'SELECT * FROM channels WHERE parent_id = ? AND type IN (10, 11, 12)'
    )
    .all(parentId) as ThreadRow[]
  const threads = rows.map((r) => toThreadObject(database, r))
  return {
    threads,
    members: [],
    has_more: false,
    total_results: threads.length,
  }
}
