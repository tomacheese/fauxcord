import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGatewayRoutes } from './gateway.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot } from '../test-helpers.js'
import type { Database } from '../db.js'
import type { AppEnv } from '../middleware/auth.js'

const BASE_URL = 'http://localhost:3000'

describe('Gateway API', () => {
  let db: Database
  let app: Hono<AppEnv>
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono<AppEnv>()
    app.route('/', createGatewayRoutes(db, BASE_URL))
    token = seedBot(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('GET /gateway', () => {
    it('returns the gateway url without authentication', async () => {
      const res = await app.request('/gateway')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.url).toBe('ws://localhost:3000')
    })
  })

  describe('GET /gateway/bot', () => {
    it('returns bot gateway info with a valid token', async () => {
      const res = await app.request('/gateway/bot', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.url).toBe('ws://localhost:3000')
      expect(body.shards).toBe(1)
      expect(body.session_start_limit).toEqual({
        total: 1000,
        remaining: 1000,
        reset_after: 0,
        max_concurrency: 1,
      })
    })

    it('returns 401 without authentication', async () => {
      const res = await app.request('/gateway/bot')
      expect(res.status).toBe(401)
    })
  })
})
