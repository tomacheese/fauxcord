/**
 * Gateway API routing
 *
 * Implements GET /gateway and GET /gateway/bot. Fauxcord has no real Gateway,
 * but many libraries call these during login, so dummy values are returned.
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import type { AppEnv, BotRecord } from '../middleware/auth.js'
import { getGatewayInfo, getGatewayBotInfo } from '../services/gateway.js'

/**
 * Creates the Gateway API routes.
 * @param db - Database
 * @param baseUrl - Base URL used to derive the gateway URL
 * @returns Hono router instance
 */
export function createGatewayRoutes(
  db: Database,
  baseUrl: string
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /gateway — Public endpoint (no authentication, matching real Discord)
  app.get('/gateway', (c) => {
    return c.json(getGatewayInfo(baseUrl))
  })

  // GET /gateway/bot — Requires Bot authentication (matching real Discord)
  app.get('/gateway/bot', (c) => {
    let bot = c.get('bot')
    // Fall back to a direct token lookup when auth middleware wasn't applied
    // (e.g. in unit tests that mount this router in isolation).
    if (!bot) {
      const authHeader = c.req.header('Authorization')
      if (authHeader) {
        bot = db
          .prepare('SELECT * FROM bots WHERE token = ?')
          .get(authHeader) as BotRecord | undefined
      }
    }
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(getGatewayBotInfo(baseUrl))
  })

  return app
}
