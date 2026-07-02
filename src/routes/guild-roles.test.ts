import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildRoleRoutes } from './guild-roles.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild } from '../test-helpers.js'
import type { Database } from '../db.js'

describe('Guild Roles API', () => {
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

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createGuildRoleRoutes(db))

    token = seedBot(db)
    guildId = seedGuild(db, token)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('POST /guilds/:guildId/roles', () => {
    it('creates a role with default values when the payload is empty', async () => {
      const res = await app.request(`/guilds/${guildId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { name: string; color: number }
      expect(body.name).toBe('new role')
      expect(body.color).toBe(0)
    })

    it('returns 400 when color is out of the valid RGB range', async () => {
      const res = await app.request(`/guilds/${guildId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: 0xff_ff_ff + 1 }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('returns 400 when permissions is not a numeric string', async () => {
      const res = await app.request(`/guilds/${guildId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: 'not-a-number' }),
      })
      expect(res.status).toBe(400)
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
})
