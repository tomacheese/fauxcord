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

    // Mirrors src/index.ts's production mounting: OAuth2 routes must be
    // reachable under every documented version prefix (/api/v10, /api, and
    // the bare path), the same as every other route group.
    const prefixes = ['/api/v10', '/api', '']
    for (const prefix of prefixes) {
      app.route(prefix, createOAuth2Routes(db))
    }
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('POST /oauth2/token (client_credentials)', () => {
    for (const prefix of ['/api/v10', '/api', '']) {
      it(`is reachable under the ${prefix || '(bare)'} prefix`, async () => {
        const res = await app.request(`${prefix}/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            scope: 'identify',
          }),
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { access_token: string }
        expect(body.access_token).toBeTruthy()
      })
    }
  })

  describe('POST /oauth2/token/revoke', () => {
    it('is reachable under the /api/v10 prefix', async () => {
      const res = await app.request('/api/v10/oauth2/token/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: 'whatever' }),
      })
      expect(res.status).toBe(200)
    })
  })

  describe('GET /oauth2/@me', () => {
    it('is reachable under the /api/v10 prefix and rejects a missing Bearer token', async () => {
      const res = await app.request('/api/v10/oauth2/@me')
      expect(res.status).toBe(401)
    })

    it('returns account info for a valid Bearer token under /api/v10', async () => {
      // /oauth2/@me only resolves for a user-bound token (Authorization Code
      // flow); a Client Credentials token has no associated user and is
      // correctly rejected, so the authorize → token exchange is used here.
      const redirectUri = 'https://example.com/callback'
      const authorizeRes = await app.request(
        `/api/v10/oauth2/authorize?client_id=mock_client&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`,
        { redirect: 'manual' }
      )
      const location = authorizeRes.headers.get('location')
      if (!location)
        throw new Error('expected a Location header on the redirect')
      const code = new URL(location).searchParams.get('code')
      if (!code)
        throw new Error('expected a code query parameter on the redirect')

      const tokenRes = await app.request('/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      })
      expect(tokenRes.status).toBe(200)
      const { access_token: accessToken } = (await tokenRes.json()) as {
        access_token: string
      }

      const res = await app.request('/api/v10/oauth2/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { scopes: string[] }
      expect(Array.isArray(body.scopes)).toBe(true)
    })
  })
})
