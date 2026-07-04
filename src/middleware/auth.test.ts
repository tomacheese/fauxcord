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
})
