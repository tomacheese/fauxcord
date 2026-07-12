import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelTypingRoutes } from './channel-typing'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'
import type { Database } from '../database'

describe('Channel Typing API', () => {
  let database: Database
  let app: Hono
  let channelId: string
  let token: string

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelTypingRoutes(database))

    token = seedBot(database)
    const guildId = seedGuild(database, token)
    channelId = seedChannel(database, guildId)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('POST /channels/:channelId/typing', () => {
    it('returns 204 with an empty body for an existing channel', async () => {
      const resource = await app.request(`/channels/${channelId}/typing`, {
        method: 'POST',
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(204)
      expect(await resource.text()).toBe('')
    })

    it('returns 404 for an unknown channel', async () => {
      const resource = await app.request(
        '/channels/999999999999999999/typing',
        {
          method: 'POST',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_003) // UNKNOWN_CHANNEL
    })
  })
})
