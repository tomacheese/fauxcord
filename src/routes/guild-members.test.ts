import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildMemberRoutes } from './guild-members'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot, seedGuild, createFullTestApp } from '../test-helpers'
import type { Database } from '../database'

describe('Guild Members API', () => {
  let database: Database
  let app: Hono
  let guildId: string
  let token: string

  /**
   * Inserts a test Role into the database.
   * @param roleId - Role ID
   * @param name - Role name
   */
  function seedRole(roleId: string, name = 'Test Role'): string {
    database
      .prepare(
        'INSERT INTO roles (id, guild_id, name, position) VALUES (?, ?, ?, 1)'
      )
      .run(roleId, guildId, name)
    return roleId
  }

  /**
   * Inserts a test Guild member into the database.
   * @param userId - User ID
   * @param nick - Nickname
   */
  function seedMember(userId: string, nick: string | null = null): string {
    database
      .prepare(
        "INSERT OR IGNORE INTO users (id, username) VALUES (?, 'TestUser')"
      )
      .run(userId)
    database
      .prepare(
        'INSERT INTO guild_members (guild_id, user_id, nick) VALUES (?, ?, ?)'
      )
      .run(guildId, userId, nick)
    return userId
  }

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createGuildMemberRoutes(database))

    token = seedBot(database)
    guildId = seedGuild(database, token)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('PATCH /guilds/:guildId/members/:userId', () => {
    it('updates the nickname', async () => {
      const userId = seedMember('555555555555555555')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nick: 'NewNick' }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as {
        nick: unknown
        user: Record<string, unknown>
      }
      expect(body.nick).toBe('NewNick')
      expect(body.user.id).toBe(userId)
    })

    it('clears the nickname when nick is set to null', async () => {
      const userId = seedMember('555555555555555555', 'OldNick')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nick: null }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.nick).toBeNull()
    })

    it('assigns roles to a member', async () => {
      const userId = seedMember('555555555555555555')
      const roleId = seedRole('444444444444444444')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ roles: [roleId] }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.roles).toEqual([roleId])
    })

    it('returns 404 (10011) when a non-existent role is specified', async () => {
      const userId = seedMember('555555555555555555')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ roles: ['999999999999999999'] }),
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_011)
    })

    it('returns 404 (10007) for a non-existent member', async () => {
      const resource = await app.request(
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
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_007)
    })

    it('returns 400 when nick exceeds the 32-character limit', async () => {
      const userId = seedMember('555555555555555555')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nick: 'a'.repeat(33) }),
        }
      )
      expect(resource.status).toBe(400)
    })

    it('does not fail when duplicate role IDs are sent', async () => {
      const userId = seedMember('555555555555555555')
      const roleId = seedRole('444444444444444444')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ roles: [roleId, roleId] }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.roles).toEqual([roleId])
    })

    it('returns role IDs in a stable, sorted order', async () => {
      const userId = seedMember('555555555555555555')
      const roleA = seedRole('444444444444444444')
      const roleB = seedRole('333333333333333333')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ roles: [roleA, roleB] }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { roles: string[] }
      expect(body.roles).toEqual(
        body.roles.toSorted((a, b) => a.localeCompare(b))
      )
    })
  })

  describe('PUT /guilds/:guildId/members/:userId/roles/:roleId', () => {
    it('adds a role to a member', async () => {
      const userId = seedMember('555555555555555555')
      const roleId = seedRole('444444444444444444')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(204)

      const memberResource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          headers: { Authorization: token },
        }
      )
      const member = (await memberResource.json()) as { roles: string[] }
      expect(member.roles).toContain(roleId)
    })

    it('is idempotent when the role is already assigned', async () => {
      const userId = seedMember('555555555555555555')
      const roleId = seedRole('444444444444444444')
      await app.request(
        `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        {
          method: 'PUT',
          headers: { Authorization: token },
        }
      )
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(204)
    })

    it('returns 404 (10004) for a non-existent guild', async () => {
      const resource = await app.request(
        '/guilds/999999999999999999/members/555555555555555555/roles/444444444444444444',
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
    })

    it('returns 404 (10011) for a non-existent role', async () => {
      const userId = seedMember('555555555555555555')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}/roles/999999999999999999`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_011)
    })

    it('returns 404 (10007) for a non-existent member', async () => {
      const roleId = seedRole('444444444444444444')
      const resource = await app.request(
        `/guilds/${guildId}/members/999999999999999999/roles/${roleId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_007)
    })

    it('returns 400 when targeting the @everyone role', async () => {
      const userId = seedMember('555555555555555555')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}/roles/${guildId}`,
        { method: 'PUT', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(50_028)
    })
  })

  describe('DELETE /guilds/:guildId/members/:userId/roles/:roleId', () => {
    it('removes a role from a member', async () => {
      const userId = seedMember('555555555555555555')
      const roleId = seedRole('444444444444444444')
      await app.request(`/guilds/${guildId}/members/${userId}`, {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [roleId] }),
      })

      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(204)

      const memberResource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          headers: { Authorization: token },
        }
      )
      const member = (await memberResource.json()) as { roles: string[] }
      expect(member.roles).not.toContain(roleId)
    })

    it('is idempotent when the role is not assigned', async () => {
      const userId = seedMember('555555555555555555')
      const roleId = seedRole('444444444444444444')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(204)
    })

    it('returns 404 (10004) for a non-existent guild', async () => {
      const resource = await app.request(
        '/guilds/999999999999999999/members/555555555555555555/roles/444444444444444444',
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_004)
    })

    it('returns 404 (10011) for a non-existent role', async () => {
      const userId = seedMember('555555555555555555')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}/roles/999999999999999999`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_011)
    })

    it('returns 404 (10007) for a non-existent member', async () => {
      const roleId = seedRole('444444444444444444')
      const resource = await app.request(
        `/guilds/${guildId}/members/999999999999999999/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_007)
    })

    it('returns 400 when targeting the @everyone role', async () => {
      const userId = seedMember('555555555555555555')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}/roles/${guildId}`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(50_028)
    })
  })

  describe('DELETE /guilds/:guildId/members/:userId', () => {
    it('kicks a member', async () => {
      const userId = seedMember('555555555555555555')
      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(204)

      // The kicked member should not be retrievable
      const fetchedResponse = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          headers: { Authorization: token },
        }
      )
      expect(fetchedResponse.status).toBe(404)
    })

    it('returns 404 (10007) for a non-existent member', async () => {
      const resource = await app.request(
        `/guilds/${guildId}/members/999999999999999999`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_007)
    })

    it('deletes the member role assignments so they do not orphan', async () => {
      const userId = seedMember('555555555555555555')
      const roleId = seedRole('444444444444444444')
      database
        .prepare(
          'INSERT INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'
        )
        .run(guildId, userId, roleId)

      const resource = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(resource.status).toBe(204)

      const remaining = database
        .prepare(
          'SELECT COUNT(*) as count FROM member_roles WHERE guild_id = ? AND user_id = ?'
        )
        .get(guildId, userId) as { count: number }
      expect(remaining.count).toBe(0)
    })
  })

  describe('guild-existence checks', () => {
    const UNKNOWN_GUILD = '999999999999999999'

    it('GET members returns 404 Unknown Guild for a nonexistent guild', async () => {
      const resource = await app.request(`/guilds/${UNKNOWN_GUILD}/members`, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })

    it('GET single member returns 404 Unknown Guild for a nonexistent guild', async () => {
      const resource = await app.request(
        `/guilds/${UNKNOWN_GUILD}/members/111111111111111111`,
        { headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })

    it('DELETE member returns 404 Unknown Guild for a nonexistent guild', async () => {
      const resource = await app.request(
        `/guilds/${UNKNOWN_GUILD}/members/111111111111111111`,
        { method: 'DELETE', headers: { Authorization: token } }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })
})

describe('PATCH /guilds/:guildId/members/@me', () => {
  // Real Discord API (see spec/openapi.json's
  // "/guilds/{guild_id}/members/@me") exposes a separate endpoint for a bot
  // to update its own guild member (nickname etc). Discord.Net's
  // RestGuildUser.ModifyAsync routes to this endpoint when the target is the
  // client's own user — confirmed via a real 404 "Unknown Member" in the
  // compat/dotnet-discordnet verifier, since Fauxcord previously had no route
  // for the literal "@me" path segment here (only /members/:userId, which
  // does not special-case "@me").
  let database: Database
  let app: ReturnType<typeof createFullTestApp>['app']
  let cleanup: () => void
  const token = 'Bot selftoken'
  const botUserId = '111111111111111111'
  let guildId: string

  beforeEach(() => {
    const context = createFullTestApp()
    database = context.db
    app = context.app
    cleanup = context.cleanup
    seedBot(database, token, botUserId)
    guildId = seedGuild(database, token)
    database
      .prepare('INSERT INTO guild_members (guild_id, user_id) VALUES (?, ?)')
      .run(guildId, botUserId)
  })

  afterEach(() => {
    cleanup()
  })

  it("updates the bot's own nickname via the @me alias", async () => {
    const resource = await app.request(
      `/api/v10/guilds/${guildId}/members/@me`,
      {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: 'compat' }),
      }
    )
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.nick).toBe('compat')

    const row = database
      .prepare(
        'SELECT nick FROM guild_members WHERE guild_id = ? AND user_id = ?'
      )
      .get(guildId, botUserId) as { nick: string | null }
    expect(row.nick).toBe('compat')
  })

  it('returns 404 (10007) when the bot is not a member of the guild', async () => {
    database
      .prepare('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?')
      .run(guildId, botUserId)

    const resource = await app.request(
      `/api/v10/guilds/${guildId}/members/@me`,
      {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: 'compat' }),
      }
    )
    expect(resource.status).toBe(404)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.code).toBe(10_007)
  })

  it('returns 404 (10004) Unknown Guild for a nonexistent guild', async () => {
    const resource = await app.request(
      '/api/v10/guilds/999999999999999999/members/@me',
      {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: 'compat' }),
      }
    )
    expect(resource.status).toBe(404)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.code).toBe(10_004)
  })
})
