import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGuildBanRoutes } from './guild-bans'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedMember, seedBan } from '../test-helpers'
import type { Database } from '../db'

describe('Guild Bans API', () => {
  let db: Database
  let app: Hono
  let guildId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createGuildBanRoutes(db))

    token = seedBot(db)
    guildId = seedGuild(db, token)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('PUT /guilds/:guildId/bans/:userId', () => {
    it('bans a user and returns 204', async () => {
      const userId = '444444444444444444'
      const res = await app.request(`/guilds/${guildId}/bans/${userId}`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(204)

      const row = db
        .prepare('SELECT * FROM guild_bans WHERE guild_id = ? AND user_id = ?')
        .get(guildId, userId) as { user_id: string } | undefined
      expect(row?.user_id).toBe(userId)
    })

    it('stores the X-Audit-Log-Reason header as the ban reason', async () => {
      const userId = '444444444444444444'
      await app.request(`/guilds/${guildId}/bans/${userId}`, {
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
          'X-Audit-Log-Reason': 'spamming',
        },
        body: JSON.stringify({}),
      })

      const res = await app.request(`/guilds/${guildId}/bans/${userId}`, {
        headers: { Authorization: token },
      })
      const body = (await res.json()) as { reason: string | null }
      expect(body.reason).toBe('spamming')
    })

    it('removes the banned user from guild membership', async () => {
      const memberId = seedMember(db, guildId, '444444444444444444')
      await app.request(`/guilds/${guildId}/bans/${memberId}`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const member = db
        .prepare(
          'SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?'
        )
        .get(guildId, memberId)
      expect(member).toBeUndefined()
    })

    it('succeeds with an empty body (no Content-Type)', async () => {
      const res = await app.request(
        `/guilds/${guildId}/bans/444444444444444444`,
        {
          method: 'PUT',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(204)
    })

    it('succeeds with a JSON null body (non-object payload)', async () => {
      const res = await app.request(
        `/guilds/${guildId}/bans/444444444444444444`,
        {
          method: 'PUT',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: 'null',
        }
      )
      expect(res.status).toBe(204)
    })

    it('succeeds with a JSON array body (non-object payload)', async () => {
      const res = await app.request(
        `/guilds/${guildId}/bans/444444444444444444`,
        {
          method: 'PUT',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: '[]',
        }
      )
      expect(res.status).toBe(204)
    })

    it('returns 400 when delete_message_days is out of range', async () => {
      const res = await app.request(
        `/guilds/${guildId}/bans/444444444444444444`,
        {
          method: 'PUT',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete_message_days: 8 }),
        }
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('returns 400 when delete_message_seconds is out of range', async () => {
      const res = await app.request(
        `/guilds/${guildId}/bans/444444444444444444`,
        {
          method: 'PUT',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete_message_seconds: 604_801 }),
        }
      )
      expect(res.status).toBe(400)
    })

    it('returns 404 when the guild does not exist', async () => {
      const res = await app.request(
        '/guilds/999999999999999999/bans/444444444444444444',
        {
          method: 'PUT',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })

    it('updates the reason when banning an already-banned user', async () => {
      const userId = seedBan(db, guildId, '444444444444444444', 'old reason')
      await app.request(`/guilds/${guildId}/bans/${userId}`, {
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
          'X-Audit-Log-Reason': 'new reason',
        },
        body: JSON.stringify({}),
      })
      const res = await app.request(`/guilds/${guildId}/bans/${userId}`, {
        headers: { Authorization: token },
      })
      const body = (await res.json()) as { reason: string | null }
      expect(body.reason).toBe('new reason')
    })
  })

  describe('GET /guilds/:guildId/bans/:userId', () => {
    it('returns the ban for a banned user', async () => {
      const userId = seedBan(db, guildId, '444444444444444444', 'reason here')
      const res = await app.request(`/guilds/${guildId}/bans/${userId}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        user: { id: string }
        reason: string | null
      }
      expect(body.user.id).toBe(userId)
      expect(body.reason).toBe('reason here')
    })

    it('synthesizes a user object when the banned user is not in the users table', async () => {
      const userId = '444444444444444444'
      db.prepare(
        'INSERT INTO guild_bans (guild_id, user_id, reason) VALUES (?, ?, ?)'
      ).run(guildId, userId, null)
      const res = await app.request(`/guilds/${guildId}/bans/${userId}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        user: { id: string; username: string }
      }
      expect(body.user.id).toBe(userId)
      expect(body.user.username).toBe('Unknown User')
    })

    it('returns 404 (Unknown Ban) when the user is not banned', async () => {
      const res = await app.request(
        `/guilds/${guildId}/bans/444444444444444444`,
        {
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_026)
    })

    it('returns 404 (Unknown Guild) when the guild does not exist', async () => {
      const res = await app.request(
        '/guilds/999999999999999999/bans/444444444444444444',
        {
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })

  describe('GET /guilds/:guildId/bans', () => {
    it('returns an empty array when there are no bans', async () => {
      const res = await app.request(`/guilds/${guildId}/bans`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(body).toEqual([])
    })

    it('returns all bans ordered by user_id', async () => {
      seedBan(db, guildId, '111111111111111112')
      seedBan(db, guildId, '333333333333333334')
      seedBan(db, guildId, '222222222222222223')

      const res = await app.request(`/guilds/${guildId}/bans`, {
        headers: { Authorization: token },
      })
      const body = (await res.json()) as { user: { id: string } }[]
      expect(body.map((b) => b.user.id)).toEqual([
        '111111111111111112',
        '222222222222222223',
        '333333333333333334',
      ])
    })

    it('respects the after cursor', async () => {
      seedBan(db, guildId, '111111111111111112')
      seedBan(db, guildId, '333333333333333334')

      const res = await app.request(
        `/guilds/${guildId}/bans?after=111111111111111112`,
        { headers: { Authorization: token } }
      )
      const body = (await res.json()) as { user: { id: string } }[]
      expect(body.map((b) => b.user.id)).toEqual(['333333333333333334'])
    })

    it('respects the limit query', async () => {
      seedBan(db, guildId, '111111111111111112')
      seedBan(db, guildId, '333333333333333334')

      const res = await app.request(`/guilds/${guildId}/bans?limit=1`, {
        headers: { Authorization: token },
      })
      const body = (await res.json()) as unknown[]
      expect(body).toHaveLength(1)
    })

    it('returns 404 when the guild does not exist', async () => {
      const res = await app.request('/guilds/999999999999999999/bans', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })

  describe('DELETE /guilds/:guildId/bans/:userId', () => {
    it('removes a ban and returns 204', async () => {
      const userId = seedBan(db, guildId, '444444444444444444')
      const res = await app.request(`/guilds/${guildId}/bans/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(204)

      const check = await app.request(`/guilds/${guildId}/bans/${userId}`, {
        headers: { Authorization: token },
      })
      expect(check.status).toBe(404)
    })

    it('returns 404 (Unknown Ban) when the user is not banned', async () => {
      const res = await app.request(
        `/guilds/${guildId}/bans/444444444444444444`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_026)
    })

    it('returns 404 (Unknown Guild) when the guild does not exist', async () => {
      const res = await app.request(
        '/guilds/999999999999999999/bans/444444444444444444',
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_004)
    })
  })
})
