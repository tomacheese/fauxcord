import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelReactionRoutes } from './channel-reactions'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'
import type { Database } from '../db'
import type { AppEnv } from '../middleware/auth'

describe('Channel Reactions API', () => {
  let db: Database
  let app: Hono<AppEnv>
  let channelId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono<AppEnv>()
    app.route('/', createChannelReactionRoutes(db))

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

    it('does not add a reaction through a different channel path', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'scoped')
      const otherChannelId = seedChannel(
        db,
        seedGuild(db, token),
        '888888888888888888'
      )

      const response = await app.request(
        `/channels/${otherChannelId}/messages/${messageId}/reactions/${encodeURIComponent('👍')}/@me`,
        { method: 'PUT', headers: { Authorization: token } }
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ code: 10_008 })
      const reactionCount = db
        .prepare('SELECT COUNT(*) AS count FROM reactions WHERE message_id = ?')
        .get(messageId) as { count: number }
      expect(reactionCount.count).toBe(0)
    })

    it('returns 400 for a malformed percent-encoded emoji', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'react')

      // "%E0%A4%A" is invalid percent-encoding and makes decodeURIComponent throw.
      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/%E0%A4%A/@me`,
        {
          method: 'PUT',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })
  })

  describe('GET /channels/:channelId/messages/:messageId/reactions/:emoji', () => {
    it('lists users who reacted', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'r')
      const reactor = '777777777777777777'
      db.prepare("INSERT INTO users (id, username) VALUES (?, 'R')").run(
        reactor
      )
      db.prepare(
        'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
      ).run(messageId, reactor, '👍')

      const emoji = encodeURIComponent('👍')
      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}`,
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(200)
      const users = (await res.json()) as { id: string }[]
      expect(users.some((u) => u.id === reactor)).toBe(true)
    })

    it('does not list reactions through a different channel path', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'scoped')
      const otherChannelId = seedChannel(
        db,
        seedGuild(db, token),
        '888888888888888888'
      )

      const response = await app.request(
        `/channels/${otherChannelId}/messages/${messageId}/reactions/${encodeURIComponent('👍')}`,
        { headers: { Authorization: token } }
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ code: 10_008 })
    })
  })

  describe('DELETE all reactions', () => {
    it('removes every reaction on a message', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'r')
      db.prepare(
        'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
      ).run(messageId, botUserId, '👍')

      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(res.status).toBe(204)

      const remaining = db
        .prepare('SELECT COUNT(*) AS n FROM reactions WHERE message_id = ?')
        .get(messageId) as { n: number }
      expect(remaining.n).toBe(0)
    })

    it('does not remove reactions through a different channel path', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'scoped')
      db.prepare(
        'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
      ).run(messageId, botUserId, '👍')
      const otherChannelId = seedChannel(
        db,
        seedGuild(db, token),
        '888888888888888888'
      )

      const response = await app.request(
        `/channels/${otherChannelId}/messages/${messageId}/reactions`,
        { method: 'DELETE', headers: { Authorization: token } }
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ code: 10_008 })
      const after = db
        .prepare('SELECT COUNT(*) AS n FROM reactions WHERE message_id = ?')
        .get(messageId) as { n: number }
      expect(after.n).toBe(1)
    })
  })

  describe('DELETE reactions for a specific emoji', () => {
    it('removes all reactions for one emoji', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'r')
      db.prepare(
        'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
      ).run(messageId, botUserId, '👍')

      const emoji = encodeURIComponent('👍')
      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(res.status).toBe(204)
    })
  })

  describe('cross-channel reaction deletions', () => {
    it.each(['@me', 'specific-user', 'emoji'])(
      'does not delete a %s reaction through a different channel path',
      async (route) => {
        const botUserId = (
          db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
            user_id: string
          }
        ).user_id
        const messageId = seedMessage(db, channelId, botUserId, token, 'scoped')
        db.prepare(
          'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
        ).run(messageId, botUserId, '👍')
        const otherChannelId = seedChannel(
          db,
          seedGuild(db, token),
          '888888888888888888'
        )
        const emoji = encodeURIComponent('👍')
        const target =
          route === 'emoji'
            ? emoji
            : `${emoji}/${route === '@me' ? route : botUserId}`

        const response = await app.request(
          `/channels/${otherChannelId}/messages/${messageId}/reactions/${target}`,
          { method: 'DELETE', headers: { Authorization: token } }
        )

        expect(response.status).toBe(404)
        await expect(response.json()).resolves.toMatchObject({ code: 10_008 })
        const remaining = db
          .prepare(
            'SELECT COUNT(*) AS count FROM reactions WHERE message_id = ?'
          )
          .get(messageId) as { count: number }
        expect(remaining.count).toBe(1)
      }
    )
  })
})
