/**
 * Authentication middleware
 *
 * Handles Bot/Bearer token authentication.
 * Only tokens registered in the bots table are allowed.
 */

import type { Context, Next } from 'hono'
import type { Database } from '../db'

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
 * - POST /webhooks/{id}/{token}/github  - GitHub webhook integration
 * - POST /webhooks/{id}/{token}/slack   - Slack webhook integration
 */
const WEBHOOK_WITH_TOKEN_PATTERN =
  /^\/(?:api\/(?:v10\/)?)?webhooks\/[^/]+\/[^/]+(?:\/messages\/[^/]+|\/github|\/slack)?$/

/**
 * Public gateway endpoint pattern (no authentication required)
 *
 * `GET /gateway` is a public endpoint in the real Discord API. Matched by exact
 * path (with an optional version prefix) so `/gateway/bot`, which DOES require a
 * Bot token, is not exempted.
 */
const GATEWAY_PUBLIC_PATTERN = /^\/(?:api\/(?:v10\/)?)?gateway$/

/**
 * Interaction callback endpoint pattern (no authentication required)
 *
 * `POST /interactions/{id}/{token}/callback` is authenticated by the
 * interaction token itself, matching real Discord.
 */
const INTERACTION_CALLBACK_PATTERN =
  /^\/(?:api\/(?:v10\/)?)?interactions\/[^/]+\/[^/]+\/callback$/

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
  client_id: string
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
 * Builds a dummy Bot record used when authentication is disabled and the
 * provided token is not registered in the database.
 * @param token - The raw Authorization header value to associate with the dummy bot
 * @returns A dummy BotRecord representing the default MockBot
 */
function createDummyBot(token: string): BotRecord {
  return {
    token,
    user_id: '000000000000000000',
    username: 'MockBot',
    discriminator: '0',
    bot: 1,
    avatar: null,
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
      WEBHOOK_WITH_TOKEN_PATTERN.test(path) ||
      GATEWAY_PUBLIC_PATTERN.test(path) ||
      INTERACTION_CALLBACK_PATTERN.test(path)

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
      const bot = db
        .prepare('SELECT * FROM bots WHERE token = ?')
        .get(token) as BotRecord | undefined

      if (bot) {
        c.set('bot', bot)
        await next()
        return
      }

      // Auth-disabled mode: treat tokens not in the DB as a default Bot
      if (disableAuth) {
        c.set('bot', createDummyBot(token))
        await next()
        return
      }

      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    // Bearer token authentication
    if (authorization.startsWith('Bearer ')) {
      const token = authorization.slice(7)
      const accessToken = db
        .prepare(
          "SELECT * FROM oauth2_access_tokens WHERE token = ? AND datetime(expires_at) > datetime('now')"
        )
        .get(token) as AccessTokenRecord | undefined

      if (accessToken) {
        c.set('accessToken', accessToken)
        await next()
        return
      }

      // Auth-disabled mode: accept any Bearer token with a dummy access token
      if (disableAuth) {
        c.set('accessToken', {
          token,
          client_id: '000000000000000000',
          user_id: '000000000000000000',
          scope: '',
        } satisfies AccessTokenRecord)
        await next()
        return
      }

      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    // Unrecognized authorization scheme: allow through as a dummy Bot when
    // authentication is disabled, otherwise reject.
    if (disableAuth) {
      c.set('bot', createDummyBot(authorization))
      await next()
      return
    }

    return c.json({ message: '401: Unauthorized', code: 0 }, 401)
  }
