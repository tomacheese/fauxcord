import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildEmojiRoutes } from './guild-emojis'
import { initializeDatabase, closeDatabase } from '../database'
import {
  seedBot,
  seedGuild,
  seedEmoji,
  createFullTestApp,
} from '../test-helpers'
import type { Database } from '../database'

describe('Guild Emojis API', () => {
  let database: Database
  let app: Hono
  let guildId: string
  let token: string
  let userId: string

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createGuildEmojiRoutes(database))

    userId = '111111111111111111'
    token = seedBot(database)
    guildId = seedGuild(database, token)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('GET /guilds/:guildId/emojis', () => {
    it('returns an empty array when the guild has no emojis', async () => {
      const resource = await app.request(`/guilds/${guildId}/emojis`, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as unknown[]
      expect(body).toEqual([])
    })

    it('returns the seeded emojis', async () => {
      seedEmoji(database, guildId, userId, 'alpha')
      seedEmoji(database, guildId, userId, 'beta')
      const resource = await app.request(`/guilds/${guildId}/emojis`, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { name: string }[]
      expect(body).toHaveLength(2)
      expect(body.map((error) => error.name)).toContain('alpha')
    })

    it('returns 404 (10004) for a non-existent guild', async () => {
      const resource = await app.request('/guilds/999999999999999999/emojis', {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })

  describe('GET /guilds/:guildId/emojis/:emojiId', () => {
    it('returns a single emoji', async () => {
      const emojiId = seedEmoji(database, guildId, userId, 'single')
      const resource = await app.request(
        `/guilds/${guildId}/emojis/${emojiId}`,
        {
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.id).toBe(emojiId)
      expect(body.name).toBe('single')
      expect(body.require_colons).toBe(true)
      expect(body.animated).toBe(false)
      expect(body.available).toBe(true)
      expect(body.roles).toEqual([])
      expect((body.user as { id: string }).id).toBe(userId)
    })

    it('returns 404 (10014) for a non-existent emoji', async () => {
      const resource = await app.request(
        `/guilds/${guildId}/emojis/999999999999999999`,
        { headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_014)
    })

    it('returns 404 (10004) for a non-existent guild', async () => {
      const resource = await app.request(
        '/guilds/999999999999999999/emojis/123',
        {
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })

  describe('POST /guilds/:guildId/emojis', () => {
    it('creates an emoji and returns 201 with the creator as user', async () => {
      const resource = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'my_emoji',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        }),
      })
      expect(resource.status).toBe(201)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.name).toBe('my_emoji')
      expect(body.roles).toEqual([])
      expect(body.managed).toBe(false)
      expect((body.user as { id: string }).id).toBe(userId)
    })

    it('stores the provided roles', async () => {
      const resource = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'roled',
          image: 'data:image/png;base64,iVBORw0KGgo=',
          roles: ['123', '456'],
        }),
      })
      expect(resource.status).toBe(201)
      const body = (await resource.json()) as { roles: string[] }
      expect(body.roles).toEqual(['123', '456'])
    })

    it('returns 400 (50035) when name is missing', async () => {
      const resource = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgo=' }),
      })
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('returns 400 when name is too short', async () => {
      const resource = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'a',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        }),
      })
      expect(resource.status).toBe(400)
    })

    it('returns 400 when image is missing', async () => {
      const resource = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'no_image' }),
      })
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('returns 400 when roles is not an array of strings', async () => {
      const resource = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bad_roles',
          image: 'data:image/png;base64,iVBORw0KGgo=',
          roles: 'not-an-array',
        }),
      })
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('returns 404 (10004) for a non-existent guild', async () => {
      const resource = await app.request('/guilds/999999999999999999/emojis', {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'x_emoji',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        }),
      })
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })

  describe('PATCH /guilds/:guildId/emojis/:emojiId', () => {
    it('updates the emoji name', async () => {
      const emojiId = seedEmoji(database, guildId, userId, 'before')
      const resource = await app.request(
        `/guilds/${guildId}/emojis/${emojiId}`,
        {
          method: 'PATCH',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'after' }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { name: string }
      expect(body.name).toBe('after')
    })

    it('updates the emoji roles', async () => {
      const emojiId = seedEmoji(database, guildId, userId, 'roles_update')
      const resource = await app.request(
        `/guilds/${guildId}/emojis/${emojiId}`,
        {
          method: 'PATCH',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roles: ['789'] }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { roles: string[] }
      expect(body.roles).toEqual(['789'])
    })

    it('returns 404 (10014) for a non-existent emoji', async () => {
      const resource = await app.request(
        `/guilds/${guildId}/emojis/999999999999999999`,
        {
          method: 'PATCH',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'nope' }),
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_014)
    })

    it('returns 400 when the new name is too long', async () => {
      const emojiId = seedEmoji(database, guildId, userId, 'longname')
      const resource = await app.request(
        `/guilds/${guildId}/emojis/${emojiId}`,
        {
          method: 'PATCH',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'x'.repeat(33) }),
        }
      )
      expect(resource.status).toBe(400)
    })

    it('treats an empty request body as no changes (does not 500)', async () => {
      // Some libraries (e.g. @discordjs/rest via a bare PATCH call) send no
      // body at all; the mock must not crash on JSON.parse of an empty body.
      const emojiId = seedEmoji(database, guildId, userId, 'no_body')
      const resource = await app.request(
        `/guilds/${guildId}/emojis/${emojiId}`,
        {
          method: 'PATCH',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { name: string }
      expect(body.name).toBe('no_body')
    })
  })

  describe('DELETE /guilds/:guildId/emojis/:emojiId', () => {
    it('deletes an emoji', async () => {
      const emojiId = seedEmoji(database, guildId, userId, 'to_delete')
      const resource = await app.request(
        `/guilds/${guildId}/emojis/${emojiId}`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(204)

      const listResource = await app.request(`/guilds/${guildId}/emojis`, {
        headers: { Authorization: token },
      })
      const emojis = (await listResource.json()) as { id: string }[]
      expect(emojis.some((error) => error.id === emojiId)).toBe(false)
    })

    it('returns 404 (10014) for a non-existent emoji', async () => {
      const resource = await app.request(
        `/guilds/${guildId}/emojis/999999999999999999`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_014)
    })
  })

  describe('authentication', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      const { app: fullApp, db: fullDatabase } = createFullTestApp()
      const authedToken = seedBot(fullDatabase)
      const authedGuild = seedGuild(fullDatabase, authedToken)
      const resource = await fullApp.request(
        `/api/v10/guilds/${authedGuild}/emojis`
      )
      expect(resource.status).toBe(401)
      closeDatabase(fullDatabase)
    })
  })
})
