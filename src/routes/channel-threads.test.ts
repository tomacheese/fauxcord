/**
 * @file channel-threads.test.ts
 * @description Route tests for the thread endpoints
 * (`src/routes/channel-threads.ts`).
 */

import { describe, it, expect } from 'vitest'
import { createChannelThreadRoutes } from './channel-threads'
import {
  createTestApp,
  seedBot,
  seedGuild,
  seedChannel,
  seedMessage,
} from '../test-helpers'

/**
 * Builds a test app with the thread routes mounted and a seeded bot/guild/channel.
 * @returns Test context with app, db, and seeded IDs
 */
function setup() {
  const { app, db } = createTestApp()
  const token = seedBot(db)
  const guildId = seedGuild(db, token)
  const channelId = seedChannel(db, guildId)
  app.route('/', createChannelThreadRoutes(db))
  return { app, db, token, guildId, channelId }
}

/** Authorization header matched directly against the seeded bot record. */
const AUTH = { Authorization: 'Bot testtoken' }
/** JSON + auth headers for request bodies. */
const JSON_HEADERS = { 'Content-Type': 'application/json', ...AUTH }

/** Bot user ID that seedBot registers by default. */
const BOT_USER_ID = '111111111111111111'

/**
 * Creates a thread via the API and returns its parsed body.
 * @param app - Hono app
 * @param channelId - Parent channel ID
 * @param name - Thread name
 * @returns Parsed thread response body
 */
async function createThreadViaApi(
  app: Awaited<ReturnType<typeof setup>>['app'],
  channelId: string,
  name = 'my-thread'
): Promise<Record<string, unknown>> {
  const res = await app.request(`/channels/${channelId}/threads`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, type: 11 }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as Record<string, unknown>
}

describe('POST /channels/:channelId/threads', () => {
  it('creates a thread and returns 201', async () => {
    const { app, channelId } = setup()
    const res = await app.request(`/channels/${channelId}/threads`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'general-thread', type: 11 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.type).toBe(11)
    expect(body.name).toBe('general-thread')
    expect(body.owner_id).toBe(BOT_USER_ID)
    expect(body.parent_id).toBe(channelId)
    expect(body.member_count).toBe(1)
    expect(body.thread_metadata).toMatchObject({
      archived: false,
      auto_archive_duration: 1440,
      locked: false,
    })
  })

  it('returns 400 when name is missing', async () => {
    const { app, channelId } = setup()
    const res = await app.request(`/channels/${channelId}/threads`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 11 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: number }
    expect(body.code).toBe(50_035)
  })

  it('returns 404 for an unknown channel', async () => {
    const { app } = setup()
    const res = await app.request('/channels/999999999999999999/threads', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /channels/:channelId/messages/:messageId/threads', () => {
  it('creates a thread from a message with id equal to the message id', async () => {
    const { app, db, channelId } = setup()
    const messageId = seedMessage(db, channelId, BOT_USER_ID, 'Bot testtoken')
    const res = await app.request(
      `/channels/${channelId}/messages/${messageId}/threads`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'from-message' }),
      }
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(messageId)
    expect(body.name).toBe('from-message')
  })

  it('returns 404 for an unknown message', async () => {
    const { app, channelId } = setup()
    const res = await app.request(
      `/channels/${channelId}/messages/999999999999999999/threads`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'x' }),
      }
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { code: number }
    expect(body.code).toBe(10_008)
  })

  it('returns 404 when the message belongs to a different channel', async () => {
    const { app, db, guildId, channelId } = setup()
    const otherChannel = seedChannel(db, guildId, '444444444444444444')
    const messageId = seedMessage(
      db,
      otherChannel,
      BOT_USER_ID,
      'Bot testtoken'
    )
    const res = await app.request(
      `/channels/${channelId}/messages/${messageId}/threads`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'x' }),
      }
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { code: number }
    expect(body.code).toBe(10_008)
  })

  it('returns 400 when a thread already exists for the message', async () => {
    const { app, db, channelId } = setup()
    const messageId = seedMessage(db, channelId, BOT_USER_ID, 'Bot testtoken')
    const first = await app.request(
      `/channels/${channelId}/messages/${messageId}/threads`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'first' }),
      }
    )
    expect(first.status).toBe(201)

    const second = await app.request(
      `/channels/${channelId}/messages/${messageId}/threads`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'second' }),
      }
    )
    expect(second.status).toBe(400)
    const body = (await second.json()) as { code: number }
    expect(body.code).toBe(160_004)
  })
})

describe('thread member join/leave (@me)', () => {
  it('joins and leaves a thread returning 204', async () => {
    const { app, channelId } = setup()
    const thread = await createThreadViaApi(app, channelId)
    const threadId = thread.id as string

    const join = await app.request(`/channels/${threadId}/thread-members/@me`, {
      method: 'PUT',
      headers: AUTH,
    })
    expect(join.status).toBe(204)

    const leave = await app.request(
      `/channels/${threadId}/thread-members/@me`,
      { method: 'DELETE', headers: AUTH }
    )
    expect(leave.status).toBe(204)
  })

  it('returns 404 when joining an unknown thread', async () => {
    const { app } = setup()
    const res = await app.request(
      '/channels/999999999999999999/thread-members/@me',
      { method: 'PUT', headers: AUTH }
    )
    expect(res.status).toBe(404)
  })
})

describe('thread member add/remove (:userId)', () => {
  it('adds and removes a member returning 204', async () => {
    const { app, channelId } = setup()
    const thread = await createThreadViaApi(app, channelId)
    const threadId = thread.id as string
    const otherUser = '222222222222222222'

    const add = await app.request(
      `/channels/${threadId}/thread-members/${otherUser}`,
      { method: 'PUT', headers: AUTH }
    )
    expect(add.status).toBe(204)

    const remove = await app.request(
      `/channels/${threadId}/thread-members/${otherUser}`,
      { method: 'DELETE', headers: AUTH }
    )
    expect(remove.status).toBe(204)
  })
})

describe('GET /channels/:channelId/thread-members', () => {
  it('lists members including the creator', async () => {
    const { app, channelId } = setup()
    const thread = await createThreadViaApi(app, channelId)
    const threadId = thread.id as string

    const res = await app.request(`/channels/${threadId}/thread-members`, {
      headers: AUTH,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user_id: string }[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((m) => m.user_id === BOT_USER_ID)).toBe(true)
  })

  it('honors the after user-ID cursor so paginators terminate', async () => {
    // Discord paginates thread members by user ID via the `after` cursor;
    // clients like hikari keep advancing `after` until they receive an empty
    // page. Passing an `after` at/above the highest member's user ID must
    // return an empty array, otherwise such a paginator loops forever.
    const { app, channelId } = setup()
    const thread = await createThreadViaApi(app, channelId)
    const threadId = thread.id as string

    const res = await app.request(
      `/channels/${threadId}/thread-members?after=${BOT_USER_ID}`,
      { headers: AUTH }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user_id: string }[]
    expect(body).toEqual([])
  })

  it('returns 404 for an unknown thread', async () => {
    const { app } = setup()
    const res = await app.request(
      '/channels/999999999999999999/thread-members',
      { headers: AUTH }
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /channels/:channelId/thread-members/:userId', () => {
  it('returns a specific member', async () => {
    const { app, channelId } = setup()
    const thread = await createThreadViaApi(app, channelId)
    const threadId = thread.id as string

    const res = await app.request(
      `/channels/${threadId}/thread-members/${BOT_USER_ID}`,
      { headers: AUTH }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.user_id).toBe(BOT_USER_ID)
    expect(body.id).toBe(threadId)
  })

  it('resolves @me to the authenticated user', async () => {
    const { app, channelId } = setup()
    const thread = await createThreadViaApi(app, channelId)
    const threadId = thread.id as string

    const res = await app.request(`/channels/${threadId}/thread-members/@me`, {
      headers: AUTH,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.user_id).toBe(BOT_USER_ID)
  })

  it('returns 404 (Unknown Member) for a non-member', async () => {
    const { app, channelId } = setup()
    const thread = await createThreadViaApi(app, channelId)
    const threadId = thread.id as string

    const res = await app.request(
      `/channels/${threadId}/thread-members/222222222222222222`,
      { headers: AUTH }
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { code: number }
    expect(body.code).toBe(10_007)
  })
})

describe('archived thread listings', () => {
  it('returns public archived threads in ThreadsResponse shape', async () => {
    const { app, db, channelId } = setup()
    // Insert an archived public thread directly.
    db.prepare(
      `INSERT INTO channels (id, guild_id, type, name, parent_id, owner_id, archived, auto_archive_duration, archive_timestamp)
       VALUES ('900000000000000001', ?, 11, 'archived-pub', ?, ?, 1, 1440, datetime('now'))`
    ).run('222222222222222222', channelId, BOT_USER_ID)

    const res = await app.request(
      `/channels/${channelId}/threads/archived/public`,
      { headers: AUTH }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      threads: unknown[]
      members: unknown[]
      has_more: boolean
    }
    expect(Array.isArray(body.threads)).toBe(true)
    expect(body.threads).toHaveLength(1)
    expect(body.has_more).toBe(false)
  })

  it('returns private archived threads (empty when none)', async () => {
    const { app, channelId } = setup()
    const res = await app.request(
      `/channels/${channelId}/threads/archived/private`,
      { headers: AUTH }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { threads: unknown[] }
    expect(body.threads).toHaveLength(0)
  })

  it('returns joined private archived threads', async () => {
    const { app, channelId } = setup()
    const res = await app.request(
      `/channels/${channelId}/users/@me/threads/archived/private`,
      { headers: AUTH }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      threads: unknown[]
      members: unknown[]
    }
    expect(Array.isArray(body.threads)).toBe(true)
  })

  it('returns 404 for an unknown channel', async () => {
    const { app } = setup()
    const res = await app.request(
      '/channels/999999999999999999/threads/archived/public',
      { headers: AUTH }
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /channels/:channelId/threads/search', () => {
  it('returns ThreadSearchResponse shape with matching total_results', async () => {
    const { app, channelId } = setup()
    await createThreadViaApi(app, channelId, 'searchable')

    const res = await app.request(`/channels/${channelId}/threads/search`, {
      headers: AUTH,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      threads: unknown[]
      total_results: number
      has_more: boolean
    }
    expect(body.total_results).toBe(body.threads.length)
    expect(body.has_more).toBe(false)
  })

  it('returns 404 for an unknown channel', async () => {
    const { app } = setup()
    const res = await app.request(
      '/channels/999999999999999999/threads/search',
      { headers: AUTH }
    )
    expect(res.status).toBe(404)
  })
})
