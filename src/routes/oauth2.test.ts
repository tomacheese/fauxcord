import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createOAuth2Routes } from './oauth2'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot } from '../test-helpers'
import { createAuthCode, createClientCredentialsToken } from '../services/oauth2'
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

  describe('POST /oauth2/token (client_credentials)', () => {
    it('issues a token', async () => {
      const res = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=identify',
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.token_type).toBe('Bearer')
      expect(typeof body.access_token).toBe('string')
      expect(body.scope).toBe('identify')
    })

    it('defaults scope to identify when omitted', async () => {
      const res = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.scope).toBe('identify')
    })
  })

  describe('POST /oauth2/token (authorization_code)', () => {
    it('exchanges a valid code for a token', async () => {
      // Seed a client + auth code directly via the service layer
      db.prepare(
        'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
      ).run('client1', 'secret1')
      db.prepare(
        "INSERT INTO users (id, username, discriminator, bot) VALUES ('900', 'U', '0', 0)"
      ).run()
      const code = createAuthCode(
        db,
        'client1',
        '900',
        'identify',
        'https://example.com/cb'
      )

      const res = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent('https://example.com/cb')}`,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(typeof body.access_token).toBe('string')
      expect(typeof body.refresh_token).toBe('string')
    })

    it('returns 400 when code or redirect_uri is missing', async () => {
      const res = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=abc',
      })
      expect(res.status).toBe(400)
    })

    it('returns 401 for an invalid code', async () => {
      const res = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=authorization_code&code=nope&redirect_uri=${encodeURIComponent('https://example.com/cb')}`,
      })
      expect(res.status).toBe(401)
    })
  })

  describe('POST /oauth2/token (errors)', () => {
    it('returns 400 for a non form-urlencoded content-type', async () => {
      const res = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 for an unknown grant_type', async () => {
      const res = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=password',
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /oauth2/@me', () => {
    it('returns token info for a valid Bearer token', async () => {
      // A client_credentials token has no user; @me requires a user, so build
      // an authorization_code token bound to a real user instead.
      const token = seedBot(db, 'Bot t1', '111111111111111111')
      db.prepare(
        'INSERT INTO oauth2_clients (client_id, client_secret, bot_token) VALUES (?, ?, ?)'
      ).run('client1', 'secret1', token)
      const code = createAuthCode(
        db,
        'client1',
        '111111111111111111',
        'identify',
        'https://example.com/cb'
      )
      const exchange = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent('https://example.com/cb')}`,
      })
      const { access_token: accessToken } = (await exchange.json()) as {
        access_token: string
      }

      const res = await app.request('/oauth2/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.scopes).toEqual(['identify'])
    })

    it('returns 401 without a Bearer header', async () => {
      const res = await app.request('/oauth2/@me')
      expect(res.status).toBe(401)
    })

    it('returns 401 for an unknown token', async () => {
      const res = await app.request('/oauth2/@me', {
        headers: { Authorization: 'Bearer nonexistent' },
      })
      expect(res.status).toBe(401)
    })
  })

  describe('GET /oauth2/authorize', () => {
    it('redirects with a code and preserves state', async () => {
      const res = await app.request(
        `/oauth2/authorize?client_id=c1&redirect_uri=${encodeURIComponent('https://example.com/cb')}&response_type=code&state=xyz`,
        { redirect: 'manual' }
      )
      expect(res.status).toBe(302)
      const location = res.headers.get('location') ?? ''
      const url = new URL(location)
      expect(url.searchParams.get('code')).toBeTruthy()
      expect(url.searchParams.get('state')).toBe('xyz')
    })

    it('returns 400 when required params are missing', async () => {
      const res = await app.request(
        '/oauth2/authorize?client_id=c1&response_type=token'
      )
      expect(res.status).toBe(400)
    })
  })

  describe('POST /oauth2/token/revoke', () => {
    it('revokes a token and returns an empty object', async () => {
      // createClientCredentialsToken inserts into oauth2_access_tokens which has
      // an FK to oauth2_clients (foreign_keys is ON), so seed the client first.
      db.prepare(
        'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
      ).run('client1', 'secret1')
      const tokenResp = createClientCredentialsToken(db, 'client1', 'identify')
      const res = await app.request('/oauth2/token/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${tokenResp.access_token}`,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({})

      const row = db
        .prepare('SELECT token FROM oauth2_access_tokens WHERE token = ?')
        .get(tokenResp.access_token)
      expect(row).toBeUndefined()
    })

    it('returns 400 when token is missing', async () => {
      const res = await app.request('/oauth2/token/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      })
      expect(res.status).toBe(400)
    })
  })
})
