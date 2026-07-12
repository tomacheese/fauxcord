import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createOAuth2Routes } from './oauth2'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot } from '../test-helpers'
import {
  createAuthCode,
  createClientCredentialsToken,
} from '../services/oauth2'
import type { Database } from '../database'

describe('OAuth2 API', () => {
  let database: Database
  let app: Hono

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createOAuth2Routes(database))
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('POST /oauth2/token (client_credentials)', () => {
    it('issues a token', async () => {
      const resource = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=identify',
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.token_type).toBe('Bearer')
      expect(typeof body.access_token).toBe('string')
      expect(body.scope).toBe('identify')
    })

    it('defaults scope to identify when omitted', async () => {
      const resource = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.scope).toBe('identify')
    })
  })

  describe('POST /oauth2/token (authorization_code)', () => {
    it('exchanges a valid code for a token', async () => {
      // Seed the client + user rows via raw SQL, then create the auth code via
      // the service layer (createAuthCode).
      database
        .prepare(
          'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
        )
        .run('client1', 'secret1')
      database
        .prepare(
          "INSERT INTO users (id, username, discriminator, bot) VALUES ('900', 'U', '0', 0)"
        )
        .run()
      const code = createAuthCode(
        database,
        'client1',
        '900',
        'identify',
        'https://example.com/cb'
      )

      const resource = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent('https://example.com/cb')}`,
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(typeof body.access_token).toBe('string')
      expect(typeof body.refresh_token).toBe('string')
    })

    it('returns 400 when code or redirect_uri is missing', async () => {
      const resource = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=abc',
      })
      expect(resource.status).toBe(400)
    })

    it('returns 401 for an invalid code', async () => {
      const resource = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=authorization_code&code=nope&redirect_uri=${encodeURIComponent('https://example.com/cb')}`,
      })
      expect(resource.status).toBe(401)
    })
  })

  describe('POST /oauth2/token (errors)', () => {
    it('returns 400 for a non form-urlencoded content-type', async () => {
      const resource = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
      })
      expect(resource.status).toBe(400)
    })

    it('returns 400 for an unknown grant_type', async () => {
      const resource = await app.request('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=password',
      })
      expect(resource.status).toBe(400)
    })
  })

  describe('GET /oauth2/@me', () => {
    it('returns token info for a valid Bearer token', async () => {
      // A client_credentials token has no user; @me requires a user, so build
      // an authorization_code token bound to a real user instead.
      const token = seedBot(database, 'Bot t1', '111111111111111111')
      database
        .prepare(
          'INSERT INTO oauth2_clients (client_id, client_secret, bot_token) VALUES (?, ?, ?)'
        )
        .run('client1', 'secret1', token)
      const code = createAuthCode(
        database,
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

      const resource = await app.request('/oauth2/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.scopes).toEqual(['identify'])
    })

    it('returns 401 without a Bearer header', async () => {
      const resource = await app.request('/oauth2/@me')
      expect(resource.status).toBe(401)
    })

    it('returns 401 for an unknown token', async () => {
      const resource = await app.request('/oauth2/@me', {
        headers: { Authorization: 'Bearer nonexistent' },
      })
      expect(resource.status).toBe(401)
    })

    it('returns an empty scopes array (not [""]) for an empty-scope token', async () => {
      database
        .prepare(
          'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
        )
        .run('client-1', 'secret')
      database
        .prepare(
          "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'User', '0', 0)"
        )
        .run('333333333333333333')
      database
        .prepare(
          `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at)
         VALUES (?, ?, ?, '', datetime('now', '+1 hour'))`
        )
        .run('access-1', 'client-1', '333333333333333333')

      const resource = await app.request('/oauth2/@me', {
        headers: { Authorization: 'Bearer access-1' },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { scopes: string[] }
      expect(body.scopes).toEqual([])
    })

    it('splits a space-delimited scope into an array', async () => {
      database
        .prepare(
          'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
        )
        .run('client-2', 'secret')
      database
        .prepare(
          "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'User', '0', 0)"
        )
        .run('444444444444444444')
      database
        .prepare(
          `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at)
         VALUES (?, ?, ?, 'identify email', datetime('now', '+1 hour'))`
        )
        .run('access-2', 'client-2', '444444444444444444')

      const resource = await app.request('/oauth2/@me', {
        headers: { Authorization: 'Bearer access-2' },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { scopes: string[] }
      expect(body.scopes).toEqual(['identify', 'email'])
    })
  })

  describe('GET /oauth2/authorize', () => {
    it('redirects with a code and preserves state', async () => {
      const resource = await app.request(
        `/oauth2/authorize?client_id=c1&redirect_uri=${encodeURIComponent('https://example.com/cb')}&response_type=code&state=xyz`,
        { redirect: 'manual' }
      )
      expect(resource.status).toBe(302)
      const location = resource.headers.get('location') ?? ''
      const url = new URL(location)
      expect(url.searchParams.get('code')).toBeTruthy()
      expect(url.searchParams.get('state')).toBe('xyz')
    })

    it('returns 400 when required params are missing', async () => {
      const resource = await app.request(
        '/oauth2/authorize?client_id=c1&response_type=token'
      )
      expect(resource.status).toBe(400)
    })
  })

  describe('POST /oauth2/token/revoke', () => {
    it('revokes a token and returns an empty object', async () => {
      // createClientCredentialsToken inserts into oauth2_access_tokens which has
      // an FK to oauth2_clients (foreign_keys is ON), so seed the client first.
      database
        .prepare(
          'INSERT INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
        )
        .run('client1', 'secret1')
      const tokenResp = createClientCredentialsToken(
        database,
        'client1',
        'identify'
      )
      const resource = await app.request('/oauth2/token/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${tokenResp.access_token}`,
      })
      expect(resource.status).toBe(200)
      expect(await resource.json()).toEqual({})

      const row = database
        .prepare('SELECT token FROM oauth2_access_tokens WHERE token = ?')
        .get(tokenResp.access_token)
      expect(row).toBeUndefined()
    })

    it('returns 400 when token is missing', async () => {
      const resource = await app.request('/oauth2/token/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      })
      expect(resource.status).toBe(400)
    })
  })
})

describe('OAuth2 API route prefixes', () => {
  let database: Database
  let app: Hono

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()

    // Mirrors src/index.ts's production mounting: OAuth2 routes must be
    // reachable under every documented version prefix (/api/v10, /api, and
    // the bare path), the same as every other route group.
    const prefixes = ['/api/v10', '/api', '']
    for (const prefix of prefixes) {
      app.route(prefix, createOAuth2Routes(database))
    }
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('POST /oauth2/token (client_credentials)', () => {
    for (const prefix of ['/api/v10', '/api', '']) {
      it(`is reachable under the ${prefix || '(bare)'} prefix`, async () => {
        const resource = await app.request(`${prefix}/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            scope: 'identify',
          }),
        })
        expect(resource.status).toBe(200)
        const body = (await resource.json()) as { access_token: string }
        expect(body.access_token).toBeTruthy()
      })
    }
  })
})
