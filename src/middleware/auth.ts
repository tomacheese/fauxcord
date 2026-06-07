/**
 * Authentication middleware
 *
 * Handles Bot/Bearer token authentication.
 * Only tokens registered in the bots table are allowed.
 */

import type { Context, Next } from 'hono'
import type { Database } from '../db.js'

/**
 * Path prefixes that do not require authentication
 *
 * `/_test/` effectively bypasses auth because index.ts mounts createTestRoutes
 * before authMiddleware, but it is also listed here explicitly to guarantee the
 * intended behavior even if the route registration order changes.
 */
const AUTH_EXEMPT_PREFIXES = ['/_mock/health', '/_mock/attachments', '/_test/']
/**
 * Webhook token-based operation pattern (no authentication required)
 *
 * In the Discord API, endpoints containing the webhook `{id}/{token}` do not
 * require a Bot token; the token itself acts as the credential.
 * - POST /webhooks/{id}/{token}           - Execute webhook
 * - GET  /webhooks/{id}/{token}           - Get webhook (with token)
 * - DELETE /webhooks/{id}/{token}         - Delete webhook (with token)
 * - GET/PATCH/DELETE /webhooks/{id}/{token}/messages/{msgId}
 */
const WEBHOOK_WITH_TOKEN_PATTERN =
  /^\/(?:api\/(?:v10\/)?)?webhooks\/[^/]+\/[^/]+(?:\/messages\/[^/]+)?$/

/** Type of a Bot record fetched from the DB */
export interface BotRecord {
  token: string
  user_id: string
  username: string
  discriminator: string
  bot: number
  avatar: string | null
}

/** Type of an OAuth2 access token record fetched from the DB */
export interface AccessTokenRecord {
  token: string
  user_id: string | null
  scope: string
}

/** Common environment type for the Hono app (context variable type definitions) */
export interface AppEnv {
  Variables: {
    /** Authenticated Bot information (set on Bot token authentication) */
    bot?: BotRecord
    /** OAuth2 access token information (set on Bearer token authentication) */
    accessToken?: AccessTokenRecord
  }
}

/**
 * Creates a Bot/Bearer token authentication middleware.
 * @param db - Database
 * @param disableAuth - When true, any token is allowed
 * @returns Middleware function
 */
export const createAuthMiddleware =
  (db: Database, disableAuth: boolean) =>
  async (c: Context<AppEnv>, next: Next): Promise<undefined | Response> => {
    const path = c.req.path

    // Check for auth-exempt paths
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

    // Bot token authentication
    if (authorization.startsWith('Bot ')) {
      const token = authorization

      if (disableAuth) {
        // Auth-disabled mode: treat tokens not in the DB as a default Bot
        const bot = db
          .prepare('SELECT * FROM bots WHERE token = ?')
          .get(token) as BotRecord | undefined
        if (bot) {
          c.set('bot', bot)
        } else {
          // Set a dummy bot object
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

    // Bearer token authentication
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
