/**
 * OAuth2 flow service
 *
 * Implements the Authorization Code Flow and the Client Credentials Flow.
 */

import type { Database } from '../db'

/** OAuth2 token response type */
export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token?: string
  scope: string
}

/** OAuth2 current user information type */
export interface OAuth2MeResponse {
  application: {
    id: string
    name: string
    icon: null
    description: string
    bot_public: boolean
    bot_require_code_grant: boolean
  }
  scopes: string[]
  expires: string
  user: {
    id: string
    username: string
    discriminator: string
    avatar: string | null
  }
}

/** Token expiration (7 days, in seconds) */
const TOKEN_EXPIRES_IN = 604_800

/**
 * Generates a random token string.
 * @param prefix - Token prefix
 * @returns Random token string
 */
function generateToken(prefix: string): string {
  // Math.random is predictable, so crypto.randomUUID() is used instead
  const random = crypto.randomUUID().replaceAll('-', '')
  return `${prefix}_${random}`
}

/**
 * Generates an authorization code (Authorization Code Flow).
 * @param db - Database
 * @param clientId - Client ID
 * @param userId - User ID
 * @param scope - Scope
 * @param redirectUri - Redirect URI
 * @returns Generated authorization code
 */
export function createAuthCode(
  db: Database,
  clientId: string,
  userId: string,
  scope: string,
  redirectUri: string
): string {
  const code = generateToken('code')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes later

  db.prepare(
    `INSERT INTO oauth2_auth_codes (code, client_id, user_id, scope, redirect_uri, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(code, clientId, userId, scope, redirectUri, expiresAt.toISOString())

  return code
}

/**
 * Exchanges an authorization code for an access token.
 * @param db - Database
 * @param code - Authorization code
 * @param redirectUri - Redirect URI
 * @returns Token response, or null on failure
 */
export function exchangeAuthCode(
  db: Database,
  code: string,
  redirectUri: string
): TokenResponse | null {
  const authCode = db
    .prepare(
      `SELECT * FROM oauth2_auth_codes
       WHERE code = ? AND redirect_uri = ?
       AND datetime(expires_at) > datetime('now') AND used = 0`
    )
    .get(code, redirectUri) as
    | {
        code: string
        client_id: string
        user_id: string
        scope: string
        redirect_uri: string
      }
    | undefined

  if (!authCode) return null

  db.prepare('UPDATE oauth2_auth_codes SET used = 1 WHERE code = ?').run(code)

  const accessToken = generateToken('mock_access_token')
  const refreshToken = generateToken('mock_refresh_token')
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRES_IN * 1000)

  db.prepare(
    `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at, refresh_token)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    accessToken,
    authCode.client_id,
    authCode.user_id,
    authCode.scope,
    expiresAt.toISOString(),
    refreshToken
  )

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_EXPIRES_IN,
    refresh_token: refreshToken,
    scope: authCode.scope,
  }
}

/**
 * Generates an access token using the Client Credentials Flow.
 * @param db - Database
 * @param clientId - Client ID
 * @param scope - Scope
 * @returns Token response
 */
export function createClientCredentialsToken(
  db: Database,
  clientId: string,
  scope: string
): TokenResponse {
  const accessToken = generateToken('mock_access_token')
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRES_IN * 1000)

  db.prepare(
    `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at)
     VALUES (?, ?, NULL, ?, ?)`
  ).run(accessToken, clientId, scope, expiresAt.toISOString())

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_EXPIRES_IN,
    scope,
  }
}

/**
 * Revokes a token.
 * @param db - Database
 * @param token - Token to revoke
 */
export function revokeToken(db: Database, token: string): void {
  db.prepare('DELETE FROM oauth2_access_tokens WHERE token = ?').run(token)
  db.prepare('DELETE FROM oauth2_access_tokens WHERE refresh_token = ?').run(
    token
  )
}

/**
 * Retrieves access token information (/oauth2/@me).
 * @param db - Database
 * @param token - Access token
 * @returns OAuth2 information, or null
 */
export function getOAuth2Me(
  db: Database,
  token: string
): OAuth2MeResponse | null {
  const accessToken = db
    .prepare(
      "SELECT * FROM oauth2_access_tokens WHERE token = ? AND datetime(expires_at) > datetime('now')"
    )
    .get(token) as
    | {
        token: string
        client_id: string
        user_id: string | null
        scope: string
        expires_at: string
      }
    | undefined

  if (!accessToken) return null

  const client = db
    .prepare('SELECT * FROM oauth2_clients WHERE client_id = ?')
    .get(accessToken.client_id) as
    | {
        client_id: string
        bot_token: string | null
      }
    | undefined

  const botToken = client?.bot_token
  const bot = botToken
    ? (db.prepare('SELECT * FROM bots WHERE token = ?').get(botToken) as
        | { user_id: string; username: string }
        | undefined)
    : undefined

  const user = accessToken.user_id
    ? (db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(accessToken.user_id) as
        | {
            id: string
            username: string
            discriminator: string
            avatar: string | null
          }
        | undefined)
    : undefined

  if (!user) return null

  return {
    application: {
      id: bot?.user_id ?? accessToken.client_id,
      name: bot?.username ?? 'MockApp',
      icon: null,
      description: '',
      bot_public: true,
      bot_require_code_grant: false,
    },
    // Guard against an empty scope so we return [] rather than [""].
    scopes: accessToken.scope ? accessToken.scope.split(' ') : [],
    expires: new Date(accessToken.expires_at).toISOString(),
    user: {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
    },
  }
}
