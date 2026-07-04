import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelMessageRoutes } from './channel-messages'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'
import type { Database } from '../db'
import type { AppEnv } from '../middleware/auth'

const BASE_URL = 'http://localhost:3000'

describe('Channel Messages API', () => {
  let db: Database
  let app: Hono<AppEnv>
  let channelId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono<AppEnv>()
    app.route('/', createChannelMessageRoutes(db, BASE_URL))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
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

  describe('GET /channels/:channelId/messages/:messageId', () => {
    it('retrieves a single message', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'single')

      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string; content: string }
      expect(body.id).toBe(messageId)
      expect(body.content).toBe('single')
    })

    it('returns 404 for a non-existent message', async () => {
      const res = await app.request(
        `/channels/${channelId}/messages/999999999999999999`,
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_008)
    })
  })

  describe('PATCH /channels/:channelId/messages/:messageId', () => {
    it('edits an existing message', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'before')

      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'after' }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { content: string }
      expect(body.content).toBe('after')
    })

    it('returns 404 when editing a non-existent message', async () => {
      const res = await app.request(
        `/channels/${channelId}/messages/999999999999999999`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'x' }),
        }
      )
      expect(res.status).toBe(404)
    })

    it('returns 400 when the edited content exceeds the limit', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'before')

      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'a'.repeat(2001) }),
        }
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })
  })

  describe('POST /channels/:channelId/messages/bulk-delete', () => {
    it('bulk-deletes messages', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const id1 = seedMessage(db, channelId, botUserId, token, 'a')
      const id2 = seedMessage(db, channelId, botUserId, token, 'b')

      const res = await app.request(
        `/channels/${channelId}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: [id1, id2] }),
        }
      )
      expect(res.status).toBe(204)
    })

    it('returns 400 when fewer than 2 messages are provided', async () => {
      const res = await app.request(
        `/channels/${channelId}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: ['123456789012345678'] }),
        }
      )
      expect(res.status).toBe(400)
    })

    it('does not delete messages that belong to a different channel', async () => {
      const otherChannelId = seedChannel(db, seedGuild(db, token), 'other')

      // Post one message in each channel.
      const postTo = async (cid: string, content: string): Promise<string> => {
        const res = await app.request(`/channels/${cid}/messages`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        const { id } = (await res.json()) as { id: string }
        return id
      }
      const msgA = await postTo(channelId, 'in target channel')
      const msgB = await postTo(otherChannelId, 'in other channel')

      // Bulk-delete both IDs via the target channel; msgB must survive.
      const res = await app.request(
        `/channels/${channelId}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [msgA, msgB] }),
        }
      )
      expect(res.status).toBe(204)

      const survivor = await app.request(
        `/channels/${otherChannelId}/messages/${msgB}`,
        { headers: { Authorization: token } }
      )
      expect(survivor.status).toBe(200)
    })
  })
})
