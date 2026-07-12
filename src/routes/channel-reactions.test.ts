import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelReactionRoutes } from './channel-reactions'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'
import type { Database } from '../database'
import type { AppEnvironment } from '../middleware/auth'

const BASE_URL = 'http://localhost:3000'

describe('Channel Reactions API', () => {
  let database: Database
  let app: Hono<AppEnvironment>
  let channelId: string
  let token: string

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono<AppEnvironment>()
    app.route('/', createChannelReactionRoutes(database, BASE_URL))

    token = seedBot(database)
    const guildId = seedGuild(database, token)
    channelId = seedChannel(database, guildId)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/:userId', () => {
    it("deletes a specific user's reaction", async () => {
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
        'React to me'
      )

      // Register a reaction for another user directly in the DB
      const reactingUserId = '777777777777777777'
      database
        .prepare("INSERT INTO users (id, username) VALUES (?, 'Reactor')")
        .run(reactingUserId)
      database
        .prepare(
          'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
        )
        .run(messageId, reactingUserId, '👍')

      const emoji = encodeURIComponent('👍')
      const resource = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}/${reactingUserId}`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(204)

      // The deleted user should not appear in the reaction user list
      const listResource = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}`,
        { headers: { Authorization: token } }
      )
      const users = (await listResource.json()) as { id: string }[]
      expect(users.some((u) => u.id === reactingUserId)).toBe(false)
    })
  })

  describe('PUT /channels/:channelId/messages/:messageId/reactions/:emoji/@me', () => {
    it('adds a reaction to an existing message', async () => {
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
        'React to me'
      )

      const emoji = encodeURIComponent('👍')
      const resource = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}/@me`,
        {
          method: 'PUT',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(204)
    })

    it('returns 404 Unknown Message when the message does not exist', async () => {
      const emoji = encodeURIComponent('👍')
      const resource = await app.request(
        `/channels/${channelId}/messages/999999999999999999/reactions/${emoji}/@me`,
        {
          method: 'PUT',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_008)
    })

    it('returns 400 for a malformed percent-encoded emoji', async () => {
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
        'react'
      )

      // "%E0%A4%A" is invalid percent-encoding and makes decodeURIComponent throw.
      const resource = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/%E0%A4%A/@me`,
        {
          method: 'PUT',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })
  })

  describe('GET /channels/:channelId/messages/:messageId/reactions/:emoji', () => {
    it('lists users who reacted', async () => {
      const botUserId = (
        database
          .prepare('SELECT user_id FROM bots WHERE token = ?')
          .get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(database, channelId, botUserId, token, 'r')
      const reactor = '777777777777777777'
      database
        .prepare("INSERT INTO users (id, username) VALUES (?, 'R')")
        .run(reactor)
      database
        .prepare(
          'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
        )
        .run(messageId, reactor, '👍')

      const emoji = encodeURIComponent('👍')
      const resource = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}`,
        { headers: { Authorization: token } }
      )
      expect(resource.status).toBe(200)
      const users = (await resource.json()) as { id: string }[]
      expect(users.some((u) => u.id === reactor)).toBe(true)
    })
  })

  describe('DELETE all reactions', () => {
    it('removes every reaction on a message', async () => {
      const botUserId = (
        database
          .prepare('SELECT user_id FROM bots WHERE token = ?')
          .get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(database, channelId, botUserId, token, 'r')
      database
        .prepare(
          'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
        )
        .run(messageId, botUserId, '👍')

      const resource = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(204)

      const remaining = database
        .prepare('SELECT COUNT(*) AS n FROM reactions WHERE message_id = ?')
        .get(messageId) as { n: number }
      expect(remaining.n).toBe(0)
    })
  })

  describe('DELETE reactions for a specific emoji', () => {
    it('removes all reactions for one emoji', async () => {
      const botUserId = (
        database
          .prepare('SELECT user_id FROM bots WHERE token = ?')
          .get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(database, channelId, botUserId, token, 'r')
      database
        .prepare(
          'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
        )
        .run(messageId, botUserId, '👍')

      const emoji = encodeURIComponent('👍')
      const resource = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(204)
    })
  })
})
