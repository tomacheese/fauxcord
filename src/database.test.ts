import { describe, it, expect, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase } from './database'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('initializeDatabase', () => {
  let database: Database.Database

  afterEach(() => {
    closeDatabase(database)
  })

  it('initializes an in-memory database', () => {
    database = initializeDatabase(':memory:')
    expect(database).toBeDefined()
  })

  it('sets journal_mode (in-memory DB uses memory mode)', () => {
    database = initializeDatabase(':memory:')
    const result = database.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string
    }
    // In-memory DB does not support WAL, so it falls back to memory mode
    expect(['wal', 'memory']).toContain(result.journal_mode)
  })

  it('enables foreign key constraints', () => {
    database = initializeDatabase(':memory:')
    const result = database.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number
    }
    expect(result.foreign_keys).toBe(1)
  })

  it('creates all expected tables', () => {
    database = initializeDatabase(':memory:')
    const tables = database
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
    database = initializeDatabase(':memory:')
    const info = database.prepare('PRAGMA table_info(bots)').all() as {
      name: string
    }[]
    const columnNames = info.map((c) => c.name)
    expect(columnNames).toContain('token')
    expect(columnNames).toContain('user_id')
    expect(columnNames).toContain('username')
  })

  it('migrates thread columns onto a legacy channels table that predates thread support', () => {
    // Simulate a database file created before thread support: a `channels`
    // table without any of the thread-related columns.
    const direction = mkdtempSync(path.join(tmpdir(), 'fauxcord-db-'))
    const databasePath = path.join(direction, 'legacy.db')
    try {
      const legacy = new BetterSqlite3(databasePath)
      legacy.exec(`
        CREATE TABLE channels (
          id       TEXT PRIMARY KEY,
          guild_id TEXT,
          type     INTEGER NOT NULL DEFAULT 0,
          name     TEXT
        );
      `)
      legacy.close()

      // Reopening through initializeDatabase must add the missing columns.
      database = initializeDatabase(databasePath)
      const columnNames = (
        database.prepare('PRAGMA table_info(channels)').all() as {
          name: string
        }[]
      ).map((c) => c.name)

      for (const column of [
        'owner_id',
        'archived',
        'auto_archive_duration',
        'locked',
        'invitable',
        'archive_timestamp',
      ]) {
        expect(columnNames).toContain(column)
      }
    } finally {
      rmSync(direction, { recursive: true, force: true })
    }
  })
})
