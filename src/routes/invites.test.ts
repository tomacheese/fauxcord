import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createInviteRoutes } from './invites'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot, seedGuild, seedChannel, seedInvite } from '../test-helpers'
import type { Database } from '../database'

describe('Invites API', () => {
  let database: Database
  let app: Hono
  let code: string
  let token: string

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createInviteRoutes(database))

    token = seedBot(database)
    const guildId = seedGuild(database, token)
    const channelId = seedChannel(database, guildId)
    code = seedInvite(database, channelId, guildId, '111111111111111111')
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('GET /invites/:code', () => {
    it('retrieves an invite by code', async () => {
      const resource = await app.request(`/invites/${code}`, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { code: string; type: number }
      expect(body.code).toBe(code)
      expect(body.type).toBe(0)
    })

    it('returns 404 for an unknown code', async () => {
      const resource = await app.request('/invites/nonexistent', {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
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

      const resource = await app.request(`/invites/${code}`, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(404)
    })

    it('returns 404 when deleting an unknown code', async () => {
      const resource = await app.request('/invites/nonexistent', {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_006)
    })
  })
})
