import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createOAuth2Routes } from './oauth2'
import { initializeDatabase, closeDatabase } from '../db'
import type { Database } from '../db'

describe('OAuth2 API', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createOAuth2Routes(db))
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('GET /oauth2/@me', () => {
    it('returns 401 without a Bearer token', async () => {
      const res = await app.request('/oauth2/@me')
      expect(res.status).toBe(401)
    })

    it('returns an empty scopes array (not [""]) for an empty-scope token', async () => {
      db.prepare(
        'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
      ).run('client-1', 'secret')
      db.prepare(
        "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'User', '0', 0)"
      ).run('333333333333333333')
      db.prepare(
        `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at)
         VALUES (?, ?, ?, '', datetime('now', '+1 hour'))`
      ).run('access-1', 'client-1', '333333333333333333')

      const res = await app.request('/oauth2/@me', {
        headers: { Authorization: 'Bearer access-1' },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { scopes: string[] }
      expect(body.scopes).toEqual([])
    })

    it('splits a space-delimited scope into an array', async () => {
      db.prepare(
        'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
      ).run('client-2', 'secret')
      db.prepare(
        "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'User', '0', 0)"
      ).run('444444444444444444')
      db.prepare(
        `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at)
         VALUES (?, ?, ?, 'identify email', datetime('now', '+1 hour'))`
      ).run('access-2', 'client-2', '444444444444444444')

      const res = await app.request('/oauth2/@me', {
        headers: { Authorization: 'Bearer access-2' },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { scopes: string[] }
      expect(body.scopes).toEqual(['identify', 'email'])
    })
  })

  describe('GET /oauth2/authorize', () => {
    it('returns 400 when required parameters are missing', async () => {
      const res = await app.request('/oauth2/authorize?client_id=x')
      expect(res.status).toBe(400)
    })
  })
})
