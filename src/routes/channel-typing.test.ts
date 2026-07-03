import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelTypingRoutes } from './channel-typing'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'
import type { Database } from '../db'

describe('Channel Typing API', () => {
  let db: Database
  let app: Hono
  let channelId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelTypingRoutes(db))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('POST /channels/:channelId/typing', () => {
    it('returns 204 with an empty body for an existing channel', async () => {
      const res = await app.request(`/channels/${channelId}/typing`, {
        method: 'POST',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(204)
      expect(await res.text()).toBe('')
    })

    it('returns 404 for an unknown channel', async () => {
      const res = await app.request('/channels/999999999999999999/typing', {
        method: 'POST',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_003) // UNKNOWN_CHANNEL
    })
  })
})
