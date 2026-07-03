import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createInviteRoutes } from './invites.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild, seedChannel, seedInvite } from '../test-helpers.js'
import type { Database } from '../db.js'

describe('Invites API', () => {
  let db: Database
  let app: Hono
  let code: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createInviteRoutes(db))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    const channelId = seedChannel(db, guildId)
    code = seedInvite(db, channelId, guildId, '111111111111111111')
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('GET /invites/:code', () => {
    it('retrieves an invite by code', async () => {
      const res = await app.request(`/invites/${code}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { code: string; type: number }
      expect(body.code).toBe(code)
      expect(body.type).toBe(0)
    })

    it('returns 404 for an unknown code', async () => {
      const res = await app.request('/invites/nonexistent', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_006)
    })
  })

  describe('DELETE /invites/:code', () => {
    it('deletes an invite', async () => {
      const del = await app.request(`/invites/${code}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(del.status).toBe(200)
      const body = (await del.json()) as { code: string }
      expect(body.code).toBe(code)

      const res = await app.request(`/invites/${code}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
    })

    it('returns 404 when deleting an unknown code', async () => {
      const res = await app.request('/invites/nonexistent', {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_006)
    })
  })
})
