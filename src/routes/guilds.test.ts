import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildRoutes } from './guilds'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot, seedGuild } from '../test-helpers'
import type { Database } from '../database'

describe('Guilds API', () => {
  let database: Database
  let app: Hono
  let guildId: string
  let token: string

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createGuildRoutes(database))

    token = seedBot(database)
    guildId = seedGuild(database, token)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('PATCH /guilds/:guildId', () => {
    it('updates the Guild name', async () => {
      const resource = await app.request(`/guilds/${guildId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Updated Guild' }),
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.id).toBe(guildId)
      expect(body.name).toBe('Updated Guild')
    })

    it('leaves name unchanged when omitted from the request', async () => {
      const resource = await app.request(`/guilds/${guildId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.name).toBe('Test Guild')
    })

    it('treats an empty request body as no changes (does not 500)', async () => {
      // Some libraries send a PATCH with no body at all; the mock must not crash
      // on JSON.parse of an empty body.
      const resource = await app.request(`/guilds/${guildId}`, {
        method: 'PATCH',
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.name).toBe('Test Guild')
    })

    it('returns 404 for a non-existent Guild', async () => {
      const resource = await app.request('/guilds/999999999999999999', {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Valid Name' }),
      })
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
    })

    it('returns 400 when name is shorter than the minimum length', async () => {
      const resource = await app.request(`/guilds/${guildId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'a' }),
      })
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })
  })

  describe('GET /guilds/:guildId', () => {
    it('includes the spec-required GuildResponse fields with defaults', async () => {
      // Strict deserializers (e.g. serenity's PartialGuild) reject a guild
      // object that omits any spec-required field, so every field below is
      // part of the OpenAPI GuildResponse `required` set.
      const resource = await app.request(`/guilds/${guildId}`, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.system_channel_flags).toBe(0)
      expect(body.nsfw_level).toBe(0)
      expect(body.nsfw).toBe(false)
      expect(body.region).toBe('deprecated')
      expect(body.stickers).toEqual([])
      expect(body.incidents_data).toBeNull()
      expect(body.afk_channel_id).toBeNull()
      expect(body.premium_progress_bar_enabled).toBe(false)
    })
  })

  describe('DELETE /guilds/:guildId', () => {
    it('deletes a Guild', async () => {
      const resource = await app.request(`/guilds/${guildId}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(204)

      // The deleted Guild should not be retrievable
      const fetchedResponse = await app.request(`/guilds/${guildId}`, {
        headers: { Authorization: token },
      })
      expect(fetchedResponse.status).toBe(404)
    })

    it('returns 404 for a non-existent Guild', async () => {
      const resource = await app.request('/guilds/999999999999999999', {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
    })
  })

  describe('GET /guilds/:guildId/webhooks', () => {
    it('returns the webhook list for an existing guild', async () => {
      const resource = await app.request(`/guilds/${guildId}/webhooks`, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      expect(Array.isArray(await resource.json())).toBe(true)
    })

    it('returns 404 Unknown Guild for a non-existent guild', async () => {
      const resource = await app.request(
        '/guilds/999999999999999999/webhooks',
        {
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
    })
  })
})
