/**
 * OAuth2 API routing
 *
 * Implements the /oauth2/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import {
  createAuthCode,
  exchangeAuthCode,
  createClientCredentialsToken,
  revokeToken,
  getOAuth2Me,
} from '../services/oauth2'

/**
 * Creates the OAuth2 API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createOAuth2Routes(db: Database): Hono {
  const app = new Hono()

  // GET /oauth2/@me — Retrieve OAuth2 access token information
  app.get('/oauth2/@me', (c) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    const token = authHeader.slice(7)
    const me = getOAuth2Me(db, token)
    if (!me) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(me)
  })

  // GET /oauth2/authorize — Redirect for the OAuth2 authorization code flow
  app.get('/oauth2/authorize', (c) => {
    const clientId = c.req.query('client_id')
    const redirectUri = c.req.query('redirect_uri')
    const responseType = c.req.query('response_type')
    const scope = c.req.query('scope') ?? ''
    const state = c.req.query('state')

    if (!clientId || !redirectUri || responseType !== 'code') {
      return c.json({ message: '400: Bad Request', code: 0 }, 400)
    }

    // oauth2_auth_codes references oauth2_clients (FK) and users (not an FK, but referenced by getOAuth2Me),
    // so ensure the client and the default user exist first
    db.prepare(
      'INSERT OR IGNORE INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
    ).run(clientId, 'mock_secret')
    const defaultUserId = '2222222222222222222'
    db.prepare(
      'INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, ?, ?, 0)'
    ).run(defaultUserId, 'MockUser', '0')

    // The mock redirects immediately without showing an authorization page
    const code = createAuthCode(db, clientId, defaultUserId, scope, redirectUri)

    const redirectUrl = new URL(redirectUri)
    redirectUrl.searchParams.set('code', code)
    if (state) redirectUrl.searchParams.set('state', state)

    return c.redirect(redirectUrl.toString())
  })

  // POST /oauth2/token — Issue an OAuth2 token
  app.post('/oauth2/token', async (c) => {
    const contentType = c.req.header('content-type') ?? ''
    let params: URLSearchParams

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await c.req.text()
      params = new URLSearchParams(body)
    } else {
      return c.json({ message: '400: Bad Request', code: 0 }, 400)
    }

    const grantType = params.get('grant_type')

    if (grantType === 'authorization_code') {
      const code = params.get('code')
      const redirectUri = params.get('redirect_uri')

      if (!code || !redirectUri) {
        return c.json({ message: '400: Bad Request', code: 0 }, 400)
      }

      const tokenResponse = exchangeAuthCode(db, code, redirectUri)
      if (!tokenResponse) {
        return c.json({ message: '401: Unauthorized', code: 0 }, 401)
      }
      return c.json(tokenResponse)
    }

    if (grantType === 'client_credentials') {
      const scope = params.get('scope') ?? 'identify'
      const clientId = params.get('client_id') ?? 'mock_client'

      // oauth2_access_tokens has an FK reference to oauth2_clients,
      // so the client must exist before issuing a token
      const existing = db
        .prepare('SELECT client_id FROM oauth2_clients WHERE client_id = ?')
        .get(clientId)
      if (!existing) {
        db.prepare(
          'INSERT OR IGNORE INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
        ).run(clientId, 'mock_secret')
      }

      const tokenResponse = createClientCredentialsToken(db, clientId, scope)
      return c.json(tokenResponse)
    }

    return c.json({ message: '400: Bad Request', code: 0 }, 400)
  })

  // POST /oauth2/token/revoke — Revoke an OAuth2 token
  app.post('/oauth2/token/revoke', async (c) => {
    const body = await c.req.text()
    const params = new URLSearchParams(body)
    const token = params.get('token')

    if (!token) {
      return c.json({ message: '400: Bad Request', code: 0 }, 400)
    }

    revokeToken(db, token)
    return c.json({})
  })

  return app
}
