import { describe, it, expect, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase } from './db.js'
import type Database from 'better-sqlite3'

describe('initializeDatabase', () => {
  let db: Database.Database

  afterEach(() => {
    closeDatabase(db)
  })

  it('initializes an in-memory database', () => {
    db = initializeDatabase(':memory:')
    expect(db).toBeDefined()
  })

  it('sets journal_mode (in-memory DB uses memory mode)', () => {
    db = initializeDatabase(':memory:')
    const result = db.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string
    }
    // In-memory DB does not support WAL, so it falls back to memory mode
    expect(['wal', 'memory']).toContain(result.journal_mode)
  })

  it('enables foreign key constraints', () => {
    db = initializeDatabase(':memory:')
    const result = db.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number
    }
    expect(result.foreign_keys).toBe(1)
  })

  it('creates all expected tables', () => {
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

  it('bots table has the correct schema', () => {
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
