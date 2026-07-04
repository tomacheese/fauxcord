/**
 * Discord Mock Server entry point
 *
 * Starts the Hono app and provides a mock server for Discord REST API v10.
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { loadConfig } from './config'
import { initializeDatabase } from './db'
import { corsMiddleware } from './middleware/cors'
import { versionMiddleware } from './middleware/version'
import { createAuthMiddleware, type AppEnv } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { createLatencyMiddleware } from './middleware/latency'
import { createChannelRoutes } from './routes/channels'
import { createGuildRoutes } from './routes/guilds'
import { createUserRoutes } from './routes/users'
import { createGatewayRoutes } from './routes/gateway'
import { createWebhookRoutes } from './routes/webhooks'
import { createInviteRoutes } from './routes/invites'
import { createOAuth2Routes } from './routes/oauth2'
import { createTestRoutes } from './routes/test'
import { createMockRoutes } from './routes/mock'
import { readFile } from 'node:fs/promises'
import { setupTestEnvironment } from './services/test-control'

const config = loadConfig()

const db = initializeDatabase(config.dbPath)

const app = new Hono<AppEnv>()

// Configure middleware (applied to all requests)
app.use('*', corsMiddleware)
app.use('*', versionMiddleware)

// Infrastructure APIs require no authentication (registered first)
app.route('/', createMockRoutes(db, config.uploadPath))

// Test control APIs require no authentication
app.route('/', createTestRoutes(db))

// OAuth2 is partially exempt from authentication
app.route('/', createOAuth2Routes(db))

// Routes below require authentication checks
// Token-based webhook operations (/webhooks/{id}/{token}...) are exempted in auth.ts
// CRUD operations requiring a Bot token go through authentication
const authMiddleware = createAuthMiddleware(db, config.disableAuth)
const latencyMiddleware = createLatencyMiddleware(config.latencyMs)

app.use('*', authMiddleware)
app.use('*', latencyMiddleware)
app.use('*', rateLimitMiddleware)

// Normalize version prefixes and mount each route
// /api/v10/ → /
// /api/ → /
// / → as-is
const routePrefix = ['/api/v10', '/api', '']

for (const prefix of routePrefix) {
  app.route(prefix, createChannelRoutes(db, config.baseUrl, config.uploadPath))
  app.route(prefix, createGuildRoutes(db))
  app.route(prefix, createUserRoutes(db))
  app.route(prefix, createGatewayRoutes(db, config.baseUrl))
  // Webhook routes are also enabled for all prefixes (to support /api/v10/webhooks/...)
  app.route(prefix, createWebhookRoutes(db, config.baseUrl))
  app.route(prefix, createInviteRoutes(db))
}

// Global error handler
app.onError((err, c) => {
  console.error(err)
  return c.json({ message: '500: Internal Server Error', code: 0 }, 500)
})

app.notFound((c) => {
  return c.json({ message: '404: Not Found', code: 0 }, 404)
})

// Load SEED_FILE
if (config.seedFile) {
  try {
    const seedData = JSON.parse(await readFile(config.seedFile, 'utf8')) as {
      bots: {
        token: string
        user?: { id?: string; username?: string }
        guilds?: {
          id?: string
          name: string
          channels?: { id?: string; name: string; type?: number }[]
        }[]
      }[]
    }

    for (const bot of seedData.bots) {
      try {
        setupTestEnvironment(db, bot)
        console.info(`Seeded bot: ${bot.token}`)
      } catch (err) {
        if (err instanceof Error && err.message === 'CONFLICT') {
          console.info(`Bot already exists: ${bot.token}, skipping`)
        } else {
          throw err
        }
      }
    }
  } catch (err) {
    console.error('Failed to load seed file:', err)
  }
}

// Start the server
const port = config.port
const hostname = config.host

console.info(`Discord Mock Server starting on ${hostname}:${port}`)

serve({
  fetch: app.fetch,
  port,
  hostname,
})

export { app }
