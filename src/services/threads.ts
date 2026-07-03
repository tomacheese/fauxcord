/**
 * Thread operations service
 *
 * Threads are stored as rows in the `channels` table (type 10/11/12) with
 * additional thread-specific columns, plus a `thread_members` join table.
 */

import type { Database } from '../db.js'
import { generateSnowflake } from '../snowflake.js'
import { THREAD_AUTO_ARCHIVE_DURATIONS } from '../validators/thread.js'

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
  archive_timestamp: string | null
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
 * @param db - Database
 * @param row - Thread DB record
 * @returns Thread object for API responses
 */
export function toThreadObject(db: Database, row: ThreadRow): ThreadObject {
  const messageCount = (
    db
      .prepare('SELECT COUNT(*) AS c FROM messages WHERE channel_id = ?')
      .get(row.id) as { c: number }
  ).c
  const memberCount = (
    db
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
      archive_timestamp: row.archive_timestamp
        ? new Date(row.archive_timestamp).toISOString()
        : null,
      auto_archive_duration: normalizeAutoArchiveDuration(
        row.auto_archive_duration
      ),
      locked: row.locked === 1,
      create_timestamp: new Date(row.created_at).toISOString(),
      invitable: row.invitable === 1,
    },
  }
}

/**
 * Converts a thread member DB row into the API response format.
 * @param row - Thread member DB record
 * @returns Thread member object for API responses
 */
export function toThreadMemberObject(row: ThreadMemberRow): ThreadMemberObject {
  return {
    id: row.thread_id,
    user_id: row.user_id,
    join_timestamp: new Date(row.join_timestamp).toISOString(),
    flags: row.flags,
  }
}

/** Parameters for creating a thread. */
export interface ThreadCreateParams {
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
 * @param db - Database
 * @param threadId - Thread ID
 * @returns Thread object, or null if it is not a thread
 */
export function getThread(db: Database, threadId: string): ThreadObject | null {
  const row = db
    .prepare('SELECT * FROM channels WHERE id = ? AND type IN (10, 11, 12)')
    .get(threadId) as ThreadRow | undefined
  return row ? toThreadObject(db, row) : null
}

/**
 * Adds a user to a thread's member list (idempotent).
 * @param db - Database
 * @param threadId - Thread ID
 * @param userId - User ID
 */
export function addThreadMember(
  db: Database,
  threadId: string,
  userId: string
): void {
  db.prepare(
    'INSERT OR IGNORE INTO thread_members (thread_id, user_id) VALUES (?, ?)'
  ).run(threadId, userId)
}

/**
 * Removes a user from a thread's member list.
 * @param db - Database
 * @param threadId - Thread ID
 * @param userId - User ID
 */
export function removeThreadMember(
  db: Database,
  threadId: string,
  userId: string
): void {
  db.prepare(
    'DELETE FROM thread_members WHERE thread_id = ? AND user_id = ?'
  ).run(threadId, userId)
}

/**
 * Retrieves a single thread member.
 * @param db - Database
 * @param threadId - Thread ID
 * @param userId - User ID
 * @returns Thread member object, or null if not a member
 */
export function getThreadMember(
  db: Database,
  threadId: string,
  userId: string
): ThreadMemberObject | null {
  const row = db
    .prepare('SELECT * FROM thread_members WHERE thread_id = ? AND user_id = ?')
    .get(threadId, userId) as ThreadMemberRow | undefined
  return row ? toThreadMemberObject(row) : null
}

/**
 * Retrieves all members of a thread.
 * @param db - Database
 * @param threadId - Thread ID
 * @returns Array of thread member objects
 */
export function getThreadMembers(
  db: Database,
  threadId: string
): ThreadMemberObject[] {
  const rows = db
    .prepare('SELECT * FROM thread_members WHERE thread_id = ?')
    .all(threadId) as ThreadMemberRow[]
  return rows.map((r) => toThreadMemberObject(r))
}

/**
 * Creates a thread as a channel row and adds the owner as the first member.
 * @param db - Database
 * @param params - Thread creation parameters
 * @returns Created thread object
 */
export function createThread(
  db: Database,
  params: ThreadCreateParams
): ThreadObject {
  const parent = db
    .prepare('SELECT guild_id FROM channels WHERE id = ?')
    .get(params.parentId) as { guild_id: string | null } | undefined

  const threadId = params.threadId ?? generateSnowflake()
  const type = params.type ?? DEFAULT_THREAD_TYPE
  const autoArchive = normalizeAutoArchiveDuration(params.autoArchiveDuration)

  // Wrap the channel insert and owner membership insert in a transaction so a
  // failure mid-way cannot leave a thread row without its owner member.
  const insertThread = db.transaction(() => {
    db.prepare(
      `INSERT INTO channels
         (id, guild_id, type, name, parent_id, owner_id, rate_limit_per_user,
          archived, auto_archive_duration, locked, invitable)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`
    ).run(
      threadId,
      parent?.guild_id ?? null,
      type,
      params.name,
      params.parentId,
      params.ownerId,
      params.rateLimitPerUser ?? 0,
      autoArchive,
      params.invitable === false ? 0 : 1
    )

    addThreadMember(db, threadId, params.ownerId)
  })
  insertThread()

  const row = db
    .prepare('SELECT * FROM channels WHERE id = ?')
    .get(threadId) as ThreadRow
  return toThreadObject(db, row)
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
 * @param db - Database
 * @param parentId - Parent channel ID
 * @param options - Filtering options
 * @returns ThreadsResponse-shaped object (has_more always false in the mock)
 */
export function getArchivedThreads(
  db: Database,
  parentId: string,
  options: ArchivedThreadOptions
): ThreadsListResponse {
  const typeClause = options.private ? 'type = 12' : 'type IN (10, 11)'
  let sql = `SELECT * FROM channels WHERE parent_id = ? AND archived = 1 AND ${typeClause}`
  const sqlParams: unknown[] = [parentId]
  if (options.joinedUserId) {
    sql += ' AND id IN (SELECT thread_id FROM thread_members WHERE user_id = ?)'
    sqlParams.push(options.joinedUserId)
  }
  const rows = db.prepare(sql).all(...sqlParams) as ThreadRow[]
  const threads = rows.map((r) => toThreadObject(db, r))

  // "members" holds the calling user's ThreadMember for each returned thread
  // (Discord returns the requester's membership records). The listing itself is
  // filtered only by `joinedUserId`; `memberUserId` just drives member lookup.
  const members: ThreadMemberObject[] = []
  const memberUserId = options.memberUserId ?? options.joinedUserId
  if (memberUserId) {
    for (const t of threads) {
      const m = getThreadMember(db, t.id, memberUserId)
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
 * @param db - Database
 * @param parentId - Parent channel ID
 * @returns ThreadSearchResponse-shaped object
 */
export function searchThreads(
  db: Database,
  parentId: string
): ThreadSearchResult {
  const rows = db
    .prepare(
      'SELECT * FROM channels WHERE parent_id = ? AND type IN (10, 11, 12)'
    )
    .all(parentId) as ThreadRow[]
  const threads = rows.map((r) => toThreadObject(db, r))
  return {
    threads,
    members: [],
    has_more: false,
    total_results: threads.length,
  }
}
