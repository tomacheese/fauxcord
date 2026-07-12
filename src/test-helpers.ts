/**
 * Test helper functions
 *
 * Provides utilities to simplify testing Hono apps.
 * Includes both lightweight single-route helpers and a full-stack app factory
 * that wires middleware and all routes (used by contract tests).
 */

import { Hono } from 'hono'
import { serveWithGateway } from './http-server'
import { initializeDatabase, closeDatabase } from './database'
import type { Database } from './database'
import { createAuthMiddleware, type AppEnvironment } from './middleware/auth'
import { corsMiddleware } from './middleware/cors'
import { versionMiddleware } from './middleware/version'
import { createChannelRoutes } from './routes/channels'
import { createGuildRoutes } from './routes/guilds'
import { createUserRoutes } from './routes/users'
import { createGatewayRoutes } from './routes/gateway'
import { createSoundboardRoutes } from './routes/soundboard'
import { createWebhookRoutes } from './routes/webhooks'
import { createInviteRoutes } from './routes/invites'
import { createOAuth2Routes } from './routes/oauth2'
import { createTestRoutes } from './routes/test'
import { createMockRoutes } from './routes/mock'
import { generateSnowflake } from './snowflake'
import { buildApp } from './app'
import type { SessionManager } from './gateway/session'

const TEST_BASE_URL = 'http://localhost:3000'
const TEST_UPLOAD_PATH = '/tmp/fauxcord-test-uploads'

/** DB/App pair for testing */
export interface TestContext {
  db: Database
  app: Hono
  cleanup: () => void
}

/** DB/App pair for full-stack contract testing */
export interface FullTestContext {
  db: Database
  app: Hono<AppEnvironment>
  cleanup: () => void
}

/**
 * Creates a Hono app and an in-memory DB for testing.
 * @returns Test context
 */
export function createTestApp(): TestContext {
  const database = initializeDatabase(':memory:')
  const app = new Hono()

  return {
    db: database,
    app,
    cleanup: () => {
      closeDatabase(database)
    },
  }
}

/**
 * Creates a Hono app with core middleware and all routes mounted for contract
 * testing. Mirrors the production `src/index.ts` route registration order, but
 * intentionally omits latency (`LATENCY_MS`) and rate-limit middleware that are
 * irrelevant for deterministic schema validation tests.
 *
 * Used by `src/spec-contract.test.ts` to issue requests through the auth,
 * CORS, and version-check layers with an in-memory DB.
 *
 * @returns Full test context with `app` and `db`
 */
export function createFullTestApp(): FullTestContext {
  const database = initializeDatabase(':memory:')
  const app = new Hono<AppEnvironment>()

  // Middleware (same order as index.ts)
  app.use('*', corsMiddleware)
  app.use('*', versionMiddleware)

  // Routes that do not require authentication (mounted before auth middleware)
  app.route('/', createMockRoutes(database, TEST_UPLOAD_PATH))
  app.route('/', createTestRoutes(database))
  // OAuth2 must be reachable under all three version prefixes, matching
  // src/index.ts (see its comment for why it is exempt from auth here).
  for (const oauth2Prefix of ['/api/v10', '/api', '']) {
    app.route(oauth2Prefix, createOAuth2Routes(database))
  }

  // Authentication middleware
  const authMiddleware = createAuthMiddleware(database, false)
  app.use('*', authMiddleware)

  // Discord API routes (mounted under all three prefixes)
  const routePrefixes = ['/api/v10', '/api', '']
  for (const prefix of routePrefixes) {
    app.route(
      prefix,
      createChannelRoutes(database, TEST_BASE_URL, TEST_UPLOAD_PATH)
    )
    app.route(prefix, createGuildRoutes(database))
    app.route(prefix, createUserRoutes(database))
    app.route(prefix, createGatewayRoutes(database, TEST_BASE_URL))
    app.route(prefix, createSoundboardRoutes())
    app.route(prefix, createWebhookRoutes(database, TEST_BASE_URL))
    app.route(prefix, createInviteRoutes(database))
  }

  return {
    db: database,
    app,
    cleanup: () => {
      closeDatabase(database)
    },
  }
}

/**
 * Starts a test server that handles WebSocket upgrades over a real socket.
 * Uses an in-memory DB and lets the OS assign a port via port 0.
 * @returns The db, the connection URL, and a close function for teardown
 */
export async function createTestGatewayServer(): Promise<{
  db: Database
  url: string
  sessionManager: SessionManager
  close: () => Promise<void>
}> {
  const database = initializeDatabase(':memory:') // same DB initialization as the existing createTestApp
  const { app, wss, sessionManager, unsubscribeGateway } = buildApp(database, {
    baseUrl: 'http://localhost:0',
    disableAuth: false,
  })

  const server = await new Promise<ReturnType<typeof serveWithGateway>>(
    (resolve) => {
      const s = serveWithGateway(
        {
          fetch: app.fetch,
          port: 0,
          hostname: '127.0.0.1',
          wss,
        },
        () => {
          resolve(s)
        }
      )
    }
  )

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    db: database,
    url: `ws://127.0.0.1:${port}`,
    sessionManager,
    close: () => {
      // Always unsubscribe from gatewayBus to prevent listener leaks across
      // repeated createTestGatewayServer() calls in the test suite.
      unsubscribeGateway()
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          closeDatabase(database)
          resolve()
        })
      })
    },
  }
}

/**
 * Registers a Bot token in the DB for testing.
 * @param database - Database
 * @param token - Bot token string (default: "Bot testtoken")
 * @param userId - User ID (default: "111111111111111111")
 * @returns Registered token
 */
export function seedBot(
  database: Database,
  token = 'Bot testtoken',
  userId = '111111111111111111'
): string {
  database
    .prepare('INSERT OR IGNORE INTO users (id, username, bot) VALUES (?, ?, 1)')
    .run(userId, 'TestBot')
  database
    .prepare(
      'INSERT OR IGNORE INTO bots (token, user_id, username) VALUES (?, ?, ?)'
    )
    .run(token, userId, 'TestBot')
  return token
}

/**
 * Registers a Guild in the DB for testing.
 * @param database - Database
 * @param botToken - Associated Bot token
 * @param guildId - Guild ID (default: "222222222222222222")
 * @returns Registered Guild ID
 */
export function seedGuild(
  database: Database,
  botToken: string,
  guildId = '222222222222222222'
): string {
  const bot = database
    .prepare('SELECT user_id FROM bots WHERE token = ?')
    .get(botToken) as { user_id: string } | undefined
  const ownerId = bot?.user_id ?? '111111111111111111'

  database
    .prepare(
      'INSERT OR IGNORE INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
    )
    .run(guildId, 'Test Guild', ownerId, botToken)
  return guildId
}

/**
 * Registers a Channel in the DB for testing.
 * @param database - Database
 * @param guildId - Parent Guild ID
 * @param channelId - Channel ID (default: "333333333333333333")
 * @returns Registered Channel ID
 */
export function seedChannel(
  database: Database,
  guildId: string,
  channelId = '333333333333333333'
): string {
  database
    .prepare(
      'INSERT OR IGNORE INTO channels (id, guild_id, name, type) VALUES (?, ?, ?, 0)'
    )
    .run(channelId, guildId, 'general')
  return channelId
}

/**
 * Inserts a message into the DB for testing.
 * @param database - Database
 * @param channelId - Channel ID
 * @param authorId - Author user ID
 * @param authorToken - Author Bot token (or "webhook" for webhook messages)
 * @param content - Message content
 * @returns Generated message ID
 */
export function seedMessage(
  database: Database,
  channelId: string,
  authorId: string,
  authorToken: string,
  content = 'Test message'
): string {
  const messageId = generateSnowflake()
  database
    .prepare(
      'INSERT INTO messages (id, channel_id, author_id, author_token, content) VALUES (?, ?, ?, ?, ?)'
    )
    .run(messageId, channelId, authorId, authorToken, content)
  return messageId
}

/**
 * Inserts a webhook into the DB for testing.
 * @param database - Database
 * @param channelId - Channel ID
 * @param guildId - Guild ID (nullable)
 * @param name - Webhook name
 * @returns Object with webhookId and webhookToken
 */
export function seedWebhook(
  database: Database,
  channelId: string,
  guildId: string | null,
  name = 'Test Webhook'
): { webhookId: string; webhookToken: string } {
  const webhookId = generateSnowflake()
  const webhookToken = `mock_wh_token_${webhookId}`
  database
    .prepare(
      'INSERT INTO webhooks (id, guild_id, channel_id, name, token) VALUES (?, ?, ?, ?, ?)'
    )
    .run(webhookId, guildId, channelId, name, webhookToken)
  return { webhookId, webhookToken }
}

/**
 * Inserts a role into the DB for testing.
 * @param database - Database
 * @param guildId - Guild ID
 * @param name - Role name
 * @returns Generated role ID
 */
export function seedRole(
  database: Database,
  guildId: string,
  name = 'test-role'
): string {
  const roleId = generateSnowflake()
  const maxPosition = (
    database
      .prepare(
        'SELECT COALESCE(MAX(position), 0) as pos FROM roles WHERE guild_id = ?'
      )
      .get(guildId) as { pos: number }
  ).pos
  database
    .prepare(
      'INSERT INTO roles (id, guild_id, name, color, hoist, position, permissions, mentionable) VALUES (?, ?, ?, 0, 0, ?, ?, 0)'
    )
    .run(roleId, guildId, name, maxPosition + 1, '0')
  return roleId
}

/**
 * Inserts an emoji into the DB for testing.
 * @param database - Database
 * @param guildId - Guild ID
 * @param userId - Creator user ID (nullable)
 * @param name - Emoji name
 * @returns Generated emoji ID
 */
export function seedEmoji(
  database: Database,
  guildId: string,
  userId: string | null,
  name = 'test_emoji'
): string {
  const emojiId = generateSnowflake()
  database
    .prepare(
      "INSERT INTO emojis (id, guild_id, name, user_id, roles) VALUES (?, ?, ?, ?, '[]')"
    )
    .run(emojiId, guildId, name, userId)
  return emojiId
}

/**
 * Inserts an invite into the DB for testing.
 * @param database - Database
 * @param channelId - Channel ID
 * @param guildId - Guild ID (nullable)
 * @param inviterId - Inviter user ID (nullable)
 * @param code - Invite code (default: "testcode")
 * @returns The invite code
 */
export function seedInvite(
  database: Database,
  channelId: string,
  guildId: string | null,
  inviterId: string | null,
  code = 'testcode'
): string {
  // Uses INSERT OR REPLACE (not plain INSERT) so calling this more than once
  // with the default code in the same in-memory DB replaces the row instead
  // of throwing a UNIQUE constraint error, matching the other seed helpers'
  // idempotent style.
  database
    .prepare(
      'INSERT OR REPLACE INTO invites (code, channel_id, guild_id, inviter_id) VALUES (?, ?, ?, ?)'
    )
    .run(code, channelId, guildId, inviterId)
  return code
}

/**
 * Registers a second user and adds them as a guild member for testing.
 * @param database - Database
 * @param guildId - Guild ID
 * @param userId - User ID (auto-generated if omitted)
 * @returns User ID of the registered member
 */
export function seedMember(
  database: Database,
  guildId: string,
  userId?: string
): string {
  const memberId = userId ?? generateSnowflake()
  database
    .prepare(
      "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, 'TestMember', '0', 0)"
    )
    .run(memberId)
  database
    .prepare(
      'INSERT OR IGNORE INTO guild_members (guild_id, user_id) VALUES (?, ?)'
    )
    .run(guildId, memberId)
  return memberId
}

/**
 * Registers a banned user and inserts a guild ban for testing.
 * Also registers the user so ban responses can resolve a full user object.
 * @param database - Database
 * @param guildId - Guild ID
 * @param userId - Banned user ID (auto-generated if omitted)
 * @param reason - Ban reason (default null)
 * @returns User ID of the banned user
 */
export function seedBan(
  database: Database,
  guildId: string,
  userId?: string,
  reason: string | null = null
): string {
  const bannedId = userId ?? generateSnowflake()
  database
    .prepare(
      "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, 'BannedUser', '0', 0)"
    )
    .run(bannedId)
  database
    .prepare(
      'INSERT OR IGNORE INTO guild_bans (guild_id, user_id, reason) VALUES (?, ?, ?)'
    )
    .run(guildId, bannedId, reason)
  return bannedId
}
