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
})
