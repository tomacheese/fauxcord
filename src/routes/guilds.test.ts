import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildRoutes } from './guilds.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild } from '../test-helpers.js'
import type { Database } from '../db.js'

describe('Guilds API', () => {
  let db: Database
  let app: Hono
  let guildId: string
  let token: string

  /**
   * Inserts a test Role into the database.
   * @param roleId - Role ID
   * @param name - Role name
   */
  function seedRole(roleId: string, name = 'Test Role'): string {
    db.prepare(
      'INSERT INTO roles (id, guild_id, name, position) VALUES (?, ?, ?, 1)'
    ).run(roleId, guildId, name)
    return roleId
  }

  /**
   * Inserts a test Guild member into the database.
   * @param userId - User ID
   * @param nick - Nickname
   */
  function seedMember(userId: string, nick: string | null = null): string {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, username) VALUES (?, 'TestUser')"
    ).run(userId)
    db.prepare(
      'INSERT INTO guild_members (guild_id, user_id, nick) VALUES (?, ?, ?)'
    ).run(guildId, userId, nick)
    return userId
  }

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

    it('returns 404 for a non-existent Guild', async () => {
      const res = await app.request('/guilds/999999999999999999', {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'X' }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
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

  describe('PATCH /guilds/:guildId/roles/:roleId', () => {
    it('updates a role', async () => {
      const roleId = seedRole('444444444444444444')
      const res = await app.request(`/guilds/${guildId}/roles/${roleId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Role',
          color: 0xff_00_00,
          hoist: true,
          mentionable: true,
          permissions: '8',
        }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(roleId)
      expect(body.name).toBe('Updated Role')
      expect(body.color).toBe(0xff_00_00)
      expect(body.hoist).toBe(true)
      expect(body.mentionable).toBe(true)
      expect(body.permissions).toBe('8')
    })

    it('updates only the specified fields', async () => {
      const roleId = seedRole('444444444444444444', 'Original')
      const res = await app.request(`/guilds/${guildId}/roles/${roleId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ color: 123 }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.name).toBe('Original')
      expect(body.color).toBe(123)
    })

    it('returns 404 (10004) for a non-existent Guild', async () => {
      const res = await app.request(
        '/guilds/999999999999999999/roles/444444444444444444',
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'X' }),
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
    })

    it('returns 404 (10011) for a non-existent Role', async () => {
      const res = await app.request(
        `/guilds/${guildId}/roles/999999999999999999`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'X' }),
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_011)
    })
  })

  describe('DELETE /guilds/:guildId/roles/:roleId', () => {
    it('deletes a role', async () => {
      const roleId = seedRole('444444444444444444')
      const res = await app.request(`/guilds/${guildId}/roles/${roleId}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(204)

      // The deleted role should not appear in the role list
      const listRes = await app.request(`/guilds/${guildId}/roles`, {
        headers: { Authorization: token },
      })
      const roles = (await listRes.json()) as { id: string }[]
      expect(roles.some((r) => r.id === roleId)).toBe(false)
    })

    it('returns 404 (10011) for a non-existent Role', async () => {
      const res = await app.request(
        `/guilds/${guildId}/roles/999999999999999999`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_011)
    })

    it('returns 400 when attempting to delete the @everyone role (id == guild_id)', async () => {
      // The @everyone role has the same id as the guild_id
      seedRole(guildId, '@everyone')
      const res = await app.request(`/guilds/${guildId}/roles/${guildId}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /guilds/:guildId/members/:userId', () => {
    it('updates the nickname', async () => {
      const userId = seedMember('555555555555555555')
      const res = await app.request(`/guilds/${guildId}/members/${userId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nick: 'NewNick' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        nick: unknown
        user: Record<string, unknown>
      }
      expect(body.nick).toBe('NewNick')
      expect(body.user.id).toBe(userId)
    })

    it('clears the nickname when nick is set to null', async () => {
      const userId = seedMember('555555555555555555', 'OldNick')
      const res = await app.request(`/guilds/${guildId}/members/${userId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nick: null }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.nick).toBeNull()
    })

    it('assigns roles to a member', async () => {
      const userId = seedMember('555555555555555555')
      const roleId = seedRole('444444444444444444')
      const res = await app.request(`/guilds/${guildId}/members/${userId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roles: [roleId] }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.roles).toEqual([roleId])
    })

    it('returns 404 (10011) when a non-existent role is specified', async () => {
      const userId = seedMember('555555555555555555')
      const res = await app.request(`/guilds/${guildId}/members/${userId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roles: ['999999999999999999'] }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_011)
    })

    it('returns 404 (10007) for a non-existent member', async () => {
      const res = await app.request(
        `/guilds/${guildId}/members/999999999999999999`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nick: 'X' }),
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_007)
    })
  })

  describe('DELETE /guilds/:guildId/members/:userId', () => {
    it('kicks a member', async () => {
      const userId = seedMember('555555555555555555')
      const res = await app.request(`/guilds/${guildId}/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(204)

      // The kicked member should not be retrievable
      const getRes = await app.request(`/guilds/${guildId}/members/${userId}`, {
        headers: { Authorization: token },
      })
      expect(getRes.status).toBe(404)
    })

    it('returns 404 (10007) for a non-existent member', async () => {
      const res = await app.request(
        `/guilds/${guildId}/members/999999999999999999`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_007)
    })
  })
})
