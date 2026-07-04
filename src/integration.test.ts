/**
 * Integration tests
 *
 * End-to-end tests for the entire server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase, closeDatabase } from './db'
import { corsMiddleware } from './middleware/cors'
import { versionMiddleware } from './middleware/version'
import { createAuthMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { createChannelRoutes } from './routes/channels'
import { createGuildRoutes } from './routes/guilds'
import { createUserRoutes } from './routes/users'
import { createWebhookRoutes } from './routes/webhooks'
import { createTestRoutes } from './routes/test'
import { createMockRoutes } from './routes/mock'
import { createOAuth2Routes } from './routes/oauth2'
import type { Database } from './db'

const BASE_URL = 'http://localhost:3000'
const TEST_TOKEN = 'Bot integrationtest'
const GUILD_ID = '100000000000000001'
const CHANNEL_ID = '100000000000000002'
const USER_ID = '100000000000000003'

/** Assembles the test server */
function buildTestServer(db: Database): Hono {
  const app = new Hono()

  app.use('*', corsMiddleware)
  app.use('*', versionMiddleware)

  // Auth-exempt endpoints
  app.route('/', createMockRoutes(db, '/tmp/uploads-test'))
  app.route('/', createTestRoutes(db))

  // Webhook execution does not require auth — register before the auth middleware
  app.route('/', createWebhookRoutes(db, BASE_URL))

  // Auth-required endpoints
  app.use('*', createAuthMiddleware(db, false))
  app.use('*', rateLimitMiddleware)

  const prefixes = ['/api/v10', '/api', '']
  for (const prefix of prefixes) {
    app.route(prefix, createChannelRoutes(db, BASE_URL))
    app.route(prefix, createGuildRoutes(db))
    app.route(prefix, createUserRoutes(db))
    app.route(prefix, createOAuth2Routes(db))
  }

  app.onError((err, c) => {
    console.error(err)
    return c.json({ message: '500: Internal Server Error', code: 0 }, 500)
  })

  app.notFound((c) => {
    return c.json({ message: '404: Not Found', code: 0 }, 404)
  })

  return app
}

describe('Integration tests', () => {
  let db: Database
  let app: Hono

  beforeAll(async () => {
    db = initializeDatabase(':memory:')
    app = buildTestServer(db)

    // Set up test environment
    await app.request('/_test/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: TEST_TOKEN,
        user: { id: USER_ID, username: 'IntegrationBot' },
        guilds: [
          {
            id: GUILD_ID,
            name: 'Integration Test Guild',
            channels: [{ id: CHANNEL_ID, name: 'general', type: 0 }],
          },
        ],
      }),
    })
  })

  afterAll(() => {
    closeDatabase(db)
  })

  describe('Health check', () => {
    it('GET /_mock/health returns 200', async () => {
      const res = await app.request('/_mock/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe('ok')
      expect(body.db).toBe('ok')
      expect(typeof body.uptime).toBe('number')
    })
  })

  describe('Version routing', () => {
    it('works with /api/v10/ prefix', async () => {
      const res = await app.request(`/api/v10/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
    })

    it('works with /api/ prefix', async () => {
      const res = await app.request(`/api/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
    })

    it('works with / prefix', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
    })

    it('/api/v9/ returns 400', async () => {
      const res = await app.request(`/api/v9/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_041)
    })

    // OAuth2 routes were previously only mounted at the bare `/` prefix in
    // src/index.ts (unlike every other route group), so `/api/v10/oauth2/*`
    // and `/api/oauth2/*` returned 404 for real clients that always call
    // through the versioned base URL. Discovered via a real discordjs/
    // oceanic.js compatibility run (compat/) that hit `/api/v10/oauth2/*`
    // directly.
    it('OAuth2 routes work with the /api/v10/ prefix', async () => {
      // Real REST clients (e.g. discord.js/Oceanic.js) send a single global
      // Authorization header on every request, including OAuth2 calls, so
      // this reproduces what a real client sends rather than isolating the
      // route-mounting bug from auth behavior.
      const res = await app.request('/api/v10/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.access_token).toBeTruthy()
    })

    it('OAuth2 routes work with the /api/ prefix', async () => {
      const res = await app.request('/api/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      })
      expect(res.status).toBe(200)
    })
  })

  describe('Authentication', () => {
    it('authenticates with a valid token', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
    })

    it('returns 401 for an invalid token', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: 'Bot invalidtoken' },
      })
      expect(res.status).toBe(401)
    })

    it('returns 401 when the Authorization header is absent', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`)
      expect(res.status).toBe(401)
    })
  })

  describe('Rate Limit headers', () => {
    it('response includes Rate Limit headers', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
      expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy()
      expect(res.headers.get('X-RateLimit-Bucket')).toBeTruthy()
      expect(res.headers.get('X-RateLimit-Scope')).toBe('user')
    })
  })

  describe('Message lifecycle', () => {
    it('supports create → get → update → delete', async () => {
      // Create
      const createRes = await app.request(`/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Integration test message' }),
      })
      expect(createRes.status).toBe(200)
      const created = (await createRes.json()) as Record<string, unknown>
      expect(created.content).toBe('Integration test message')
      const messageId = created.id as string

      // Get
      const getRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(getRes.status).toBe(200)
      const got = (await getRes.json()) as Record<string, unknown>
      expect(got.id).toBe(messageId)

      // Update
      const patchRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Updated content' }),
        }
      )
      expect(patchRes.status).toBe(200)
      const patched = (await patchRes.json()) as Record<string, unknown>
      expect(patched.content).toBe('Updated content')
      expect(patched.edited_timestamp).not.toBeNull()

      // Delete
      const deleteRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(deleteRes.status).toBe(204)

      // Returns 404 after deletion
      const get404 = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(get404.status).toBe(404)
    })
  })

  describe('Pins', () => {
    it('pins and unpins a message', async () => {
      // Create a message
      const createRes = await app.request(`/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Pin test' }),
      })
      const { id: messageId } = await createRes.json()

      // Pin
      const pinRes = await app.request(
        `/channels/${CHANNEL_ID}/pins/${messageId}`,
        {
          method: 'PUT',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(pinRes.status).toBe(204)

      // Pinned list
      const pinsRes = await app.request(`/channels/${CHANNEL_ID}/pins`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(pinsRes.status).toBe(200)
      const pins = (await pinsRes.json()) as { id: string }[]
      expect(pins.some((m) => m.id === messageId)).toBe(true)

      // Unpin
      const unpinRes = await app.request(
        `/channels/${CHANNEL_ID}/pins/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(unpinRes.status).toBe(204)
    })
  })

  describe('Guilds API', () => {
    it('retrieves Guild information', async () => {
      const res = await app.request(`/guilds/${GUILD_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(GUILD_ID)
      expect(body.name).toBe('Integration Test Guild')
    })

    it('retrieves the Guild channel list', async () => {
      const res = await app.request(`/guilds/${GUILD_ID}/channels`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string }[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.some((c) => c.id === CHANNEL_ID)).toBe(true)
    })

    it('creates a channel', async () => {
      const res = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new-channel', type: 0 }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.name).toBe('new-channel')
    })
  })

  describe('Users API', () => {
    it('GET /users/@me returns Bot information', async () => {
      const res = await app.request('/users/@me', {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(USER_ID)
      expect(body.bot).toBe(true)
    })

    it('GET /users/@me/guilds returns the Guild list', async () => {
      const res = await app.request('/users/@me/guilds', {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
    })
  })

  describe('Webhooks API', () => {
    it('creates and executes a Webhook', async () => {
      // Create Webhook
      const createRes = await app.request(`/channels/${CHANNEL_ID}/webhooks`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'TestWebhook' }),
      })
      expect(createRes.status).toBe(200)
      const webhook = (await createRes.json()) as Record<string, string>
      expect(webhook.name).toBe('TestWebhook')

      // Execute Webhook (wait=true)
      const execRes = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Webhook message' }),
        }
      )
      expect(execRes.status).toBe(200)
      const msg = (await execRes.json()) as Record<string, unknown>
      expect(msg.content).toBe('Webhook message')
    })
  })

  describe('Test control API', () => {
    it('POST /_test/reset (full) clears messages', async () => {
      // Use a separate channel to keep the test isolated
      // Create a new channel
      const chRes = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'reset-test-channel', type: 0 }),
      })
      const { id: resetChannelId } = await chRes.json()

      // Send a message
      await app.request(`/channels/${resetChannelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Before reset' }),
      })

      // Full reset
      const resetRes = await app.request('/_test/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(resetRes.status).toBe(204)

      // Messages should be gone
      const msgsRes = await app.request(`/_test/messages/${resetChannelId}`)
      const body = (await msgsRes.json()) as { messages: unknown[] }
      expect(body.messages.length).toBe(0)
    })
  })
})
