import { describe, it, expect, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase } from './db.js'
import type Database from 'better-sqlite3'

describe('initializeDatabase', () => {
  let db: Database.Database

  afterEach(() => {
    closeDatabase(db)
  })

  it('インメモリDBを初期化できること', () => {
    db = initializeDatabase(':memory:')
    expect(db).toBeDefined()
  })

  it('journal_modeがセットされていること（インメモリDBはmemory）', () => {
    db = initializeDatabase(':memory:')
    const result = db.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string
    }
    // インメモリDBはWALをサポートしないためmemoryモードになる
    expect(['wal', 'memory']).toContain(result.journal_mode)
  })

  it('外部キー制約が有効になっていること', () => {
    db = initializeDatabase(':memory:')
    const result = db.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number
    }
    expect(result.foreign_keys).toBe(1)
  })

  it('全テーブルが作成されていること', () => {
    db = initializeDatabase(':memory:')
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[]
    const tableNames = tables.map((t) => t.name)

    const expectedTables = [
      'attachments',
      'bots',
      'channels',
      'embeds',
      'guild_members',
      'guilds',
      'messages',
      'oauth2_access_tokens',
      'oauth2_auth_codes',
      'oauth2_clients',
      'pins',
      'reactions',
      'roles',
      'users',
      'webhooks',
    ]

    for (const table of expectedTables) {
      expect(tableNames).toContain(table)
    }
  })

  it('botsテーブルに正しいスキーマがあること', () => {
    db = initializeDatabase(':memory:')
    const info = db.prepare('PRAGMA table_info(bots)').all() as {
      name: string
    }[]
    const columnNames = info.map((c) => c.name)
    expect(columnNames).toContain('token')
    expect(columnNames).toContain('user_id')
    expect(columnNames).toContain('username')
  })
})
