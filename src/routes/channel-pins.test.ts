import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelPinRoutes } from './channel-pins.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild, seedChannel } from '../test-helpers.js'
import type { Database } from '../db.js'

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
})
