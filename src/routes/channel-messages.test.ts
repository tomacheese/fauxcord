import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelMessageRoutes } from './channel-messages'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'
import type { Database } from '../database'
import type { AppEnvironment } from '../middleware/auth'

const BASE_URL = 'http://localhost:3000'

describe('Channel Messages API', () => {
  let database: Database
  let app: Hono<AppEnvironment>
  let channelId: string
  let token: string

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono<AppEnvironment>()
    app.route('/', createChannelMessageRoutes(database, BASE_URL))

    token = seedBot(database)
    const guildId = seedGuild(database, token)
    channelId = seedChannel(database, guildId)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('POST /channels/:channelId/messages', () => {
    it('sends a message', async () => {
      const resource = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Hello, World!' }),
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.content).toBe('Hello, World!')
      expect(body.channel_id).toBe(channelId)
    })

    it('returns 400 for an empty message', async () => {
      const resource = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(50_006)
    })

    it('returns 400 when content exceeds 2000 characters', async () => {
      const resource = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'a'.repeat(2001) }),
      })
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as Record<string, unknown>
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

      const resource = await app.request(`/channels/${channelId}/messages`, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as unknown[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThan(0)
    })

    it('limit parameter works correctly', async () => {
      // Post 5 messages
      for (let index = 0; index < 5; index++) {
        await app.request(`/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: `Message ${index}` }),
        })
      }

      const resource = await app.request(
        `/channels/${channelId}/messages?limit=3`,
        {
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as unknown[]
      expect(body.length).toBe(3)
    })
  })

  describe('DELETE /channels/:channelId/messages/:messageId', () => {
    it('deletes a message', async () => {
      // Post a message
      const postResource = await app.request(
        `/channels/${channelId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'To delete' }),
        }
      )
      const { id: messageId } = await postResource.json()

      const deletedResponse = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(deletedResponse.status).toBe(204)
    })
  })

  describe('GET /channels/:channelId/messages/:messageId', () => {
    it('retrieves a single message', async () => {
      const botUserId = (
        database
          .prepare('SELECT user_id FROM bots WHERE token = ?')
          .get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(
        database,
        channelId,
        botUserId,
        token,
        'single'
      )

      const resource = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        { headers: { Authorization: token } }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { id: string; content: string }
      expect(body.id).toBe(messageId)
      expect(body.content).toBe('single')
    })

    it('returns 404 for a non-existent message', async () => {
      const resource = await app.request(
        `/channels/${channelId}/messages/999999999999999999`,
        { headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_008)
    })
  })

  describe('PATCH /channels/:channelId/messages/:messageId', () => {
    it('edits an existing message', async () => {
      const botUserId = (
        database
          .prepare('SELECT user_id FROM bots WHERE token = ?')
          .get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(
        database,
        channelId,
        botUserId,
        token,
        'before'
      )

      const resource = await app.request(
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
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { content: string }
      expect(body.content).toBe('after')
    })

    it('returns 404 when editing a non-existent message', async () => {
      const resource = await app.request(
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
      expect(resource.status).toBe(404)
    })

    it('returns 400 when the edited content exceeds the limit', async () => {
      const botUserId = (
        database
          .prepare('SELECT user_id FROM bots WHERE token = ?')
          .get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(
        database,
        channelId,
        botUserId,
        token,
        'before'
      )

      const resource = await app.request(
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
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })
  })

  describe('POST /channels/:channelId/messages/bulk-delete', () => {
    it('bulk-deletes messages', async () => {
      const botUserId = (
        database
          .prepare('SELECT user_id FROM bots WHERE token = ?')
          .get(token) as {
          user_id: string
        }
      ).user_id
      const id1 = seedMessage(database, channelId, botUserId, token, 'a')
      const id2 = seedMessage(database, channelId, botUserId, token, 'b')

      const resource = await app.request(
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
      expect(resource.status).toBe(204)
    })

    it('returns 400 when fewer than 2 messages are provided', async () => {
      const resource = await app.request(
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
      expect(resource.status).toBe(400)
    })

    it('does not delete messages that belong to a different channel', async () => {
      const otherChannelId = seedChannel(
        database,
        seedGuild(database, token),
        'other'
      )

      // Post one message in each channel.
      const postTo = async (cid: string, content: string): Promise<string> => {
        const resource = await app.request(`/channels/${cid}/messages`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        const { id } = (await resource.json()) as { id: string }
        return id
      }
      const messageA = await postTo(channelId, 'in target channel')
      const messageB = await postTo(otherChannelId, 'in other channel')

      // Bulk-delete both IDs via the target channel; msgB must survive.
      const resource = await app.request(
        `/channels/${channelId}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [messageA, messageB] }),
        }
      )
      expect(resource.status).toBe(204)

      const survivor = await app.request(
        `/channels/${otherChannelId}/messages/${messageB}`,
        { headers: { Authorization: token } }
      )
      expect(survivor.status).toBe(200)
    })
  })
})
