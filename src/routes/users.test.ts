import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createFullTestApp, seedBot } from '../test-helpers'
import type { Database } from '../database'

describe('PATCH /users/@me', () => {
  let database: Database
  let app: ReturnType<typeof createFullTestApp>['app']
  let cleanup: () => void
  const token = 'Bot testtoken'
  const userId = '111111111111111111'

  beforeEach(() => {
    const context = createFullTestApp()
    database = context.db
    app = context.app
    cleanup = context.cleanup
    seedBot(database, token, userId)
  })

  afterEach(() => {
    cleanup()
  })

  it('updates the username and reflects it on GET /users/@me', async () => {
    const resource = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'RenamedBot' }),
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.username).toBe('RenamedBot')

    const fetchedResponse = await app.request('/api/v10/users/@me', {
      headers: { Authorization: token },
    })
    const responseBody = (await fetchedResponse.json()) as Record<
      string,
      unknown
    >
    expect(responseBody.username).toBe('RenamedBot')
  })

  it('clears the avatar with null', async () => {
    database
      .prepare('UPDATE users SET avatar = ? WHERE id = ?')
      .run('oldhash', userId)
    const resource = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ avatar: null }),
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.avatar).toBeNull()
  })

  it('returns 401 for an unregistered token', async () => {
    const resource = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bot unregistered',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'Whatever' }),
    })
    expect(resource.status).toBe(401)
  })

  it('returns 400 for an out-of-range username', async () => {
    const resource = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'x' }),
    })
    expect(resource.status).toBe(400)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.code).toBe(50_035)
    expect(body.message).toBe('Invalid Form Body')
  })

  it('treats a literal null body as a no-op update (no crash)', async () => {
    const resource = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: 'null',
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.id).toBe(userId)
  })

  it('GET /users/:userId returns the user, and 404 for an unknown user', async () => {
    const known = await app.request(`/api/v10/users/${userId}`, {
      headers: { Authorization: token },
    })
    expect(known.status).toBe(200)
    const knownBody = (await known.json()) as Record<string, unknown>
    expect(knownBody.id).toBe(userId)

    const missing = await app.request('/api/v10/users/999999999999999999', {
      headers: { Authorization: token },
    })
    expect(missing.status).toBe(404)
    const missingBody = (await missing.json()) as Record<string, unknown>
    expect(missingBody.code).toBe(10_013)
  })

  it('GET /users/%40me resolves the percent-encoded @me to the bot user', async () => {
    const resource = await app.request('/api/v10/users/%40me', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.id).toBe(userId)
  })

  it('GET /applications/@me and /oauth2/applications/@me return the application', async () => {
    for (const path of [
      '/api/v10/applications/@me',
      '/api/v10/oauth2/applications/@me',
    ]) {
      const resource = await app.request(path, {
        headers: { Authorization: token },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.id).toBeDefined()
    }
  })
})

describe('Users GET endpoints', () => {
  let database: ReturnType<typeof createFullTestApp>['db']
  let app: ReturnType<typeof createFullTestApp>['app']
  let cleanup: () => void
  const token = 'Bot testtoken'
  const userId = '111111111111111111'

  beforeEach(() => {
    const context = createFullTestApp()
    database = context.db
    app = context.app
    cleanup = context.cleanup
    seedBot(database, token, userId)
  })

  afterEach(() => {
    cleanup()
  })

  it('GET /users/@me returns the bot user', async () => {
    const resource = await app.request('/api/v10/users/@me', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as { id: string }
    expect(body.id).toBe(userId)
  })

  it('GET /users/@me returns 401 for an unregistered token', async () => {
    const resource = await app.request('/api/v10/users/@me', {
      headers: { Authorization: 'Bot unregistered' },
    })
    expect(resource.status).toBe(401)
  })

  it("GET /users/@me includes `verified: true` (required by strict client models such as interactions.py's ClientUser, built from this REST response rather than the Gateway READY payload)", async () => {
    const resource = await app.request('/api/v10/users/@me', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as { verified?: boolean }
    expect(body.verified).toBe(true)
  })

  it('GET /users/:id returns a known user', async () => {
    const resource = await app.request(`/api/v10/users/${userId}`, {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as { id: string; verified?: boolean }
    expect(body.id).toBe(userId)
    // `verified` is only ever returned for the current user's own
    // /users/@me, never for arbitrary user lookups (matches real Discord).
    expect(body.verified).toBeUndefined()
  })

  it('GET /users/:id returns 404 (10013) for an unknown user', async () => {
    const resource = await app.request('/api/v10/users/999999999999999999', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(404)
    const body = (await resource.json()) as { code: number }
    expect(body.code).toBe(10_013)
  })

  it('GET /users/@me/guilds returns an array', async () => {
    const resource = await app.request('/api/v10/users/@me/guilds', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
    expect(Array.isArray(await resource.json())).toBe(true)
  })

  it('GET /applications/@me returns application info', async () => {
    const resource = await app.request('/api/v10/applications/@me', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
  })

  it("GET /applications/@me includes `summary` (required by strict client models such as interactions.py's Application)", async () => {
    const resource = await app.request('/api/v10/applications/@me', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as { summary?: string }
    expect(body.summary).toBe('')
  })

  it('GET /oauth2/applications/@me returns application info (Discord.Net alias)', async () => {
    const resource = await app.request('/api/v10/oauth2/applications/@me', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
  })
})

describe('GET /oauth2/applications/@me', () => {
  let app: ReturnType<typeof createFullTestApp>['app']
  let cleanup: () => void
  const token = 'Bot testtoken'
  const userId = '111111111111111111'

  beforeEach(() => {
    const context = createFullTestApp()
    app = context.app
    cleanup = context.cleanup
    seedBot(context.db, token, userId)
  })

  afterEach(() => {
    cleanup()
  })

  it('includes a verify_key field (required by ApplicationResponse, relied on by nextcord)', async () => {
    const resource = await app.request('/api/v10/oauth2/applications/@me', {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as Record<string, unknown>
    expect(typeof body.verify_key).toBe('string')
    expect((body.verify_key as string).length).toBeGreaterThan(0)
  })
})
