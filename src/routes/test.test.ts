import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestRoutes } from './test'
import { initializeDatabase, closeDatabase } from '../database'
import type { Database } from '../database'

describe('Test Control API', () => {
  let database: Database
  let app: Hono

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createTestRoutes(database))
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('POST /_test/setup', () => {
    it('sets up the test environment', async () => {
      const resource = await app.request('/_test/setup', {
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
      expect(resource.status).toBe(201)
      const body = (await resource.json()) as {
        token: string
        user: Record<string, unknown>
        guilds: { channels: Record<string, unknown>[] }[]
      }
      expect(body.token).toBe('Bot testtoken')
      expect(body.user.id).toBe('111111111111111111')
      expect(body.guilds[0].channels[0].id).toBe('333333333333333333')
    })

    it('auto-generates IDs when omitted', async () => {
      const resource = await app.request('/_test/setup', {
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
      expect(resource.status).toBe(201)
      const body = (await resource.json()) as {
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
      const resource = await app.request('/_test/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'Bot membertoken',
          user: { id: '111111111111111111', username: 'TestBot' },
          guilds: [{ id: '222222222222222222', name: 'Test Guild' }],
        }),
      })
      expect(resource.status).toBe(201)

      const memberRow = database
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

      const resource = await app.request('/_test/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: setupBody,
      })
      expect(resource.status).toBe(409)
    })
  })

  describe('POST /_test/reset', () => {
    it('resets all data', async () => {
      const resource = await app.request('/_test/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(resource.status).toBe(204)
    })
  })

  describe('GET /_test/messages/:channelId', () => {
    it('retrieves messages for a channel', async () => {
      const resource = await app.request('/_test/messages/333333333333333333')
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body).toHaveProperty('messages')
      expect(Array.isArray(body.messages)).toBe(true)
    })
  })
})
