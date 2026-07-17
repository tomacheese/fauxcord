import { Hono } from 'hono'
import { describe, it, expect, beforeEach } from 'vitest'
import { createChannelPollRoutes } from './channel-polls'
import { initializeDatabase, type Database } from '../db'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'
import { createPoll, injectPollVote } from '../services/polls'
import { createTestUser } from '../services/test-control'

const BASE_URL = 'http://localhost:3000'
const botUserId = '111111111111111111'
let db: Database
let app: Hono

beforeEach(() => {
  db = initializeDatabase(':memory:')
  app = new Hono()
  app.route('/', createChannelPollRoutes(db, BASE_URL))
})

describe('GET /channels/:channelId/polls/:messageId/answers/:answerId', () => {
  it('returns the users who voted for the answer', async () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)
    createPoll(db, message, { question: 'Q', answers: [{ text: 'A' }] })
    const user = createTestUser(db, { username: 'Nadia' })
    injectPollVote(db, message, 1, user.id)

    const res = await app.request(
      `/channels/${channel}/polls/${message}/answers/1`
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { users: { id: string }[] }
    expect(body.users).toHaveLength(1)
    expect(body.users[0].id).toBe(user.id)
  })

  it('returns 404 for a message with no poll', async () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)

    const res = await app.request(
      `/channels/${channel}/polls/${message}/answers/1`
    )

    expect(res.status).toBe(404)
  })

  it('returns an empty users array when no one has voted', async () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)
    createPoll(db, message, { question: 'Q', answers: [{ text: 'A' }] })

    const res = await app.request(
      `/channels/${channel}/polls/${message}/answers/1`
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { users: { id: string }[] }
    expect(body.users).toHaveLength(0)
  })
})

describe('POST /channels/:channelId/polls/:messageId/expire', () => {
  it('finalizes the poll and returns the message with poll.results.is_finalized true', async () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)
    createPoll(db, message, { question: 'Q', answers: [{ text: 'A' }] })

    const res = await app.request(
      `/channels/${channel}/polls/${message}/expire`,
      { method: 'POST' }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      poll: { results: { is_finalized: boolean }; expiry: string }
    }
    expect(body.poll.results.is_finalized).toBe(true)
    // expiry must stay ISO 8601, matching the format used at poll creation
    expect(body.poll.expiry).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
  })

  it('returns 404 for a message with no poll', async () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)

    const res = await app.request(
      `/channels/${channel}/polls/${message}/expire`,
      { method: 'POST' }
    )

    expect(res.status).toBe(404)
  })

  it('is idempotent when called on an already-finalized poll', async () => {
    const bot = seedBot(db, 'Bot testtoken', botUserId)
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const message = seedMessage(db, channel, botUserId, bot)
    createPoll(db, message, { question: 'Q', answers: [{ text: 'A' }] })

    await app.request(`/channels/${channel}/polls/${message}/expire`, {
      method: 'POST',
    })
    const res = await app.request(
      `/channels/${channel}/polls/${message}/expire`,
      { method: 'POST' }
    )

    expect(res.status).toBe(200)
  })
})
