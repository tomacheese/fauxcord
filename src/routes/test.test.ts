import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestRoutes } from './test'
import { initializeDatabase, closeDatabase } from '../db'
import type { Database } from '../db'

describe('Test Control API', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createTestRoutes(db))
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
