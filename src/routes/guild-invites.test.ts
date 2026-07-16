import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildInviteRoutes } from './guild-invites'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel, seedInvite } from '../test-helpers'
import type { Database } from '../db'

describe('Guild Invites API', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createGuildInviteRoutes(db))
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('GET /guilds/:guildId/invites', () => {
    it("lists a guild's invites", async () => {
      const token = seedBot(db)
      const guildId = seedGuild(db, token)
      const channelId = seedChannel(db, guildId)
      const code = seedInvite(db, channelId, guildId, '111111111111111111')

      const res = await app.request(`/guilds/${guildId}/invites`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { code: string }[]
      expect(body).toHaveLength(1)
      expect(body[0].code).toBe(code)
    })

    it('returns an empty array for a guild with no invites', async () => {
      const token = seedBot(db)
      const guildId = seedGuild(db, token)

      const res = await app.request(`/guilds/${guildId}/invites`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(body).toEqual([])
    })

    it('returns 404 for an unknown guild', async () => {
      const res = await app.request('/guilds/nonexistent/invites', {
        headers: { Authorization: 'Bot testtoken' },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })
})
