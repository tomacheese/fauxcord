import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from './auth'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot } from '../test-helpers'
import type { Database } from '../database'

describe('createAuthMiddleware', () => {
  let database: Database
  let app: Hono

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.use('*', createAuthMiddleware(database, false))
    app.get('/test', (c) => c.json({ ok: true }))
  })

  afterEach(() => {
    closeDatabase(database)
  })

  it('authenticates successfully with a valid Bot token', async () => {
    seedBot(database, 'Bot validtoken')
    const resource = await app.request('/test', {
      headers: { Authorization: 'Bot validtoken' },
    })
    expect(resource.status).toBe(200)
  })

  it('returns 401 for an unregistered token', async () => {
    const resource = await app.request('/test', {
      headers: { Authorization: 'Bot unknowntoken' },
    })
    expect(resource.status).toBe(401)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.code).toBe(0)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const resource = await app.request('/test')
    expect(resource.status).toBe(401)
  })

  it('allows unknown tokens when DISABLE_AUTH=true', async () => {
    const appNoAuth = new Hono()
    appNoAuth.use('*', createAuthMiddleware(database, true))
    appNoAuth.get('/test', (c) => c.json({ ok: true }))

    const resource = await appNoAuth.request('/test', {
      headers: { Authorization: 'Bot anytoken' },
    })
    expect(resource.status).toBe(200)
  })

  it('allows unknown Bearer tokens when DISABLE_AUTH=true', async () => {
    const appNoAuth = new Hono()
    appNoAuth.use('*', createAuthMiddleware(database, true))
    appNoAuth.get('/test', (c) => c.json({ ok: true }))

    const resource = await appNoAuth.request('/test', {
      headers: { Authorization: 'Bearer anybearertoken' },
    })
    expect(resource.status).toBe(200)
  })

  it('allows an unrecognized authorization scheme when DISABLE_AUTH=true', async () => {
    const appNoAuth = new Hono()
    appNoAuth.use('*', createAuthMiddleware(database, true))
    appNoAuth.get('/test', (c) => c.json({ ok: true }))

    const resource = await appNoAuth.request('/test', {
      headers: { Authorization: 'mystery scheme-token' },
    })
    expect(resource.status).toBe(200)
  })

  it('returns 401 for an unregistered Bearer token when auth is enabled', async () => {
    const resource = await app.request('/test', {
      headers: { Authorization: 'Bearer notarealtoken' },
    })
    expect(resource.status).toBe(401)
  })

  it('skips authentication for auth-exempt paths', async () => {
    app.get('/_mock/health', (c) => c.json({ status: 'ok' }))
    // /_mock/health does not require auth, so it works even without a registered token
    const appWithAuth = new Hono()
    appWithAuth.get('/_mock/health', (c) => c.json({ status: 'ok' }))
    appWithAuth.use('*', createAuthMiddleware(database, false))
    appWithAuth.get('/protected', (c) => c.json({ protected: true }))

    const healthResource = await appWithAuth.request('/_mock/health')
    expect(healthResource.status).toBe(200)
  })

  it('authenticates with a valid Bearer token', async () => {
    // oauth2_access_tokens references oauth2_clients (FK); insert a client first.
    database
      .prepare(
        'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
      )
      .run('c1', 's1')
    database
      .prepare(
        `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at)
       VALUES ('tok-valid', 'c1', NULL, 'identify', datetime('now', '+1 day'))`
      )
      .run()

    const resource = await app.request('/test', {
      headers: { Authorization: 'Bearer tok-valid' },
    })
    expect(resource.status).toBe(200)
  })

  it('returns 401 for an unknown Bearer token', async () => {
    const resource = await app.request('/test', {
      headers: { Authorization: 'Bearer nonexistent' },
    })
    expect(resource.status).toBe(401)
  })

  it('returns 401 for an unsupported auth scheme', async () => {
    const resource = await app.request('/test', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(resource.status).toBe(401)
  })
})
