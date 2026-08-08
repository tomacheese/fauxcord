/**
 * Test helper functions
 *
 * Provides utilities to simplify testing Hono apps.
 * Includes both lightweight single-route helpers and a full-stack app factory
 * that wires middleware and all routes (used by contract tests).
 */

import { Hono } from 'hono'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { serveWithGateway } from './http-server'
import { initializeDatabase, closeDatabase } from './db'
import type { Database } from './db'
import { createAuthMiddleware, type AppEnv } from './middleware/auth'
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
import { createApplicationCommandRoutes } from './routes/application-commands'
import { createInteractionRoutes } from './routes/interactions'
import { generateSnowflake } from './snowflake'
import { buildApp } from './app'
import { createCommand } from './services/application-commands'
import { createInteraction } from './services/interactions'
import { createPoll } from './services/polls'
import type { SessionManager } from './gateway/session'
import type { ContractFixture } from '../spec/manifest'

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
  app: Hono<AppEnv>
  cleanup: () => void
}

/** Real HTTP server context for network contract tests. */
export interface RealServerContext {
  db: Database
  baseUrl: string
  sessionManager: SessionManager
  close: () => Promise<void>
}

/** Injectable startup controls used by failure-path tests. */
export interface RealServerOptions {
  uploadPath?: string
  serve?: typeof serveWithGateway
  onDatabaseCreated?: (db: Database) => void
}

/**
 * Creates a Hono app and an in-memory DB for testing.
 * @returns Test context
 */
export function createTestApp(): TestContext {
  const db = initializeDatabase(':memory:')
  const app = new Hono()

  return {
    db,
    app,
    cleanup: () => {
      closeDatabase(db)
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
  const db = initializeDatabase(':memory:')
  const app = new Hono<AppEnv>()

  // Middleware (same order as index.ts)
  app.use('*', corsMiddleware)
  app.use('*', versionMiddleware)

  // Routes that do not require authentication (mounted before auth middleware)
  app.route('/', createMockRoutes(db, TEST_UPLOAD_PATH))
  app.route('/', createTestRoutes(db, TEST_BASE_URL))
  // OAuth2 must be reachable under all three version prefixes, matching
  // src/index.ts (see its comment for why it is exempt from auth here).
  for (const oauth2Prefix of ['/api/v10', '/api', '']) {
    app.route(oauth2Prefix, createOAuth2Routes(db))
  }

  // Authentication middleware
  const authMiddleware = createAuthMiddleware(db, false)
  app.use('*', authMiddleware)

  // Discord API routes (mounted under all three prefixes)
  const routePrefixes = ['/api/v10', '/api', '']
  for (const prefix of routePrefixes) {
    app.route(prefix, createChannelRoutes(db, TEST_BASE_URL, TEST_UPLOAD_PATH))
    app.route(prefix, createGuildRoutes(db))
    app.route(prefix, createUserRoutes(db))
    app.route(prefix, createGatewayRoutes(db, TEST_BASE_URL))
    app.route(prefix, createSoundboardRoutes())
    app.route(prefix, createWebhookRoutes(db, TEST_BASE_URL))
    app.route(prefix, createInviteRoutes(db))
    app.route(prefix, createApplicationCommandRoutes(db))
    app.route(prefix, createInteractionRoutes(db, TEST_BASE_URL))
  }

  return {
    db,
    app,
    cleanup: () => {
      closeDatabase(db)
    },
  }
}

/** Seeds the complete operation-contract fixture in a test database. */
/* eslint-disable @typescript-eslint/no-use-before-define -- Public seed helpers are grouped below the app factories. */
export function createContractFixture(db: Database): ContractFixture {
  const token = 'Bot contract-test-token'
  const userId = '555555555555555555'
  const bearerToken = 'contract-test-bearer-token'
  seedBot(db, token, userId)
  db.prepare(
    'INSERT INTO oauth2_clients (client_id, client_secret, bot_token) VALUES (?, ?, ?)'
  ).run(userId, 'contract-secret', token)
  db.prepare(
    `INSERT INTO oauth2_access_tokens
       (token, client_id, user_id, scope, expires_at)
     VALUES (?, ?, ?, 'identify applications.commands', datetime('now', '+1 hour'))`
  ).run(bearerToken, userId, userId)
  const guildId = seedGuild(db, token, '666666666666666666')
  db.prepare(
    `INSERT OR IGNORE INTO roles
       (id, guild_id, name, permissions, position, color, hoist, mentionable)
     VALUES (?, ?, '@everyone', '1071698660929', 0, 0, 0, 0)`
  ).run(guildId, guildId)
  const channelId = seedChannel(db, guildId, '777777777777777777')
  const unindexedChannelId = seedChannel(db, guildId, '777777777777777781')
  const announcementChannelId = seedAnnouncementChannel(
    db,
    guildId,
    '777777777777777778'
  )
  const voiceChannelId = seedVoiceChannel(db, guildId, '777777777777777779')
  const groupDmChannelId = seedGroupDmChannel(db, '777777777777777780')
  const { webhookId, webhookToken } = seedWebhook(db, channelId, guildId)
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, 'WebhookUser', '0000', 1)"
  ).run(webhookId)
  const messageId = seedMessage(db, channelId, userId, token)
  const announcementMessageId = seedMessage(
    db,
    announcementChannelId,
    userId,
    token
  )
  const deletableMessageId = seedMessage(db, channelId, userId, token)
  const pinnedMessageId = seedMessage(db, channelId, userId, token)
  db.prepare('INSERT INTO pins (channel_id, message_id) VALUES (?, ?)').run(
    channelId,
    pinnedMessageId
  )
  db.prepare('UPDATE messages SET pinned = 1 WHERE id = ?').run(pinnedMessageId)
  const reactedMessageId = seedMessage(db, channelId, userId, token)
  db.prepare(
    'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
  ).run(reactedMessageId, userId, '👍')
  const pollMessageId = seedMessage(db, channelId, userId, token)
  createPoll(db, pollMessageId, {
    question: 'Contract poll?',
    answers: [{ text: 'Yes' }, { text: 'No' }],
  })
  const webhookMessageId = seedMessage(db, channelId, webhookId, 'webhook')
  const roleId = seedRole(db, guildId)
  const deletableRoleId = seedRole(db, guildId, 'deletable-role')
  const assignedRoleId = seedRole(db, guildId, 'assigned-role')
  const deletableOverwriteId = generateSnowflake()
  db.prepare(
    `INSERT INTO channel_overwrites (channel_id, id, type, allow, deny)
     VALUES (?, ?, 0, '0', '0')`
  ).run(channelId, deletableOverwriteId)
  db.prepare(
    'INSERT OR IGNORE INTO guild_members (guild_id, user_id) VALUES (?, ?)'
  ).run(guildId, userId)
  const memberId = seedMember(db, guildId)
  db.prepare(
    'INSERT INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'
  ).run(guildId, memberId, assignedRoleId)
  const banTargetUserId = seedMember(db, guildId)
  const removableRecipientId = seedMember(db, guildId)
  db.prepare(
    'INSERT INTO channel_recipients (channel_id, user_id) VALUES (?, ?)'
  ).run(groupDmChannelId, removableRecipientId)
  const emojiId = seedEmoji(db, guildId, userId)
  const inviteCode = seedInvite(db, channelId, guildId, userId, 'contractcode')
  const deletableInviteCode = seedInvite(
    db,
    channelId,
    guildId,
    userId,
    'deletablecode'
  )
  const bannedUserId = seedBan(db, guildId, undefined, 'Contract test ban')
  const threadId = '888888888888888888'
  db.prepare(
    `INSERT INTO channels
       (id, guild_id, type, name, parent_id, owner_id, archived,
        auto_archive_duration, archive_timestamp)
     VALUES (?, ?, 11, 'contract-thread', ?, ?, 1, 1440, datetime('now'))`
  ).run(threadId, guildId, channelId, userId)
  db.prepare(
    'INSERT INTO thread_members (thread_id, user_id) VALUES (?, ?)'
  ).run(threadId, userId)
  const joinableThreadId = generateSnowflake()
  const memberThreadId = generateSnowflake()
  db.prepare(
    `INSERT INTO channels
       (id, guild_id, type, name, parent_id, owner_id, archived,
        auto_archive_duration, archive_timestamp)
     VALUES (?, ?, 11, 'joinable-thread', ?, ?, 1, 1440, datetime('now')),
            (?, ?, 11, 'member-thread', ?, ?, 1, 1440, datetime('now'))`
  ).run(
    joinableThreadId,
    guildId,
    channelId,
    userId,
    memberThreadId,
    guildId,
    channelId,
    userId
  )
  db.prepare(
    'INSERT INTO thread_members (thread_id, user_id) VALUES (?, ?)'
  ).run(memberThreadId, memberId)
  const commandId = seedApplicationCommand(db, userId, null, 'contractcmd')
  const guildCommandId = seedApplicationCommand(
    db,
    userId,
    guildId,
    'guildcontractcmd'
  )
  const { interactionId, interactionToken } = seedInteraction(
    db,
    userId,
    channelId,
    memberId,
    guildCommandId
  )
  const {
    interactionId: originalInteractionId,
    interactionToken: originalInteractionToken,
  } = seedInteraction(db, userId, channelId, memberId, guildCommandId)
  db.prepare(
    `UPDATE interactions
     SET responded = 1, initial_response_message_id = ?
     WHERE id = ?`
  ).run(webhookMessageId, originalInteractionId)

  return {
    db,
    token,
    userId,
    bearerToken,
    guildId,
    channelId,
    unindexedChannelId,
    announcementChannelId,
    announcementMessageId,
    voiceChannelId,
    groupDmChannelId,
    messageId,
    deletableMessageId,
    pinnedMessageId,
    reactedMessageId,
    pollMessageId,
    webhookMessageId,
    webhookId,
    webhookToken,
    roleId,
    deletableRoleId,
    assignedRoleId,
    deletableOverwriteId,
    memberId,
    emojiId,
    inviteCode,
    deletableInviteCode,
    bannedUserId,
    banTargetUserId,
    threadId,
    joinableThreadId,
    memberThreadId,
    removableRecipientId,
    commandId,
    guildCommandId,
    interactionId,
    interactionToken,
    originalInteractionId,
    originalInteractionToken,
  }
}
/* eslint-enable @typescript-eslint/no-use-before-define */

/**
 * Starts the production application assembly on an OS-assigned HTTP port.
 * @returns Real server context and deterministic teardown.
 */
/* eslint-disable @typescript-eslint/no-use-before-define -- Lifecycle helpers are grouped immediately below the public factory. */
export async function createRealServer(
  options: RealServerOptions = {}
): Promise<RealServerContext> {
  const uploadPath =
    options.uploadPath ??
    (await mkdtemp(path.join(tmpdir(), 'fauxcord-contract-')))
  let db: Database | undefined
  let unsubscribeGateway: (() => void) | undefined
  let server: ReturnType<typeof serveWithGateway> | undefined
  try {
    db = initializeDatabase(':memory:')
    const database = db
    options.onDatabaseCreated?.(database)
    const wss = new WebSocketServer({ noServer: true })
    let appFetch: Hono['fetch'] = () =>
      Promise.resolve(new Response('Server is starting', { status: 503 }))
    const serve = options.serve ?? serveWithGateway
    const started = await startNodeServer(
      serve,
      {
        fetch: (request, env, executionContext) =>
          appFetch(request, env, executionContext),
        port: 0,
        hostname: '127.0.0.1',
        wss,
      },
      (createdServer) => {
        server = createdServer
      }
    )
    server = started.server
    const baseUrl = `http://127.0.0.1:${started.port}`
    const built = buildApp(database, {
      baseUrl,
      uploadPath,
      disableAuth: false,
      latencyMs: 0,
      wss,
    })
    appFetch = built.app.fetch
    unsubscribeGateway = built.unsubscribeGateway

    let closePromise: Promise<void> | undefined
    return {
      db: database,
      baseUrl,
      sessionManager: built.sessionManager,
      close: () => {
        closePromise ??= runCleanupSteps([
          () => {
            unsubscribeGateway?.()
            unsubscribeGateway = undefined
          },
          () => {
            for (const client of built.wss.clients) client.terminate()
          },
          () => closeNodeServer(server),
          () => {
            closeDatabase(database)
          },
          () => rm(uploadPath, { recursive: true, force: true }),
        ])
        return closePromise
      },
    }
  } catch (error) {
    try {
      await runCleanupSteps([
        () => unsubscribeGateway?.(),
        () => closeNodeServer(server),
        () => {
          if (db) closeDatabase(db)
        },
        () => rm(uploadPath, { recursive: true, force: true }),
      ])
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Real HTTP test server startup and cleanup failed'
      )
    }
    throw error
  }
}
/* eslint-enable @typescript-eslint/no-use-before-define */

async function startNodeServer(
  serve: typeof serveWithGateway,
  options: Parameters<typeof serveWithGateway>[0],
  onServerCreated: (server: ReturnType<typeof serveWithGateway>) => void
): Promise<{ server: ReturnType<typeof serveWithGateway>; port: number }> {
  return new Promise((resolve, reject) => {
    let startedServer: ReturnType<typeof serveWithGateway>
    const handleError = (error: Error) => {
      reject(error)
    }
    try {
      startedServer = serve(options, (address) => {
        startedServer.off('error', handleError)
        resolve({ server: startedServer, port: address.port })
      })
      onServerCreated(startedServer)
      startedServer.once('error', handleError)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

async function closeNodeServer(
  server: ReturnType<typeof serveWithGateway> | undefined
): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error && 'code' in error && error.code === 'ERR_SERVER_NOT_RUNNING') {
        resolve()
      } else if (error) reject(error)
      else resolve()
    })
  })
}

async function runCleanupSteps(
  steps: (() => void | Promise<void>)[]
): Promise<void> {
  const errors: unknown[] = []
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Real HTTP test server cleanup failed')
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
  const db = initializeDatabase(':memory:') // same DB initialization as the existing createTestApp
  const { app, wss, sessionManager, unsubscribeGateway } = buildApp(db, {
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
    db,
    url: `ws://127.0.0.1:${port}`,
    sessionManager,
    close: () => {
      // Always unsubscribe from gatewayBus to prevent listener leaks across
      // repeated createTestGatewayServer() calls in the test suite.
      unsubscribeGateway()
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err)
            return
          }
          closeDatabase(db)
          resolve()
        })
      })
    },
  }
}

/**
 * Registers a Bot token in the DB for testing.
 * @param db - Database
 * @param token - Bot token string (default: "Bot testtoken")
 * @param userId - User ID (default: "111111111111111111")
 * @returns Registered token
 */
export function seedBot(
  db: Database,
  token = 'Bot testtoken',
  userId = '111111111111111111'
): string {
  db.prepare(
    'INSERT OR IGNORE INTO users (id, username, bot) VALUES (?, ?, 1)'
  ).run(userId, 'TestBot')
  db.prepare(
    'INSERT OR IGNORE INTO bots (token, user_id, username) VALUES (?, ?, ?)'
  ).run(token, userId, 'TestBot')
  return token
}

/**
 * Registers a Guild in the DB for testing.
 * @param db - Database
 * @param botToken - Associated Bot token
 * @param guildId - Guild ID (default: "222222222222222222")
 * @returns Registered Guild ID
 */
export function seedGuild(
  db: Database,
  botToken: string,
  guildId = '222222222222222222'
): string {
  const bot = db
    .prepare('SELECT user_id FROM bots WHERE token = ?')
    .get(botToken) as { user_id: string } | undefined
  const ownerId = bot?.user_id ?? '111111111111111111'

  db.prepare(
    'INSERT OR IGNORE INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
  ).run(guildId, 'Test Guild', ownerId, botToken)
  return guildId
}

/**
 * Registers a Channel in the DB for testing.
 * @param db - Database
 * @param guildId - Parent Guild ID
 * @param channelId - Channel ID (default: "333333333333333333")
 * @returns Registered Channel ID
 */
export function seedChannel(
  db: Database,
  guildId: string,
  channelId = '333333333333333333'
): string {
  db.prepare(
    'INSERT OR IGNORE INTO channels (id, guild_id, name, type) VALUES (?, ?, ?, 0)'
  ).run(channelId, guildId, 'general')
  return channelId
}

/**
 * Seeds a voice channel (type 2) into a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param channelId - Channel ID (default: a fixed test ID)
 * @returns The seeded channel's ID
 */
export function seedVoiceChannel(
  db: Database,
  guildId: string,
  channelId = '555555555555555555'
): string {
  db.prepare(
    'INSERT INTO channels (id, guild_id, type, name) VALUES (?, ?, 2, ?)'
  ).run(channelId, guildId, 'voice-channel')
  return channelId
}

/**
 * Seeds an announcement channel (type 5) into a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @param channelId - Channel ID (default: a fixed test ID)
 * @returns The seeded channel's ID
 */
export function seedAnnouncementChannel(
  db: Database,
  guildId: string,
  channelId = '666666666666666666'
): string {
  db.prepare(
    'INSERT INTO channels (id, guild_id, type, name) VALUES (?, ?, 5, ?)'
  ).run(channelId, guildId, 'announcements')
  return channelId
}

/**
 * Seeds a group-DM channel (type 3, no guild).
 * @param db - Database
 * @param channelId - Channel ID (default: a fixed test ID)
 * @returns The seeded channel's ID
 */
export function seedGroupDmChannel(
  db: Database,
  channelId = '777777777777777777'
): string {
  db.prepare(
    'INSERT INTO channels (id, guild_id, type) VALUES (?, NULL, 3)'
  ).run(channelId)
  return channelId
}

/**
 * Inserts a message into the DB for testing.
 * @param db - Database
 * @param channelId - Channel ID
 * @param authorId - Author user ID
 * @param authorToken - Author Bot token (or "webhook" for webhook messages)
 * @param content - Message content
 * @returns Generated message ID
 */
export function seedMessage(
  db: Database,
  channelId: string,
  authorId: string,
  authorToken: string,
  content = 'Test message'
): string {
  const messageId = generateSnowflake()
  db.prepare(
    'INSERT INTO messages (id, channel_id, author_id, author_token, content) VALUES (?, ?, ?, ?, ?)'
  ).run(messageId, channelId, authorId, authorToken, content)
  return messageId
}

/**
 * Inserts a webhook into the DB for testing.
 * @param db - Database
 * @param channelId - Channel ID
 * @param guildId - Guild ID (nullable)
 * @param name - Webhook name
 * @returns Object with webhookId and webhookToken
 */
export function seedWebhook(
  db: Database,
  channelId: string,
  guildId: string | null,
  name = 'Test Webhook'
): { webhookId: string; webhookToken: string } {
  const webhookId = generateSnowflake()
  const webhookToken = `mock_wh_token_${webhookId}`
  db.prepare(
    'INSERT INTO webhooks (id, guild_id, channel_id, name, token) VALUES (?, ?, ?, ?, ?)'
  ).run(webhookId, guildId, channelId, name, webhookToken)
  return { webhookId, webhookToken }
}

/**
 * Inserts a role into the DB for testing.
 * @param db - Database
 * @param guildId - Guild ID
 * @param name - Role name
 * @returns Generated role ID
 */
export function seedRole(
  db: Database,
  guildId: string,
  name = 'test-role'
): string {
  const roleId = generateSnowflake()
  const maxPosition = (
    db
      .prepare(
        'SELECT COALESCE(MAX(position), 0) as pos FROM roles WHERE guild_id = ?'
      )
      .get(guildId) as { pos: number }
  ).pos
  db.prepare(
    'INSERT INTO roles (id, guild_id, name, color, hoist, position, permissions, mentionable) VALUES (?, ?, ?, 0, 0, ?, ?, 0)'
  ).run(roleId, guildId, name, maxPosition + 1, '0')
  return roleId
}

/**
 * Inserts an emoji into the DB for testing.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - Creator user ID (nullable)
 * @param name - Emoji name
 * @returns Generated emoji ID
 */
export function seedEmoji(
  db: Database,
  guildId: string,
  userId: string | null,
  name = 'test_emoji'
): string {
  const emojiId = generateSnowflake()
  db.prepare(
    "INSERT INTO emojis (id, guild_id, name, user_id, roles) VALUES (?, ?, ?, ?, '[]')"
  ).run(emojiId, guildId, name, userId)
  return emojiId
}

/**
 * Inserts an invite into the DB for testing.
 * @param db - Database
 * @param channelId - Channel ID
 * @param guildId - Guild ID (nullable)
 * @param inviterId - Inviter user ID (nullable)
 * @param code - Invite code (default: "testcode")
 * @returns The invite code
 */
export function seedInvite(
  db: Database,
  channelId: string,
  guildId: string | null,
  inviterId: string | null,
  code = 'testcode'
): string {
  // Uses INSERT OR REPLACE (not plain INSERT) so calling this more than once
  // with the default code in the same in-memory DB replaces the row instead
  // of throwing a UNIQUE constraint error, matching the other seed helpers'
  // idempotent style.
  db.prepare(
    'INSERT OR REPLACE INTO invites (code, channel_id, guild_id, inviter_id) VALUES (?, ?, ?, ?)'
  ).run(code, channelId, guildId, inviterId)
  return code
}

/**
 * Registers a second user and adds them as a guild member for testing.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - User ID (auto-generated if omitted)
 * @returns User ID of the registered member
 */
export function seedMember(
  db: Database,
  guildId: string,
  userId?: string
): string {
  const memberId = userId ?? generateSnowflake()
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, 'TestMember', '0', 0)"
  ).run(memberId)
  db.prepare(
    'INSERT OR IGNORE INTO guild_members (guild_id, user_id) VALUES (?, ?)'
  ).run(guildId, memberId)
  return memberId
}

/**
 * Registers a banned user and inserts a guild ban for testing.
 * Also registers the user so ban responses can resolve a full user object.
 * @param db - Database
 * @param guildId - Guild ID
 * @param userId - Banned user ID (auto-generated if omitted)
 * @param reason - Ban reason (default null)
 * @returns User ID of the banned user
 */
export function seedBan(
  db: Database,
  guildId: string,
  userId?: string,
  reason: string | null = null
): string {
  const bannedId = userId ?? generateSnowflake()
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, 'BannedUser', '0', 0)"
  ).run(bannedId)
  db.prepare(
    'INSERT OR IGNORE INTO guild_bans (guild_id, user_id, reason) VALUES (?, ?, ?)'
  ).run(guildId, bannedId, reason)
  return bannedId
}

/**
 * Registers an Application Command for testing.
 * @param db - Database
 * @param applicationId - Application (bot user) ID
 * @param guildId - Guild ID to scope the command to, or `null` for global
 * @param name - Command name (default: "testcommand")
 * @returns Generated command ID
 */
export function seedApplicationCommand(
  db: Database,
  applicationId: string,
  guildId: string | null,
  name = 'testcommand'
): string {
  const result = createCommand(db, applicationId, guildId, {
    name,
    description: 'Test command',
  })
  if (!result.ok) {
    throw new Error(`failed to seed application command: ${result.reason}`)
  }
  return result.command.id
}

/**
 * Registers an Interaction for testing.
 * @param db - Database
 * @param applicationId - Application (bot user) ID
 * @param channelId - Channel ID the interaction occurs in
 * @param userId - Invoking user ID
 * @param commandId - Associated command ID (optional)
 * @returns Generated interactionId and interactionToken
 */
export function seedInteraction(
  db: Database,
  applicationId: string,
  channelId: string,
  userId: string,
  commandId?: string
): { interactionId: string; interactionToken: string } {
  const interactionId = generateSnowflake()
  const interactionToken = `mock_interaction_token_${interactionId}`
  createInteraction(db, {
    interactionId,
    applicationId,
    token: interactionToken,
    type: 2,
    channelId,
    commandId,
    userId,
  })
  return { interactionId, interactionToken }
}

/**
 * Seeds an application with a distinct owning user.
 * @param db - Database
 * @param applicationId - Application ID, generated when omitted
 * @param ownerId - Owner user ID, generated when omitted
 * @returns Seeded application and owner IDs
 */
export function seedApplicationOwner(
  db: Database,
  applicationId = generateSnowflake(),
  ownerId = generateSnowflake()
): { applicationId: string; ownerId: string } {
  db.prepare(
    `INSERT INTO users (id, username, discriminator, bot)
     VALUES (?, 'ApplicationOwner', '0', 0)`
  ).run(ownerId)
  db.prepare(
    `INSERT INTO applications (id, owner_id, name, verify_key)
     VALUES (?, ?, 'Fixture Application', ?)`
  ).run(applicationId, ownerId, `verify_${applicationId}`)
  return { applicationId, ownerId }
}

/**
 * Seeds a local OAuth2 Bearer credential and its user/client principals.
 * @param db - Database
 * @param userId - Credential user ID, generated when omitted
 * @param clientId - OAuth2 client ID, generated when omitted
 * @returns Bearer token and principal IDs
 */
export function seedBearerCredential(
  db: Database,
  userId = generateSnowflake(),
  clientId = generateSnowflake()
): { bearerToken: string; clientId: string; userId: string } {
  const bearerToken = `fixture_bearer_${generateSnowflake()}`
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, discriminator, bot)
     VALUES (?, 'BearerUser', '0', 0)`
  ).run(userId)
  db.prepare(
    `INSERT INTO oauth2_clients (client_id, client_secret)
     VALUES (?, ?)`
  ).run(clientId, `fixture_secret_${clientId}`)
  db.prepare(
    `INSERT INTO oauth2_access_tokens
       (token, client_id, user_id, scope, expires_at)
     VALUES (?, ?, ?, 'identify role_connections.write', datetime('now', '+1 day'))`
  ).run(bearerToken, clientId, userId)
  return { bearerToken, clientId, userId }
}

/**
 * Seeds a distinct non-bot user.
 * @param db - Database
 * @param userId - User ID, generated when omitted
 * @returns Seeded user ID
 */
export function seedSecondUser(
  db: Database,
  userId = generateSnowflake()
): { userId: string } {
  db.prepare(
    `INSERT INTO users (id, username, discriminator, bot)
     VALUES (?, 'SecondUser', '0', 0)`
  ).run(userId)
  return { userId }
}

/**
 * Seeds a lobby and its owner membership.
 * @param db - Database
 * @param applicationId - Parent application ID
 * @param ownerId - Owning user ID
 * @param linkedChannelId - Initially linked channel ID
 * @returns Seeded lobby ID
 */
export function seedLobby(
  db: Database,
  applicationId: string,
  ownerId: string,
  linkedChannelId: string
): { lobbyId: string } {
  const lobbyId = generateSnowflake()
  db.prepare(
    `INSERT INTO lobbies
       (id, application_id, owner_id, linked_channel_id, metadata)
     VALUES (?, ?, ?, ?, '{}')`
  ).run(lobbyId, applicationId, ownerId, linkedChannelId)
  db.prepare(
    `INSERT INTO lobby_members (lobby_id, user_id, metadata)
     VALUES (?, ?, '{}')`
  ).run(lobbyId, ownerId)
  return { lobbyId }
}

/**
 * Seeds a stage channel without creating a stage instance.
 * @param db - Database
 * @param guildId - Parent guild ID
 * @returns Seeded stage channel ID
 */
export function seedStageChannel(
  db: Database,
  guildId: string
): { stageChannelId: string } {
  const stageChannelId = generateSnowflake()
  db.prepare(
    `INSERT INTO channels (id, guild_id, type, name)
     VALUES (?, ?, 13, 'fixture-stage')`
  ).run(stageChannelId, guildId)
  return { stageChannelId }
}

/**
 * Seeds a SKU and one active subscription for a user.
 * @param db - Database
 * @param applicationId - Parent application ID
 * @param userId - Subscriber user ID
 * @returns Seeded SKU and subscription IDs
 */
export function seedSkuSubscription(
  db: Database,
  applicationId: string,
  userId: string
): { skuId: string; subscriptionId: string } {
  const skuId = generateSnowflake()
  const subscriptionId = generateSnowflake()
  db.prepare(
    `INSERT INTO skus (id, application_id, name, slug)
     VALUES (?, ?, 'Fixture Subscription', ?)`
  ).run(skuId, applicationId, `fixture-subscription-${skuId}`)
  db.prepare(
    `INSERT INTO subscriptions
       (id, sku_id, user_id, sku_ids, entitlement_ids,
        current_period_start, current_period_end, status)
     VALUES (?, ?, ?, ?, '[]', '2030-01-01T00:00:00.000Z',
             '2030-02-01T00:00:00.000Z', 0)`
  ).run(subscriptionId, skuId, userId, JSON.stringify([skuId]))
  return { skuId, subscriptionId }
}

/**
 * Seeds a guild template.
 * @param db - Database
 * @param guildId - Source guild ID
 * @param creatorId - Template creator user ID
 * @returns Seeded template code
 */
export function seedGuildTemplate(
  db: Database,
  guildId: string,
  creatorId: string
): { templateCode: string } {
  const templateCode = `fixture-${generateSnowflake()}`
  const guild = db
    .prepare('SELECT name FROM guilds WHERE id = ?')
    .get(guildId) as { name: string } | undefined
  db.prepare(
    `INSERT INTO guild_templates
       (code, source_guild_id, creator_id, name, serialized_source_guild)
     VALUES (?, ?, ?, 'Fixture Template', ?)`
  ).run(
    templateCode,
    guildId,
    creatorId,
    JSON.stringify({ id: guildId, name: guild?.name ?? 'Fixture Guild' })
  )
  return { templateCode }
}

/**
 * Seeds a scheduled voice event.
 * @param db - Database
 * @param guildId - Parent guild ID
 * @param creatorId - Creator user ID
 * @param channelId - Event voice or stage channel ID
 * @returns Seeded event ID
 */
export function seedScheduledEvent(
  db: Database,
  guildId: string,
  creatorId: string,
  channelId: string
): { eventId: string } {
  const eventId = generateSnowflake()
  db.prepare(
    `INSERT INTO scheduled_events
       (id, guild_id, channel_id, creator_id, name, scheduled_start_time,
        privacy_level, status, entity_type)
     VALUES (?, ?, ?, ?, 'Fixture Event', '2030-01-01T00:00:00.000Z', 2, 1, 2)`
  ).run(eventId, guildId, channelId, creatorId)
  return { eventId }
}

/**
 * Seeds an interaction response addressed by the webhook `@original` route.
 * @param db - Database
 * @param applicationId - Interaction application ID used as the webhook ID
 * @param channelId - Destination channel ID
 * @param userId - Interaction user and response author ID
 * @returns Webhook credentials and original message ID
 */
export function seedWebhookOriginalMessage(
  db: Database,
  applicationId: string,
  channelId: string,
  userId: string
): {
  interactionId: string
  originalMessageId: string
  webhookId: string
  webhookToken: string
} {
  const { interactionId, interactionToken } = seedInteraction(
    db,
    applicationId,
    channelId,
    userId
  )
  const originalMessageId = seedMessage(
    db,
    channelId,
    userId,
    'interaction',
    'Original interaction response'
  )
  db.prepare(
    `UPDATE interactions
     SET responded = 1, initial_response_message_id = ?
     WHERE id = ?`
  ).run(originalMessageId, interactionId)
  return {
    interactionId,
    originalMessageId,
    webhookId: applicationId,
    webhookToken: interactionToken,
  }
}

/**
 * Creates a disposable upload fixture in its own temporary directory.
 * @param content - UTF-8 fixture file contents
 * @returns File paths and an idempotent cleanup function
 */
export async function seedDisposableUploadedFile(
  content = 'fixture upload'
): Promise<{
  cleanup: () => Promise<void>
  filePath: string
  filename: string
  uploadDirectory: string
}> {
  const uploadDirectory = await mkdtemp(
    path.join(tmpdir(), 'fauxcord-upload-fixture-')
  )
  const filename = 'fixture.txt'
  const filePath = path.join(uploadDirectory, filename)
  await writeFile(filePath, content, 'utf8')
  return {
    cleanup: () => rm(uploadDirectory, { recursive: true, force: true }),
    filePath,
    filename,
    uploadDirectory,
  }
}
