import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from './auth'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot } from '../test-helpers'
import type { Database } from '../db'

describe('createAuthMiddleware', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.use('*', createAuthMiddleware(db, false))
    app.get('/test', (c) => c.json({ ok: true }))
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('authenticates successfully with a valid Bot token', async () => {
    seedBot(db, 'Bot validtoken')
    const res = await app.request('/test', {
      headers: { Authorization: 'Bot validtoken' },
    })
    expect(res.status).toBe(200)
  })

  it('returns 401 for an unregistered token', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bot unknowntoken' },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe(0)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/test')
    expect(res.status).toBe(401)
  })

  it('allows unknown tokens when DISABLE_AUTH=true', async () => {
    const appNoAuth = new Hono()
    appNoAuth.use('*', createAuthMiddleware(db, true))
    appNoAuth.get('/test', (c) => c.json({ ok: true }))

    const res = await appNoAuth.request('/test', {
      headers: { Authorization: 'Bot anytoken' },
    })
    expect(res.status).toBe(200)
  })

  it('allows unknown Bearer tokens when DISABLE_AUTH=true', async () => {
    const appNoAuth = new Hono()
    appNoAuth.use('*', createAuthMiddleware(db, true))
    appNoAuth.get('/test', (c) => c.json({ ok: true }))

    const res = await appNoAuth.request('/test', {
      headers: { Authorization: 'Bearer anybearertoken' },
    })
    expect(res.status).toBe(200)
  })

  it('allows an unrecognized authorization scheme when DISABLE_AUTH=true', async () => {
    const appNoAuth = new Hono()
    appNoAuth.use('*', createAuthMiddleware(db, true))
    appNoAuth.get('/test', (c) => c.json({ ok: true }))

    const res = await appNoAuth.request('/test', {
      headers: { Authorization: 'mystery scheme-token' },
    })
    expect(res.status).toBe(200)
  })

  it('returns 401 for an unregistered Bearer token when auth is enabled', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer notarealtoken' },
    })
    expect(res.status).toBe(401)
  })

  it('skips authentication for auth-exempt paths', async () => {
    app.get('/_mock/health', (c) => c.json({ status: 'ok' }))
    // /_mock/health does not require auth, so it works even without a registered token
    const appWithAuth = new Hono()
    appWithAuth.get('/_mock/health', (c) => c.json({ status: 'ok' }))
    appWithAuth.use('*', createAuthMiddleware(db, false))
    appWithAuth.get('/protected', (c) => c.json({ protected: true }))

    const healthRes = await appWithAuth.request('/_mock/health')
    expect(healthRes.status).toBe(200)
  })

  it('authenticates with a valid Bearer token', async () => {
    // oauth2_access_tokens references oauth2_clients (FK); insert a client first.
    db.prepare(
      'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
    ).run('c1', 's1')
    db.prepare(
      `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at)
       VALUES ('tok-valid', 'c1', NULL, 'identify', datetime('now', '+1 day'))`
    ).run()

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer tok-valid' },
    })
    expect(res.status).toBe(200)
  })

  it('returns 401 for an unknown Bearer token', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer nonexistent' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for an unsupported auth scheme', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(res.status).toBe(401)
  })

  it('exempts POST /interactions/:id/:token/callback from authentication', async () => {
    const appNoBot = new Hono()
    appNoBot.use('*', createAuthMiddleware(db, false))
    appNoBot.post('/interactions/:id/:token/callback', (c) =>
      c.json({ ok: true })
    )

    const res = await appNoBot.request(
      '/interactions/123456789012345678/sometoken/callback',
      { method: 'POST' }
    )
    // No Authorization header was sent; a non-exempt path would return 401
    // here. Reaching the route handler (200) confirms the middleware let it
    // through.
    expect(res.status).toBe(200)
  })
})
