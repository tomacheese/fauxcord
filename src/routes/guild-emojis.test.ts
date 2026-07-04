import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildEmojiRoutes } from './guild-emojis'
import { initializeDatabase, closeDatabase } from '../db'
import {
  seedBot,
  seedGuild,
  seedEmoji,
  createFullTestApp,
} from '../test-helpers'
import type { Database } from '../db'

describe('Guild Emojis API', () => {
  let db: Database
  let app: Hono
  let guildId: string
  let token: string
  let userId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createGuildEmojiRoutes(db))

    userId = '111111111111111111'
    token = seedBot(db)
    guildId = seedGuild(db, token)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('GET /guilds/:guildId/emojis', () => {
    it('returns an empty array when the guild has no emojis', async () => {
      const res = await app.request(`/guilds/${guildId}/emojis`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(body).toEqual([])
    })

    it('returns the seeded emojis', async () => {
      seedEmoji(db, guildId, userId, 'alpha')
      seedEmoji(db, guildId, userId, 'beta')
      const res = await app.request(`/guilds/${guildId}/emojis`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { name: string }[]
      expect(body).toHaveLength(2)
      expect(body.map((e) => e.name)).toContain('alpha')
    })

    it('returns 404 (10004) for a non-existent guild', async () => {
      const res = await app.request('/guilds/999999999999999999/emojis', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })

  describe('GET /guilds/:guildId/emojis/:emojiId', () => {
    it('returns a single emoji', async () => {
      const emojiId = seedEmoji(db, guildId, userId, 'single')
      const res = await app.request(`/guilds/${guildId}/emojis/${emojiId}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(emojiId)
      expect(body.name).toBe('single')
      expect(body.require_colons).toBe(true)
      expect(body.animated).toBe(false)
      expect(body.available).toBe(true)
      expect(body.roles).toEqual([])
      expect((body.user as { id: string }).id).toBe(userId)
    })

    it('returns 404 (10014) for a non-existent emoji', async () => {
      const res = await app.request(
        `/guilds/${guildId}/emojis/999999999999999999`,
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_014)
    })

    it('returns 404 (10004) for a non-existent guild', async () => {
      const res = await app.request('/guilds/999999999999999999/emojis/123', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })

  describe('POST /guilds/:guildId/emojis', () => {
    it('creates an emoji and returns 201 with the creator as user', async () => {
      const res = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'my_emoji',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.name).toBe('my_emoji')
      expect(body.roles).toEqual([])
      expect(body.managed).toBe(false)
      expect((body.user as { id: string }).id).toBe(userId)
    })

    it('stores the provided roles', async () => {
      const res = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'roled',
          image: 'data:image/png;base64,iVBORw0KGgo=',
          roles: ['123', '456'],
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { roles: string[] }
      expect(body.roles).toEqual(['123', '456'])
    })

    it('returns 400 (50035) when name is missing', async () => {
      const res = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgo=' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('returns 400 when name is too short', async () => {
      const res = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'a',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when image is missing', async () => {
      const res = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'no_image' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('returns 400 when roles is not an array of strings', async () => {
      const res = await app.request(`/guilds/${guildId}/emojis`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bad_roles',
          image: 'data:image/png;base64,iVBORw0KGgo=',
          roles: 'not-an-array',
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('returns 404 (10004) for a non-existent guild', async () => {
      const res = await app.request('/guilds/999999999999999999/emojis', {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'x_emoji',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })

  describe('PATCH /guilds/:guildId/emojis/:emojiId', () => {
    it('updates the emoji name', async () => {
      const emojiId = seedEmoji(db, guildId, userId, 'before')
      const res = await app.request(`/guilds/${guildId}/emojis/${emojiId}`, {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'after' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { name: string }
      expect(body.name).toBe('after')
    })

    it('updates the emoji roles', async () => {
      const emojiId = seedEmoji(db, guildId, userId, 'roles_update')
      const res = await app.request(`/guilds/${guildId}/emojis/${emojiId}`, {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['789'] }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { roles: string[] }
      expect(body.roles).toEqual(['789'])
    })

    it('returns 404 (10014) for a non-existent emoji', async () => {
      const res = await app.request(
        `/guilds/${guildId}/emojis/999999999999999999`,
        {
          method: 'PATCH',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'nope' }),
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_014)
    })

    it('returns 400 when the new name is too long', async () => {
      const emojiId = seedEmoji(db, guildId, userId, 'longname')
      const res = await app.request(`/guilds/${guildId}/emojis/${emojiId}`, {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(33) }),
      })
      expect(res.status).toBe(400)
    })

    it('treats an empty request body as no changes (does not 500)', async () => {
      // Some libraries (e.g. @discordjs/rest via a bare PATCH call) send no
      // body at all; the mock must not crash on JSON.parse of an empty body.
      const emojiId = seedEmoji(db, guildId, userId, 'no_body')
      const res = await app.request(`/guilds/${guildId}/emojis/${emojiId}`, {
        method: 'PATCH',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { name: string }
      expect(body.name).toBe('no_body')
    })
  })

  describe('DELETE /guilds/:guildId/emojis/:emojiId', () => {
    it('deletes an emoji', async () => {
      const emojiId = seedEmoji(db, guildId, userId, 'to_delete')
      const res = await app.request(`/guilds/${guildId}/emojis/${emojiId}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(204)

      const listRes = await app.request(`/guilds/${guildId}/emojis`, {
        headers: { Authorization: token },
      })
      const emojis = (await listRes.json()) as { id: string }[]
      expect(emojis.some((e) => e.id === emojiId)).toBe(false)
    })

    it('returns 404 (10014) for a non-existent emoji', async () => {
      const res = await app.request(
        `/guilds/${guildId}/emojis/999999999999999999`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_014)
    })
  })

  describe('authentication', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      const { app: fullApp, db: fullDb } = createFullTestApp()
      const authedToken = seedBot(fullDb)
      const authedGuild = seedGuild(fullDb, authedToken)
      const res = await fullApp.request(`/api/v10/guilds/${authedGuild}/emojis`)
      expect(res.status).toBe(401)
      closeDatabase(fullDb)
    })
  })
})
