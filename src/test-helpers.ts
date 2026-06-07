/**
 * Test helper functions
 *
 * Provides utilities to simplify testing Hono apps.
 */

import { Hono } from 'hono'
import { initializeDatabase, closeDatabase } from './db.js'
import type { Database } from './db.js'

/** DB/App pair for testing */
export interface TestContext {
  db: Database
  app: Hono
  cleanup: () => void
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
