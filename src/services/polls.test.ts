import { describe, it, expect, beforeEach } from 'vitest'
import { createPoll, getPollForMessage, injectPollVote } from './polls'
import { initializeDatabase, type Database } from '../db'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'
import { createTestUser } from './test-control'

let db: Database
const botUserId = '111111111111111111'

beforeEach(() => {
  db = initializeDatabase(':memory:')
})

describe('createPoll / getPollForMessage', () => {
  it('creates a poll with answers and zero vote counts', () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)

    createPoll(db, message, {
      question: 'Favorite color?',
      answers: [{ text: 'Red' }, { text: 'Blue' }],
    })

    const poll = getPollForMessage(db, message)
    expect(poll?.question.text).toBe('Favorite color?')
    expect(poll?.answers).toHaveLength(2)
    expect(poll?.results?.answer_counts).toEqual([
      { id: 1, count: 0, me_voted: false },
      { id: 2, count: 0, me_voted: false },
    ])
  })

  it('returns null for a message with no poll', () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)

    expect(getPollForMessage(db, message)).toBeNull()
  })
})

describe('injectPollVote', () => {
  it('records a vote and reflects it in the answer counts', () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)
    createPoll(db, message, {
      question: 'Q',
      answers: [{ text: 'A' }],
    })
    const user = createTestUser(db, { username: 'Judy' })

    const result = injectPollVote(db, message, 1, user.id)

    expect(result).toBe('OK')
    const poll = getPollForMessage(db, message)
    expect(poll?.results?.answer_counts[0].count).toBe(1)
  })

  it('returns UNKNOWN_MESSAGE for a message with no poll', () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)
    const user = createTestUser(db, { username: 'Karl' })

    expect(injectPollVote(db, message, 1, user.id)).toBe('UNKNOWN_MESSAGE')
  })

  it('returns UNKNOWN_ANSWER for a non-existent answer id', () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)
    createPoll(db, message, { question: 'Q', answers: [{ text: 'A' }] })
    const user = createTestUser(db, { username: 'Liam' })

    expect(injectPollVote(db, message, 99, user.id)).toBe('UNKNOWN_ANSWER')
  })
})
