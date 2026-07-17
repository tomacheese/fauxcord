import { describe, it, expect, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase } from './db'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

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

  it('migrates thread columns onto a legacy channels table that predates thread support', () => {
    // Simulate a database file created before thread support: a `channels`
    // table without any of the thread-related columns.
    const dir = mkdtempSync(path.join(tmpdir(), 'fauxcord-db-'))
    const dbPath = path.join(dir, 'legacy.db')
    try {
      const legacy = new BetterSqlite3(dbPath)
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
      db = initializeDatabase(dbPath)
      const columnNames = (
        db.prepare('PRAGMA table_info(channels)').all() as { name: string }[]
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
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates the voice_status column and poll/recipient tables', () => {
    const db = initializeDatabase(':memory:')

    const channelCols = (
      db.prepare('PRAGMA table_info(channels)').all() as { name: string }[]
    ).map((c) => c.name)
    expect(channelCols).toContain('voice_status')

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((t) => t.name)
    expect(tables).toContain('channel_recipients')
    expect(tables).toContain('polls')
    expect(tables).toContain('poll_answers')
    expect(tables).toContain('poll_votes')

    db.close()
  })
})

describe('application commands / interactions tables', () => {
  it('creates the application_commands table', () => {
    const db = initializeDatabase(':memory:')
    const columns = db
      .prepare('PRAGMA table_info(application_commands)')
      .all() as { name: string }[]
    const names = columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'application_id',
        'guild_id',
        'type',
        'name',
        'description',
        'options',
        'default_member_permissions',
        'dm_permission',
        'nsfw',
        'version',
        'created_at',
      ])
    )
    db.close()
  })

  it('creates the application_command_permissions table', () => {
    const db = initializeDatabase(':memory:')
    const columns = db
      .prepare('PRAGMA table_info(application_command_permissions)')
      .all() as { name: string }[]
    const names = columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'application_id',
        'guild_id',
        'command_id',
        'permissions',
        'created_at',
      ])
    )
    db.close()
  })

  it('creates the interactions table', () => {
    const db = initializeDatabase(':memory:')
    const columns = db.prepare('PRAGMA table_info(interactions)').all() as {
      name: string
    }[]
    const names = columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'application_id',
        'token',
        'type',
        'guild_id',
        'channel_id',
        'command_id',
        'data',
        'user_id',
        'member_json',
        'responded',
        'initial_response_message_id',
        'created_at',
      ])
    )
    db.close()
  })

  it('enforces UNIQUE(application_id, guild_id, type, name) on application_commands', () => {
    const db = initializeDatabase(':memory:')
    db.prepare(
      `INSERT INTO application_commands (id, application_id, type, name, version)
       VALUES ('1', 'app1', 1, 'ping', 'v1')`
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO application_commands (id, application_id, type, name, version)
           VALUES ('2', 'app1', 1, 'ping', 'v1')`
        )
        .run()
    ).toThrow()
    db.close()
  })
})
