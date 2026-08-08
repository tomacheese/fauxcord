/**
 * Hono app assembly logic.
 *
 * Handles middleware registration, route registration, and mounting the
 * Gateway WebSocket handler. Shared by both the production entry point
 * (src/index.ts) and the test harness (src/test-helpers.ts).
 */

import { Hono } from 'hono'
import { upgradeWebSocket } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import type { Database } from './db'
import { corsMiddleware } from './middleware/cors'
import { versionMiddleware } from './middleware/version'
import { createAuthMiddleware, type AppEnv } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { createLatencyMiddleware } from './middleware/latency'
import { createChannelRoutes } from './routes/channels'
import { createGuildRoutes } from './routes/guilds'
import { createUserRoutes } from './routes/users'
import { createGatewayRoutes } from './routes/gateway'
import { createSoundboardRoutes } from './routes/soundboard'
import { createWebhookRoutes } from './routes/webhooks'
import { createInviteRoutes } from './routes/invites'
import { createApplicationCommandRoutes } from './routes/application-commands'
import { createApplicationRoutes } from './routes/applications'
import { createInteractionRoutes } from './routes/interactions'
import { createOAuth2Routes } from './routes/oauth2'
import { createTestRoutes } from './routes/test'
import { createMockRoutes } from './routes/mock'
import { createGatewayWebSocketHandler } from './gateway/server'
import { registerGatewaySubscriptions } from './gateway/subscribe'
import type { SessionManager } from './gateway/session'

/** Minimal subset of config required by buildApp */
export interface BuildAppConfig {
  /** baseUrl used for generating attachment URLs, etc. */
  baseUrl: string
  /** Directory where attachments are stored */
  uploadPath?: string
  /** If true, any token is accepted */
  disableAuth: boolean
  /** Artificial latency (ms) applied to all responses */
  latencyMs?: number
  /** Existing no-server WebSocket server when HTTP is bound before assembly. */
  wss?: WebSocketServer
}

/**
 * Builds the Hono app (does not start it).
 * Shared by both the production entry point (index.ts) and the test harness
 * (test-helpers.ts).
 * @param db - Database
 * @param config - baseUrl, uploadPath, disableAuth, latencyMs
 * @returns The assembled app, the `WebSocketServer` to pass to `serve()`'s
 * `websocket` option, the `SessionManager` used for Gateway dispatch, and a
 * function that unsubscribes from `gatewayBus`
 */
export function buildApp(
  db: Database,
  config: BuildAppConfig
): {
  app: Hono<AppEnv>
  wss: WebSocketServer
  sessionManager: SessionManager
  /** Function that unsubscribes the listeners registered by registerGatewaySubscriptions */
  unsubscribeGateway: () => void
} {
  const app = new Hono<AppEnv>()
  // `noServer: true` is required because `@hono/node-server`'s
  // `serve({ websocket: { server: wss } })` takes over handling the
  // upgrade event.
  const wss = config.wss ?? new WebSocketServer({ noServer: true })

  // Configure middleware (applied to all requests)
  app.use('*', corsMiddleware)
  app.use('*', versionMiddleware)

  // Infrastructure APIs require no authentication (registered first)
  app.route('/', createMockRoutes(db, config.uploadPath ?? '/data/uploads'))

  // Test control APIs require no authentication
  app.route('/', createTestRoutes(db, config.baseUrl))

  // OAuth2 is partially exempt from authentication (its endpoints validate
  // their own Bearer/client-credential auth internally), so it is mounted
  // before the auth middleware below — but, like every other route group, it
  // must still be reachable under all three version prefixes, not just the
  // bare path. Real clients (discord.js, Oceanic.js, etc.) always call
  // through the versioned base URL (e.g. `/api/v10/oauth2/token`).
  for (const oauth2Prefix of ['/api/v10', '/api', '']) {
    app.route(oauth2Prefix, createOAuth2Routes(db))
  }

  // The Gateway WebSocket is mounted at "/" (matching real Discord's Gateway
  // URL structure, where the path itself carries no meaning and
  // v=10&encoding=json is passed as query parameters). Authentication
  // happens inside the IDENTIFY message after the WebSocket connection is
  // established (as with real Discord), so this is mounted before the
  // HTTP-level Bot token auth middleware and requires no authentication.
  const gatewayHandler = createGatewayWebSocketHandler(db, {
    baseUrl: config.baseUrl,
    disableAuth: config.disableAuth,
  })
  // Forward resource-change events from gatewayBus to connected Gateway sessions
  const unsubscribeGateway = registerGatewaySubscriptions(
    gatewayHandler.sessionManager
  )
  app.get(
    '/',
    upgradeWebSocket(() => gatewayHandler.upgrade)
  )

  // Routes below require authentication checks
  // Token-based webhook operations (/webhooks/{id}/{token}...) are exempted in auth.ts
  // CRUD operations requiring a Bot token go through authentication
  const authMiddleware = createAuthMiddleware(db, config.disableAuth)
  const latencyMiddleware = createLatencyMiddleware(config.latencyMs ?? 0)

  app.use('*', authMiddleware)
  app.use('*', latencyMiddleware)
  app.use('*', rateLimitMiddleware)

  // Normalize version prefixes and mount each route
  // /api/v10/ → /
  // /api/ → /
  // / → as-is
  const routePrefix = ['/api/v10', '/api', '']

  for (const prefix of routePrefix) {
    app.route(
      prefix,
      createChannelRoutes(db, config.baseUrl, config.uploadPath)
    )
    app.route(prefix, createGuildRoutes(db))
    app.route(prefix, createUserRoutes(db))
    app.route(prefix, createGatewayRoutes(db, config.baseUrl))
    app.route(prefix, createSoundboardRoutes())
    // Webhook routes are also enabled for all prefixes (to support /api/v10/webhooks/...)
    app.route(prefix, createWebhookRoutes(db, config.baseUrl))
    app.route(prefix, createInviteRoutes(db))
    app.route(
      prefix,
      createApplicationRoutes(db, config.baseUrl, config.uploadPath)
    )
    app.route(prefix, createApplicationCommandRoutes(db))
    app.route(prefix, createInteractionRoutes(db, config.baseUrl))
  }

  // Global error handler
  app.onError((err, c) => {
    console.error(err)
    return c.json({ message: '500: Internal Server Error', code: 0 }, 500)
  })

  app.notFound((c) => {
    return c.json({ message: '404: Not Found', code: 0 }, 404)
  })

  return {
    app,
    wss,
    sessionManager: gatewayHandler.sessionManager,
    unsubscribeGateway,
  }
}
