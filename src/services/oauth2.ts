/**
 * OAuth2フローサービス
 *
 * Authorization Code FlowとClient Credentials Flowを実装します。
 */

import type { Database } from '../db.js'

/** OAuth2トークンレスポンスの型 */
export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token?: string
  scope: string
}

/** OAuth2現在ユーザー情報の型 */
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

/** トークン有効期限（7日間、秒） */
const TOKEN_EXPIRES_IN = 604_800

/**
 * ランダムなトークン文字列を生成します。
 * @param prefix - トークンのプレフィックス
 * @returns ランダムトークン文字列
 */
function generateToken(prefix: string): string {
  // Math.random は予測可能なため crypto.randomUUID() に変更する
  const random = crypto.randomUUID().replaceAll('-', '')
  return `${prefix}_${random}`
}

/**
 * 認可コードを生成します（Authorization Code Flow）。
 * @param db - データベース
 * @param clientId - クライアントID
 * @param userId - ユーザーID
 * @param scope - スコープ
 * @param redirectUri - リダイレクトURI
 * @returns 生成した認可コード
 */
export function createAuthCode(
  db: Database,
  clientId: string,
  userId: string,
  scope: string,
  redirectUri: string
): string {
  const code = generateToken('code')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10分後

  db.prepare(
    `INSERT INTO oauth2_auth_codes (code, client_id, user_id, scope, redirect_uri, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(code, clientId, userId, scope, redirectUri, expiresAt.toISOString())

  return code
}

/**
 * 認可コードをアクセストークンに交換します。
 * @param db - データベース
 * @param code - 認可コード
 * @param redirectUri - リダイレクトURI
 * @returns トークンレスポンスまたはNull（失敗時）
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

  // コードを使用済みにマーク
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
 * Client Credentials Flowでアクセストークンを生成します。
 * @param db - データベース
 * @param clientId - クライアントID
 * @param scope - スコープ
 * @returns トークンレスポンス
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
 * トークンを無効化します。
 * @param db - データベース
 * @param token - 無効化するトークン
 */
export function revokeToken(db: Database, token: string): void {
  db.prepare('DELETE FROM oauth2_access_tokens WHERE token = ?').run(token)
  db.prepare('DELETE FROM oauth2_access_tokens WHERE refresh_token = ?').run(
    token
  )
}

/**
 * アクセストークンの情報を取得します（/oauth2/@me）。
 * @param db - データベース
 * @param token - アクセストークン
 * @returns OAuth2情報またはNull
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
    scopes: accessToken.scope.split(' '),
    expires: new Date(accessToken.expires_at).toISOString(),
    user: {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
    },
  }
}
