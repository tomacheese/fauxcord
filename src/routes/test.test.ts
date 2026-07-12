import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestRoutes } from './test'
import { initializeDatabase, closeDatabase } from '../db'
import type { Database } from '../db'

const BASE_URL = 'http://localhost:3000'

describe('Test Control API', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createTestRoutes(db, BASE_URL))
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('POST /_test/setup', () => {
    it('sets up the test environment', async () => {
      const res = await app.request('/_test/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'Bot testtoken',
          user: { id: '111111111111111111', username: 'TestBot' },
          guilds: [
            {
              id: '222222222222222222',
              name: 'Test Guild',
              channels: [
                { id: '333333333333333333', name: 'general', type: 0 },
              ],
            },
          ],
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        token: string
        user: Record<string, unknown>
        guilds: { channels: Record<string, unknown>[] }[]
      }
      expect(body.token).toBe('Bot testtoken')
      expect(body.user.id).toBe('111111111111111111')
      expect(body.guilds[0].channels[0].id).toBe('333333333333333333')
    })

    it('auto-generates IDs when omitted', async () => {
      const res = await app.request('/_test/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'Bot autotoken',
          guilds: [
            {
              name: 'Auto Guild',
              channels: [{ name: 'auto-channel', type: 0 }],
            },
          ],
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        guilds: { id: unknown; channels: { id: unknown }[] }[]
      }
      expect(body.guilds[0].id).toBeTruthy()
      expect(body.guilds[0].channels[0].id).toBeTruthy()
    })

    it('registers the bot as a member of every created guild', async () => {
      // Real Discord API: a bot present in a guild always appears in that
      // guild's member list. Without a guild_members row, GET/PATCH/PUT/DELETE
      // /guilds/{id}/members/{bot_id}* all 404 for the bot itself, breaking
      // any client library that manages its own guild member (e.g. self
      // role assignment) — confirmed via a real Discord.Net compat run
      // (compat/dotnet-discordnet) where RestGuild.GetUserAsync(botId)
      // silently returned null because of exactly this gap.
      const res = await app.request('/_test/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'Bot membertoken',
          user: { id: '111111111111111111', username: 'TestBot' },
          guilds: [{ id: '222222222222222222', name: 'Test Guild' }],
        }),
      })
      expect(res.status).toBe(201)

      const memberRow = db
        .prepare(
          'SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?'
        )
        .get('222222222222222222', '111111111111111111')
      expect(memberRow).toBeTruthy()
    })

    it('returns 409 for a duplicate token', async () => {
      const setupBody = JSON.stringify({
        token: 'Bot duplicatetoken',
        guilds: [],
      })

      await app.request('/_test/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: setupBody,
      })

      const res = await app.request('/_test/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: setupBody,
      })
      expect(res.status).toBe(409)
    })
  })

  describe('POST /_test/users', () => {
    it('registers a non-bot user with an auto-generated ID', async () => {
      const res = await app.request('/_test/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'TestHuman' }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        id: string
        username: string
        discriminator: string
      }
      expect(body.id).toBeTruthy()
      expect(body.username).toBe('TestHuman')
      expect(body.discriminator).toBe('0')

      const row = db
        .prepare('SELECT bot FROM users WHERE id = ?')
        .get(body.id) as { bot: number }
      expect(row.bot).toBe(0)
    })

    it('registers a non-bot user with an explicit ID', async () => {
      const res = await app.request('/_test/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '555555555555555555',
          username: 'TestHuman',
          discriminator: '1234',
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { id: string; discriminator: string }
      expect(body.id).toBe('555555555555555555')
      expect(body.discriminator).toBe('1234')
    })

    it('returns 409 when the explicit ID already exists', async () => {
      const payload = JSON.stringify({
        id: '555555555555555555',
        username: 'TestHuman',
      })
      await app.request('/_test/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
      const res = await app.request('/_test/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
      expect(res.status).toBe(409)
    })

    it('returns 400 when username is missing', async () => {
      const res = await app.request('/_test/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /_test/reset', () => {
    it('resets all data', async () => {
      const res = await app.request('/_test/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(204)
    })
  })

  describe('GET /_test/messages/:channelId', () => {
    it('retrieves messages for a channel', async () => {
      const res = await app.request('/_test/messages/333333333333333333')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toHaveProperty('messages')
      expect(Array.isArray(body.messages)).toBe(true)
    })
  })
})
