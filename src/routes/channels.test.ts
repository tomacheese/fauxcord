import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelRoutes } from './channels.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild, seedChannel } from '../test-helpers.js'
import type { Database } from '../db.js'

const BASE_URL = 'http://localhost:3000'

describe('Channels API', () => {
  let db: Database
  let app: Hono
  let channelId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelRoutes(db, BASE_URL))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('GET /channels/:channelId', () => {
    it('retrieves a channel', async () => {
      const res = await app.request(`/channels/${channelId}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(channelId)
      expect(body.name).toBe('general')
    })

    it('returns 404 for a non-existent channel', async () => {
      const res = await app.request('/channels/999999999999999999', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_003)
    })
  })

  describe('PATCH /channels/:channelId', () => {
    it('updates the channel name', async () => {
      const res = await app.request(`/channels/${channelId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'updated-channel' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.name).toBe('updated-channel')
    })
  })

  describe('POST /channels/:channelId/messages', () => {
    it('sends a message', async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Hello, World!' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.content).toBe('Hello, World!')
      expect(body.channel_id).toBe(channelId)
    })

    it('returns 400 for an empty message', async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_006)
    })

    it('returns 400 when content exceeds 2000 characters', async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'a'.repeat(2001) }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })
  })

  describe('GET /channels/:channelId/messages', () => {
    it('retrieves a list of messages', async () => {
      // Post a message first
      await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Test message' }),
      })

      const res = await app.request(`/channels/${channelId}/messages`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThan(0)
    })

    it('limit parameter works correctly', async () => {
      // Post 5 messages
      for (let i = 0; i < 5; i++) {
        await app.request(`/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: `Message ${i}` }),
        })
      }

      const res = await app.request(`/channels/${channelId}/messages?limit=3`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(body.length).toBe(3)
    })
  })

  describe('DELETE /channels/:channelId/messages/:messageId', () => {
    it('deletes a message', async () => {
      // Post a message
      const postRes = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'To delete' }),
      })
      const { id: messageId } = await postRes.json()

      const deleteRes = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(deleteRes.status).toBe(204)
    })
  })

  describe('DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/:userId', () => {
    it("deletes a specific user's reaction", async () => {
      // Post a message
      const postRes = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'React to me' }),
      })
      const { id: messageId } = await postRes.json()

      // Register a reaction for another user directly in the DB
      const reactingUserId = '777777777777777777'
      db.prepare("INSERT INTO users (id, username) VALUES (?, 'Reactor')").run(
        reactingUserId
      )
      db.prepare(
        'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
      ).run(messageId, reactingUserId, '👍')

      const emoji = encodeURIComponent('👍')
      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}/${reactingUserId}`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(204)

      // The deleted user should not appear in the reaction user list
      const listRes = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}`,
        { headers: { Authorization: token } }
      )
      const users = (await listRes.json()) as { id: string }[]
      expect(users.some((u) => u.id === reactingUserId)).toBe(false)
    })
  })

  describe('GET /channels/:channelId/pins', () => {
    it('retrieves the list of pinned messages', async () => {
      const res = await app.request(`/channels/${channelId}/pins`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
    })
  })
})
