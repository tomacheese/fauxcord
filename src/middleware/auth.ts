/**
 * 認証ミドルウェア
 *
 * Bot/Bearer トークン認証を処理します。
 * bots テーブルに登録されたトークンのみ許可します。
 */

import type { Context, Next } from 'hono'
import type { Database } from '../db.js'

/**
 * 認証不要なパスのプレフィックス
 *
 * `/_test/` は index.ts で createTestRoutes を authMiddleware より先にマウントしているため
 * 実質認証をバイパスしているが、明示的にここにも追加することでルート登録順が変わっても
 * 意図通りの挙動が維持されるよう保証する
 */
const AUTH_EXEMPT_PREFIXES = ['/_mock/health', '/_mock/attachments', '/_test/']
/**
 * Webhookトークンベース操作パターン（認証不要）
 *
 * Discord API では Webhook の `{id}/{token}` を持つエンドポイントは
 * Bot トークン不要でトークン自体が資格情報になる。
 * - POST /webhooks/{id}/{token}           - Webhook実行
 * - GET  /webhooks/{id}/{token}           - Webhook取得（トークン付き）
 * - DELETE /webhooks/{id}/{token}         - Webhook削除（トークン付き）
 * - GET/PATCH/DELETE /webhooks/{id}/{token}/messages/{msgId}
 */
const WEBHOOK_WITH_TOKEN_PATTERN =
  /^\/(?:api\/(?:v10\/)?)?webhooks\/[^/]+\/[^/]+(?:\/messages\/[^/]+)?$/

/** DBから取得したBotレコードの型 */
export interface BotRecord {
  token: string
  user_id: string
  username: string
  discriminator: string
  bot: number
  avatar: string | null
}

/** DBから取得したOAuth2アクセストークンレコードの型 */
export interface AccessTokenRecord {
  token: string
  user_id: string | null
  scope: string
}

/** Honoアプリ共通の環境型（コンテキスト変数の型定義） */
export interface AppEnv {
  Variables: {
    /** 認証済みBot情報（Botトークン認証時にセット） */
    bot?: BotRecord
    /** OAuth2アクセストークン情報（Bearerトークン認証時にセット） */
    accessToken?: AccessTokenRecord
  }
}

/**
 * Bot/Bearer トークン認証ミドルウェアを作成します。
 * @param db - データベース
 * @param disableAuth - trueの場合、任意のトークンを全許可
 * @returns ミドルウェア関数
 */
export const createAuthMiddleware =
  (db: Database, disableAuth: boolean) =>
  async (c: Context<AppEnv>, next: Next): Promise<undefined | Response> => {
    const path = c.req.path

    // 認証不要パスのチェック
    const isExempt =
      AUTH_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
      WEBHOOK_WITH_TOKEN_PATTERN.test(path)

    if (isExempt) {
      await next()
      return
    }

    const authorization = c.req.header('Authorization')
    if (!authorization) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    // Bot トークン認証
    if (authorization.startsWith('Bot ')) {
      const token = authorization

      if (disableAuth) {
        // 認証無効モード: DBに存在しない場合はデフォルトBotとして処理
        const bot = db
          .prepare('SELECT * FROM bots WHERE token = ?')
          .get(token) as BotRecord | undefined
        if (bot) {
          c.set('bot', bot)
        } else {
          // ダミーのbotオブジェクトをセット
          c.set('bot', {
            token,
            user_id: '000000000000000000',
            username: 'MockBot',
            discriminator: '0',
            bot: 1,
            avatar: null,
          } satisfies BotRecord)
        }
        await next()
        return
      }

      const bot = db
        .prepare('SELECT * FROM bots WHERE token = ?')
        .get(token) as BotRecord | undefined

      if (!bot) {
        return c.json({ message: '401: Unauthorized', code: 0 }, 401)
      }

      c.set('bot', bot)
      await next()
      return
    }

    // Bearer トークン認証
    if (authorization.startsWith('Bearer ')) {
      const token = authorization.slice(7)
      const accessToken = db
        .prepare(
          "SELECT * FROM oauth2_access_tokens WHERE token = ? AND datetime(expires_at) > datetime('now')"
        )
        .get(token) as AccessTokenRecord | undefined

      if (!accessToken) {
        return c.json({ message: '401: Unauthorized', code: 0 }, 401)
      }

      c.set('accessToken', accessToken)
      await next()
      return
    }

    return c.json({ message: '401: Unauthorized', code: 0 }, 401)
  }
