import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createGatewayRoutes } from './gateway'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot } from '../test-helpers'
import type { Database } from '../database'
import type { AppEnvironment } from '../middleware/auth'

const BASE_URL = 'http://localhost:3000'

describe('Gateway API', () => {
  let database: Database
  let app: Hono<AppEnvironment>
  let token: string

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono<AppEnvironment>()
    app.route('/', createGatewayRoutes(database, BASE_URL))
    token = seedBot(database)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('GET /gateway', () => {
    it('returns the gateway url without authentication', async () => {
      const resource = await app.request('/gateway')
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.url).toBe('ws://localhost:3000')
    })
  })

  describe('GET /gateway/bot', () => {
    it('returns bot gateway info with a valid token', async () => {
      const resource = await app.request('/gateway/bot', {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
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
      const resource = await app.request('/gateway/bot')
      expect(resource.status).toBe(401)
    })
  })
})
