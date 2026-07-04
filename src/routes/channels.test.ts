import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelRoutes } from './channels'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'
import type { Database } from '../db'

const BASE_URL = 'http://localhost:3000'

describe('Channels API', () => {
  let db: Database
  let app: Hono
  let channelId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelRoutes(db, BASE_URL))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('GET /channels/:channelId', () => {
    it('retrieves a channel', async () => {
      const res = await app.request(`/channels/${channelId}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(channelId)
      expect(body.name).toBe('general')
    })

    it('returns 404 for a non-existent channel', async () => {
      const res = await app.request('/channels/999999999999999999', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_003)
    })
  })

  describe('PATCH /channels/:channelId', () => {
    it('updates the channel name', async () => {
      const res = await app.request(`/channels/${channelId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'updated-channel' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.name).toBe('updated-channel')
    })

    it('rejects an empty name with a validation error', async () => {
      const res = await app.request(`/channels/${channelId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: '' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })

    it('rejects an out-of-range rate_limit_per_user', async () => {
      const res = await app.request(`/channels/${channelId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rate_limit_per_user: 999_999 }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })

    it('rejects a topic longer than 1024 characters', async () => {
      const res = await app.request(`/channels/${channelId}`, {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topic: 'a'.repeat(1025) }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })
  })
})
