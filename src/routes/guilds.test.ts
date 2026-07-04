import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildRoutes } from './guilds'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild } from '../test-helpers'
import type { Database } from '../db'

describe('Guilds API', () => {
  let db: Database
  let app: Hono
  let guildId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createGuildRoutes(db))

    token = seedBot(db)
    guildId = seedGuild(db, token)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('PATCH /guilds/:guildId', () => {
    it('updates the Guild name', async () => {
      const res = await app.request(`/guilds/${guildId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Updated Guild' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(guildId)
      expect(body.name).toBe('Updated Guild')
    })

    it('leaves name unchanged when omitted from the request', async () => {
      const res = await app.request(`/guilds/${guildId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.name).toBe('Test Guild')
    })

    it('treats an empty request body as no changes (does not 500)', async () => {
      // Some libraries send a PATCH with no body at all; the mock must not crash
      // on JSON.parse of an empty body.
      const res = await app.request(`/guilds/${guildId}`, {
        method: 'PATCH',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.name).toBe('Test Guild')
    })

    it('returns 404 for a non-existent Guild', async () => {
      const res = await app.request('/guilds/999999999999999999', {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Valid Name' }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
    })

    it('returns 400 when name is shorter than the minimum length', async () => {
      const res = await app.request(`/guilds/${guildId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'a' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })
  })

  describe('DELETE /guilds/:guildId', () => {
    it('deletes a Guild', async () => {
      const res = await app.request(`/guilds/${guildId}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(204)

      // The deleted Guild should not be retrievable
      const getRes = await app.request(`/guilds/${guildId}`, {
        headers: { Authorization: token },
      })
      expect(getRes.status).toBe(404)
    })

    it('returns 404 for a non-existent Guild', async () => {
      const res = await app.request('/guilds/999999999999999999', {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
    })
  })
})
