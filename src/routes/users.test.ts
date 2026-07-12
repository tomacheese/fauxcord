import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createFullTestApp, seedBot } from '../test-helpers'
import type { Database } from '../db'

describe('PATCH /users/@me', () => {
  let db: Database
  let app: ReturnType<typeof createFullTestApp>['app']
  let cleanup: () => void
  const token = 'Bot testtoken'
  const userId = '111111111111111111'

  beforeEach(() => {
    const ctx = createFullTestApp()
    db = ctx.db
    app = ctx.app
    cleanup = ctx.cleanup
    seedBot(db, token, userId)
  })

  afterEach(() => {
    cleanup()
  })

  it('updates the username and reflects it on GET /users/@me', async () => {
    const res = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'RenamedBot' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.username).toBe('RenamedBot')

    const getRes = await app.request('/api/v10/users/@me', {
      headers: { Authorization: token },
    })
    const getBody = (await getRes.json()) as Record<string, unknown>
    expect(getBody.username).toBe('RenamedBot')
  })

  it('clears the avatar with null', async () => {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(
      'oldhash',
      userId
    )
    const res = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ avatar: null }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.avatar).toBeNull()
  })

  it('returns 401 for an unregistered token', async () => {
    const res = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bot unregistered',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'Whatever' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for an out-of-range username', async () => {
    const res = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'x' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe(50_035)
    expect(body.message).toBe('Invalid Form Body')
  })

  it('treats a literal null body as a no-op update (no crash)', async () => {
    const res = await app.request('/api/v10/users/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: 'null',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
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
    const res = await app.request('/api/v10/users/%40me', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(userId)
  })

  it('GET /applications/@me and /oauth2/applications/@me return the application', async () => {
    for (const path of [
      '/api/v10/applications/@me',
      '/api/v10/oauth2/applications/@me',
    ]) {
      const res = await app.request(path, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBeDefined()
    }
  })
})

describe('Users GET endpoints', () => {
  let db: ReturnType<typeof createFullTestApp>['db']
  let app: ReturnType<typeof createFullTestApp>['app']
  let cleanup: () => void
  const token = 'Bot testtoken'
  const userId = '111111111111111111'

  beforeEach(() => {
    const ctx = createFullTestApp()
    db = ctx.db
    app = ctx.app
    cleanup = ctx.cleanup
    seedBot(db, token, userId)
  })

  afterEach(() => {
    cleanup()
  })

  it('GET /users/@me returns the bot user', async () => {
    const res = await app.request('/api/v10/users/@me', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe(userId)
  })

  it('reflects a non-bot users.bot value on GET /users/@me (regression for #120)', async () => {
    // getBotUser() previously hardcoded `bot: true` regardless of the
    // underlying users.bot column. Every user-creation path in this
    // codebase enforces bot=1 for a bots-table-linked user, so force the
    // column to 0 directly here to lock in the correct derivation.
    db.prepare('UPDATE users SET bot = 0 WHERE id = ?').run(userId)

    const res = await app.request('/api/v10/users/@me', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { bot: boolean }
    expect(body.bot).toBe(false)
  })

  it('GET /users/@me returns 401 for an unregistered token', async () => {
    const res = await app.request('/api/v10/users/@me', {
      headers: { Authorization: 'Bot unregistered' },
    })
    expect(res.status).toBe(401)
  })

  it("GET /users/@me includes `verified: true` (required by strict client models such as interactions.py's ClientUser, built from this REST response rather than the Gateway READY payload)", async () => {
    const res = await app.request('/api/v10/users/@me', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { verified?: boolean }
    expect(body.verified).toBe(true)
  })

  it('GET /users/:id returns a known user', async () => {
    const res = await app.request(`/api/v10/users/${userId}`, {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; verified?: boolean }
    expect(body.id).toBe(userId)
    // `verified` is only ever returned for the current user's own
    // /users/@me, never for arbitrary user lookups (matches real Discord).
    expect(body.verified).toBeUndefined()
  })

  it('GET /users/:id returns 404 (10013) for an unknown user', async () => {
    const res = await app.request('/api/v10/users/999999999999999999', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { code: number }
    expect(body.code).toBe(10_013)
  })

  it('GET /users/@me/guilds returns an array', async () => {
    const res = await app.request('/api/v10/users/@me/guilds', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('GET /applications/@me returns application info', async () => {
    const res = await app.request('/api/v10/applications/@me', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
  })

  it("GET /applications/@me includes `summary` (required by strict client models such as interactions.py's Application)", async () => {
    const res = await app.request('/api/v10/applications/@me', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { summary?: string }
    expect(body.summary).toBe('')
  })

  it('GET /oauth2/applications/@me returns application info (Discord.Net alias)', async () => {
    const res = await app.request('/api/v10/oauth2/applications/@me', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
  })
})

describe('GET /oauth2/applications/@me', () => {
  let app: ReturnType<typeof createFullTestApp>['app']
  let cleanup: () => void
  const token = 'Bot testtoken'
  const userId = '111111111111111111'

  beforeEach(() => {
    const ctx = createFullTestApp()
    app = ctx.app
    cleanup = ctx.cleanup
    seedBot(ctx.db, token, userId)
  })

  afterEach(() => {
    cleanup()
  })

  it('includes a verify_key field (required by ApplicationResponse, relied on by nextcord)', async () => {
    const res = await app.request('/api/v10/oauth2/applications/@me', {
      headers: { Authorization: token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.verify_key).toBe('string')
    expect((body.verify_key as string).length).toBeGreaterThan(0)
  })
})
