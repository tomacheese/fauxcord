import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelPinRoutes } from './channel-pins'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'
import type { Database } from '../db'

const BASE_URL = 'http://localhost:3000'

describe('Channel Pins API', () => {
  let db: Database
  let app: Hono
  let channelId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelPinRoutes(db, BASE_URL))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
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

  describe('PUT /channels/:channelId/pins/:messageId', () => {
    it('is idempotent: pinning an already-pinned message returns 204, not an error', async () => {
      const messageId = seedMessage(db, channelId, '111111111111111111', token)

      const first = await app.request(
        `/channels/${channelId}/pins/${messageId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(first.status).toBe(204)

      // Real Discord's pin endpoint is idempotent (matches discord.js/discord.py
      // client expectations); repeating the same pin must not error.
      const second = await app.request(
        `/channels/${channelId}/pins/${messageId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(second.status).toBe(204)
    })
  })

  describe('new-format pins API (/messages/pins)', () => {
    it('returns the {items, has_more} shape', async () => {
      const res = await app.request(`/channels/${channelId}/messages/pins`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        items: unknown[]
        has_more: boolean
      }
      expect(Array.isArray(body.items)).toBe(true)
      expect(body.has_more).toBe(false)
    })

    it('pins and unpins a message', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'pin me')

      const putRes = await app.request(
        `/channels/${channelId}/messages/pins/${messageId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(putRes.status).toBe(204)

      const listRes = await app.request(
        `/channels/${channelId}/messages/pins`,
        { headers: { Authorization: token } }
      )
      const listBody = (await listRes.json()) as { items: unknown[] }
      expect(listBody.items.length).toBe(1)

      const delRes = await app.request(
        `/channels/${channelId}/messages/pins/${messageId}`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(delRes.status).toBe(204)
    })

    it('returns 404 when pinning a non-existent message', async () => {
      const res = await app.request(
        `/channels/${channelId}/messages/pins/999999999999999999`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_008)
    })

    it('returns a valid ISO pinned_at timestamp for a pinned message', async () => {
      const authorId = '222222222222222222'
      db.prepare(
        "INSERT OR IGNORE INTO users (id, username) VALUES (?, 'Author')"
      ).run(authorId)
      const messageId = seedMessage(db, channelId, authorId, token)
      const pinRes = await app.request(
        `/channels/${channelId}/messages/pins/${messageId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(pinRes.status).toBe(204)

      const res = await app.request(`/channels/${channelId}/messages/pins`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        items: { pinned_at: string; message: { id: string } }[]
        has_more: boolean
      }
      expect(body.has_more).toBe(false)
      expect(body.items).toHaveLength(1)
      expect(body.items[0].message.id).toBe(messageId)
      // pinned_at must be a valid Discord-style ISO-8601 UTC timestamp
      // (microseconds + explicit +00:00 offset, matching real Discord and
      // twilight-model's strict parser, not a "Z"-suffixed toISOString()).
      expect(body.items[0].pinned_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/
      )
      expect(Number.isNaN(Date.parse(body.items[0].pinned_at))).toBe(false)
    })
  })

  describe('legacy pins API (/pins)', () => {
    it('pins a message via the legacy route', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'legacy')

      const putRes = await app.request(
        `/channels/${channelId}/pins/${messageId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(putRes.status).toBe(204)

      const delRes = await app.request(
        `/channels/${channelId}/pins/${messageId}`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(delRes.status).toBe(204)
    })
  })
})
