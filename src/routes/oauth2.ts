/**
 * OAuth2 API ルーティング
 *
 * /oauth2/* エンドポイントを実装します。
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import {
  createAuthCode,
  exchangeAuthCode,
  createClientCredentialsToken,
  revokeToken,
  getOAuth2Me,
} from '../services/oauth2.js'

/**
 * OAuth2 APIルートを作成します。
 * @param db - データベース
 * @returns Honoルーターインスタンス
 */
export function createOAuth2Routes(db: Database): Hono {
  const app = new Hono()

  // GET /oauth2/@me
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

  // GET /oauth2/authorize
  app.get('/oauth2/authorize', (c) => {
    const clientId = c.req.query('client_id')
    const redirectUri = c.req.query('redirect_uri')
    const responseType = c.req.query('response_type')
    const scope = c.req.query('scope') ?? ''
    const state = c.req.query('state')

    if (!clientId || !redirectUri || responseType !== 'code') {
      return c.json({ message: '400: Bad Request', code: 0 }, 400)
    }

    // モックは認証画面を表示せず即座にリダイレクト
    const code = createAuthCode(
      db,
      clientId,
      '2222222222222222222', // テスト用デフォルトユーザーID
      scope,
      redirectUri
    )

    const redirectUrl = new URL(redirectUri)
    redirectUrl.searchParams.set('code', code)
    if (state) redirectUrl.searchParams.set('state', state)

    return c.redirect(redirectUrl.toString())
  })

  // POST /oauth2/token
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

      const tokenResponse = createClientCredentialsToken(db, clientId, scope)

      // oauth2_clientsに登録がなければ作成
      const existing = db
        .prepare('SELECT client_id FROM oauth2_clients WHERE client_id = ?')
        .get(clientId)
      if (!existing) {
        db.prepare(
          'INSERT OR IGNORE INTO oauth2_clients (client_id, client_secret) VALUES (?, ?)'
        ).run(clientId, 'mock_secret')
      }

      return c.json(tokenResponse)
    }

    return c.json({ message: '400: Bad Request', code: 0 }, 400)
  })

  // POST /oauth2/token/revoke
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
