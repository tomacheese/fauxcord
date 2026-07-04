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
})
