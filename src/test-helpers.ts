/**
 * テスト用ヘルパー関数
 *
 * Hono アプリのテストを簡易化するユーティリティを提供します。
 */

import { Hono } from 'hono'
import { initializeDatabase, closeDatabase } from './db.js'
import type { Database } from './db.js'

/** テスト用のDB・Appペア */
export interface TestContext {
  db: Database
  app: Hono
  cleanup: () => void
}

/**
 * テスト用のHonoアプリとインメモリDBを作成します。
 * @returns テストコンテキスト
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
 * テスト用のBotトークンをDBに登録します。
 * @param db - データベース
 * @param token - Botトークン文字列（デフォルト: "Bot testtoken"）
 * @param userId - ユーザーID（デフォルト: "111111111111111111"）
 * @returns 登録したトークン
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
 * テスト用のGuildをDBに登録します。
 * @param db - データベース
 * @param botToken - 関連するBotトークン
 * @param guildId - Guild ID（デフォルト: "222222222222222222"）
 * @returns 登録したGuild ID
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
 * テスト用のChannelをDBに登録します。
 * @param db - データベース
 * @param guildId - 所属Guild ID
 * @param channelId - Channel ID（デフォルト: "333333333333333333"）
 * @returns 登録したChannel ID
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
