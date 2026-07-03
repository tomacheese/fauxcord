import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelReactionRoutes } from './channel-reactions.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import {
  seedBot,
  seedGuild,
  seedChannel,
  seedMessage,
} from '../test-helpers.js'
import type { Database } from '../db.js'
import type { AppEnv } from '../middleware/auth.js'

const BASE_URL = 'http://localhost:3000'

describe('Channel Reactions API', () => {
  let db: Database
  let app: Hono<AppEnv>
  let channelId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono<AppEnv>()
    app.route('/', createChannelReactionRoutes(db, BASE_URL))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/:userId', () => {
    it("deletes a specific user's reaction", async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(
        db,
        channelId,
        botUserId,
        token,
        'React to me'
      )

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

  describe('PUT /channels/:channelId/messages/:messageId/reactions/:emoji/@me', () => {
    it('adds a reaction to an existing message', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(
        db,
        channelId,
        botUserId,
        token,
        'React to me'
      )

      const emoji = encodeURIComponent('👍')
      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}/@me`,
        {
          method: 'PUT',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(204)
    })

    it('returns 404 Unknown Message when the message does not exist', async () => {
      const emoji = encodeURIComponent('👍')
      const res = await app.request(
        `/channels/${channelId}/messages/999999999999999999/reactions/${emoji}/@me`,
        {
          method: 'PUT',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_008)
    })
  })
})
