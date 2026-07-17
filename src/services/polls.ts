/**
 * Poll data model
 *
 * Backs Discord's Poll object (attached ad hoc to the message-create and
 * poll-expire responses; not part of the generic message hydration
 * pipeline, since no other endpoint needs to surface it — see spec Issue
 * #136).
 */

import type { Database } from '../db'
import { gatewayBus } from '../gateway/bus'
import {
  getMessage,
  getGuildIdForChannel,
  getDispatchMember,
  type MessageObject,
} from './messages'

/** Poll answer object for API responses */
export interface PollAnswerObject {
  answer_id: number
  poll_media: { text: string; emoji?: { id: string | null; name: string } }
}

/** Poll object for API responses (attached to a message via object spread) */
export interface PollObject {
  question: { text: string }
  answers: PollAnswerObject[]
  expiry: string | null
  allow_multiselect: boolean
  layout_type: number
  results?: {
    answer_counts: { id: number; count: number; me_voted: boolean }[]
    is_finalized: boolean
  }
}

/** Poll answer input when creating a poll */
export interface PollAnswerInput {
  text: string
  emoji?: { id?: string | null; name?: string } | null
}

/** Poll creation parameters */
export interface PollCreateParams {
  question: string
  answers: PollAnswerInput[]
  allowMultiselect?: boolean
  durationHours?: number
}

interface PollRow {
  message_id: string
  question: string
  allow_multiselect: number
  expiry: string | null
  finalized: number
  layout_type: number
}

interface PollAnswerRow {
  id: number
  message_id: string
  text: string
  emoji: string | null
}

/**
 * Creates a poll (and its answers) attached to an existing message.
 * @param db - Database
 * @param messageId - Message the poll is attached to
 * @param params - Poll creation parameters
 */
export function createPoll(
  db: Database,
  messageId: string,
  params: PollCreateParams
): void {
  const durationHours = params.durationHours ?? 24
  const expiry = new Date(
    Date.now() + durationHours * 60 * 60 * 1000
  ).toISOString()

  db.prepare(
    `INSERT INTO polls (message_id, question, allow_multiselect, expiry, finalized, layout_type)
     VALUES (?, ?, ?, ?, 0, 1)`
  ).run(messageId, params.question, params.allowMultiselect ? 1 : 0, expiry)

  for (const [index, answer] of params.answers.entries()) {
    db.prepare(
      'INSERT INTO poll_answers (id, message_id, text, emoji) VALUES (?, ?, ?, ?)'
    ).run(
      index + 1,
      messageId,
      answer.text,
      answer.emoji ? JSON.stringify(answer.emoji) : null
    )
  }
}

/**
 * Retrieves a message's poll, including current vote counts.
 * @param db - Database
 * @param messageId - Message ID
 * @returns Poll object, or null if the message has no poll
 */
export function getPollForMessage(
  db: Database,
  messageId: string
): PollObject | null {
  const poll = db
    .prepare('SELECT * FROM polls WHERE message_id = ?')
    .get(messageId) as PollRow | undefined
  if (!poll) return null

  const answerRows = db
    .prepare('SELECT * FROM poll_answers WHERE message_id = ? ORDER BY id')
    .all(messageId) as PollAnswerRow[]

  const answers: PollAnswerObject[] = answerRows.map((row) => ({
    answer_id: row.id,
    poll_media: {
      text: row.text,
      ...(row.emoji && {
        emoji: JSON.parse(row.emoji) as {
          id: string | null
          name: string
        },
      }),
    },
  }))

  const counts = db
    .prepare(
      'SELECT answer_id, COUNT(*) as count FROM poll_votes WHERE message_id = ? GROUP BY answer_id'
    )
    .all(messageId) as { answer_id: number; count: number }[]
  const countsByAnswer = new Map(counts.map((r) => [r.answer_id, r.count]))

  return {
    question: { text: poll.question },
    answers,
    expiry: poll.expiry,
    allow_multiselect: poll.allow_multiselect === 1,
    layout_type: poll.layout_type,
    results: {
      answer_counts: answerRows.map((row) => ({
        id: row.id,
        count: countsByAnswer.get(row.id) ?? 0,
        me_voted: false,
      })),
      is_finalized: poll.finalized === 1,
    },
  }
}

/**
 * Injects a poll vote for testing (see `/_test/polls/:messageId/votes`).
 * @param db - Database
 * @param messageId - Message ID the poll is attached to
 * @param answerId - Answer ID being voted for
 * @param userId - Voting user's ID
 * @returns 'OK' on success, or a sentinel error code
 */
export function injectPollVote(
  db: Database,
  messageId: string,
  answerId: number,
  userId: string
): 'UNKNOWN_MESSAGE' | 'UNKNOWN_ANSWER' | 'OK' {
  const poll = db
    .prepare('SELECT message_id FROM polls WHERE message_id = ?')
    .get(messageId)
  if (!poll) return 'UNKNOWN_MESSAGE'

  const answer = db
    .prepare('SELECT id FROM poll_answers WHERE message_id = ? AND id = ?')
    .get(messageId, answerId)
  if (!answer) return 'UNKNOWN_ANSWER'

  db.prepare(
    'INSERT OR IGNORE INTO poll_votes (message_id, answer_id, user_id) VALUES (?, ?, ?)'
  ).run(messageId, answerId, userId)
  return 'OK'
}

/** User object shape embedded in a poll answer voters response */
export interface PollVoterUser {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  bot: boolean
}

/**
 * Retrieves the users who voted for a specific poll answer.
 * @param db - Database
 * @param messageId - Message ID the poll is attached to
 * @param answerId - Answer ID
 * @param limit - Maximum number of voters to return
 * @param after - Return only voters with a user ID greater than this (pagination)
 * @returns Array of voter users, or 'UNKNOWN_MESSAGE' if the message/poll/answer does not exist
 */
export function getPollAnswerVoters(
  db: Database,
  messageId: string,
  answerId: number,
  limit: number,
  after?: string
): PollVoterUser[] | 'UNKNOWN_MESSAGE' {
  const poll = db
    .prepare('SELECT message_id FROM polls WHERE message_id = ?')
    .get(messageId)
  if (!poll) return 'UNKNOWN_MESSAGE'

  const answer = db
    .prepare('SELECT id FROM poll_answers WHERE message_id = ? AND id = ?')
    .get(messageId, answerId)
  if (!answer) return 'UNKNOWN_MESSAGE'

  const afterClause = after ? 'AND u.id > ?' : ''
  const queryParams = after
    ? [messageId, answerId, after, limit]
    : [messageId, answerId, limit]

  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.discriminator, u.avatar, u.bot
       FROM poll_votes pv
       JOIN users u ON u.id = pv.user_id
       WHERE pv.message_id = ? AND pv.answer_id = ? ${afterClause}
       ORDER BY u.id
       LIMIT ?`
    )
    .all(...queryParams) as {
    id: string
    username: string
    discriminator: string
    avatar: string | null
    bot: number
  }[]

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    discriminator: row.discriminator,
    avatar: row.avatar,
    bot: row.bot === 1,
  }))
}

/**
 * Immediately ends (finalizes) a poll and returns the updated message with
 * its poll attached. Idempotent: calling this on an already-finalized poll
 * re-sets its expiry to now and succeeds.
 * @param db - Database
 * @param messageId - Message ID the poll is attached to
 * @param baseUrl - Base URL for building the message object
 * @returns The updated message object with `poll` attached, or 'UNKNOWN_MESSAGE'
 */
export function expirePoll(
  db: Database,
  messageId: string,
  baseUrl: string
): (MessageObject & { poll: PollObject | null }) | 'UNKNOWN_MESSAGE' {
  const poll = db
    .prepare('SELECT message_id FROM polls WHERE message_id = ?')
    .get(messageId)
  if (!poll) return 'UNKNOWN_MESSAGE'

  db.prepare(
    'UPDATE polls SET finalized = 1, expiry = ? WHERE message_id = ?'
  ).run(new Date().toISOString(), messageId)

  const message = getMessage(db, messageId, baseUrl)
  if (!message) return 'UNKNOWN_MESSAGE'

  const pollObject = getPollForMessage(db, messageId)
  const result = { ...message, poll: pollObject }

  const row = db
    .prepare('SELECT channel_id, author_id FROM messages WHERE id = ?')
    .get(messageId) as { channel_id: string; author_id: string }
  const guildId = getGuildIdForChannel(db, row.channel_id)
  gatewayBus.emit('message.update', {
    guildId,
    channelId: row.channel_id,
    message: result,
    member: getDispatchMember(db, guildId, row.author_id),
  })

  return result
}
