import { describe, it, expect, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase, runInTransaction } from './db'
import * as testHelpers from './test-helpers'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DOMAIN_TABLE_COLUMNS: Record<string, string[]> = {
  applications: [
    'id',
    'owner_id',
    'name',
    'description',
    'verify_key',
    'flags',
  ],
  application_emojis: ['id', 'application_id', 'name', 'user_id'],
  entitlements: [
    'id',
    'application_id',
    'sku_id',
    'user_id',
    'guild_id',
    'consumed',
  ],
  entitlement_consumptions: ['entitlement_id', 'consumed_at'],
  application_role_connection_metadata: [
    'application_id',
    'key',
    'type',
    'name',
    'description',
  ],
  user_application_role_connections: [
    'application_id',
    'user_id',
    'platform_name',
    'metadata',
  ],
  auto_moderation_rules: [
    'id',
    'guild_id',
    'creator_id',
    'trigger_metadata',
    'actions',
  ],
  scheduled_events: [
    'id',
    'guild_id',
    'channel_id',
    'creator_id',
    'scheduled_start_time',
    'entity_metadata',
  ],
  scheduled_event_exceptions: [
    'id',
    'event_id',
    'scheduled_start_time',
    'is_canceled',
  ],
  scheduled_event_users: ['event_id', 'user_id'],
  scheduled_event_exception_users: ['exception_id', 'user_id'],
  soundboard_sounds: ['id', 'guild_id', 'user_id', 'name', 'volume'],
  sticker_packs: ['id', 'sku_id', 'name', 'cover_sticker_id'],
  stickers: ['id', 'guild_id', 'user_id', 'name', 'tags'],
  guild_templates: ['code', 'source_guild_id', 'creator_id', 'name'],
  stage_instances: ['id', 'guild_id', 'channel_id', 'topic'],
  lobbies: [
    'id',
    'application_id',
    'owner_id',
    'linked_channel_id',
    'metadata',
  ],
  lobby_members: ['lobby_id', 'user_id', 'metadata', 'flags'],
  lobby_messages: [
    'id',
    'lobby_id',
    'author_id',
    'content',
    'moderation_metadata',
  ],
  skus: ['id', 'application_id', 'name'],
  subscriptions: [
    'id',
    'sku_id',
    'user_id',
    'entitlement_ids',
    'current_period_start',
    'status',
  ],
  guild_voice_states: ['guild_id', 'user_id', 'channel_id', 'session_id'],
  guild_onboarding_settings: ['guild_id', 'prompts', 'default_channel_ids'],
  guild_widget_settings: ['guild_id', 'enabled', 'channel_id'],
  guild_welcome_screen_settings: ['guild_id', 'description', 'channels'],
  guild_presentation_settings: [
    'guild_id',
    'vanity_url_code',
    'description',
    'features',
  ],
}

const DOMAIN_INDEXES = [
  'idx_applications_owner',
  'idx_application_emojis_application',
  'idx_entitlements_application',
  'idx_entitlements_owner_user',
  'idx_automod_rules_guild',
  'idx_scheduled_events_guild',
  'idx_scheduled_event_exceptions_event',
  'idx_soundboard_sounds_guild',
  'idx_sticker_packs_sku',
  'idx_stickers_guild',
  'idx_guild_templates_source',
  'idx_stage_instances_guild',
  'idx_lobbies_application',
  'idx_lobby_members_user',
  'idx_lobby_messages_lobby',
  'idx_subscriptions_sku',
  'idx_guild_voice_states_channel',
]

const DOMAIN_FOREIGN_KEYS: Record<
  string,
  { from: string; on_delete: string; table: string }[]
> = {
  applications: [{ from: 'owner_id', on_delete: 'CASCADE', table: 'users' }],
  skus: [
    { from: 'application_id', on_delete: 'CASCADE', table: 'applications' },
  ],
  application_emojis: [
    { from: 'application_id', on_delete: 'CASCADE', table: 'applications' },
    { from: 'user_id', on_delete: 'SET NULL', table: 'users' },
  ],
  entitlements: [
    { from: 'sku_id', on_delete: 'CASCADE', table: 'skus' },
    { from: 'application_id', on_delete: 'CASCADE', table: 'applications' },
    { from: 'user_id', on_delete: 'CASCADE', table: 'users' },
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
  ],
  entitlement_consumptions: [
    { from: 'entitlement_id', on_delete: 'CASCADE', table: 'entitlements' },
  ],
  application_role_connection_metadata: [
    { from: 'application_id', on_delete: 'CASCADE', table: 'applications' },
  ],
  user_application_role_connections: [
    { from: 'application_id', on_delete: 'CASCADE', table: 'applications' },
    { from: 'user_id', on_delete: 'CASCADE', table: 'users' },
  ],
  auto_moderation_rules: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
  ],
  scheduled_events: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
    { from: 'channel_id', on_delete: 'CASCADE', table: 'channels' },
  ],
  scheduled_event_exceptions: [
    { from: 'event_id', on_delete: 'CASCADE', table: 'scheduled_events' },
  ],
  scheduled_event_users: [
    { from: 'event_id', on_delete: 'CASCADE', table: 'scheduled_events' },
    { from: 'user_id', on_delete: 'CASCADE', table: 'users' },
  ],
  scheduled_event_exception_users: [
    {
      from: 'exception_id',
      on_delete: 'CASCADE',
      table: 'scheduled_event_exceptions',
    },
    { from: 'user_id', on_delete: 'CASCADE', table: 'users' },
  ],
  soundboard_sounds: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
  ],
  sticker_packs: [
    { from: 'sku_id', on_delete: 'CASCADE', table: 'skus' },
    { from: 'cover_sticker_id', on_delete: 'SET NULL', table: 'stickers' },
  ],
  stickers: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
    { from: 'application_id', on_delete: 'CASCADE', table: 'applications' },
    { from: 'pack_id', on_delete: 'CASCADE', table: 'sticker_packs' },
  ],
  guild_templates: [
    { from: 'source_guild_id', on_delete: 'CASCADE', table: 'guilds' },
    { from: 'creator_id', on_delete: 'CASCADE', table: 'users' },
  ],
  stage_instances: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
    { from: 'channel_id', on_delete: 'CASCADE', table: 'channels' },
  ],
  lobbies: [
    { from: 'application_id', on_delete: 'CASCADE', table: 'applications' },
    { from: 'owner_id', on_delete: 'CASCADE', table: 'users' },
    { from: 'linked_channel_id', on_delete: 'SET NULL', table: 'channels' },
  ],
  lobby_members: [
    { from: 'lobby_id', on_delete: 'CASCADE', table: 'lobbies' },
    { from: 'user_id', on_delete: 'CASCADE', table: 'users' },
  ],
  lobby_messages: [
    { from: 'lobby_id', on_delete: 'CASCADE', table: 'lobbies' },
    { from: 'channel_id', on_delete: 'CASCADE', table: 'channels' },
    { from: 'author_id', on_delete: 'CASCADE', table: 'users' },
    { from: 'application_id', on_delete: 'CASCADE', table: 'applications' },
  ],
  subscriptions: [
    { from: 'sku_id', on_delete: 'CASCADE', table: 'skus' },
    { from: 'user_id', on_delete: 'CASCADE', table: 'users' },
  ],
  guild_voice_states: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
    { from: 'user_id', on_delete: 'CASCADE', table: 'users' },
    { from: 'channel_id', on_delete: 'CASCADE', table: 'channels' },
  ],
  guild_onboarding_settings: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
  ],
  guild_widget_settings: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
    { from: 'channel_id', on_delete: 'SET NULL', table: 'channels' },
  ],
  guild_welcome_screen_settings: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
  ],
  guild_presentation_settings: [
    { from: 'guild_id', on_delete: 'CASCADE', table: 'guilds' },
  ],
}

function expectDomainSchema(db: Database.Database): void {
  for (const [table, expectedColumns] of Object.entries(DOMAIN_TABLE_COLUMNS)) {
    const columns = (
      db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    ).map(({ name }) => name)
    expect(columns, `${table} columns`).toEqual(
      expect.arrayContaining(expectedColumns)
    )
  }

  const indexes = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
      name: string
    }[]
  ).map(({ name }) => name)
  expect(indexes).toEqual(expect.arrayContaining(DOMAIN_INDEXES))

  for (const [table, expectedForeignKeys] of Object.entries(
    DOMAIN_FOREIGN_KEYS
  )) {
    const foreignKeys = db
      .prepare(`PRAGMA foreign_key_list(${table})`)
      .all() as { table: string; from: string; on_delete: string }[]
    for (const expectedForeignKey of expectedForeignKeys) {
      expect(foreignKeys, `${table}.${expectedForeignKey.from}`).toContainEqual(
        expect.objectContaining(expectedForeignKey)
      )
    }
  }
}

function seedDomainRoots(db: Database.Database): {
  applicationId: string
  channelId: string
  guildId: string
  ownerId: string
  skuId: string
  userId: string
} {
  const ownerId = 'domain-owner'
  const userId = 'domain-member'
  const guildId = 'domain-guild'
  const channelId = 'domain-channel'
  const applicationId = 'domain-application'
  const skuId = 'domain-sku'
  db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(
    ownerId,
    'Owner'
  )
  db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(
    userId,
    'Member'
  )
  db.prepare(
    'INSERT INTO bots (token, user_id, username) VALUES (?, ?, ?)'
  ).run('Bot domain', ownerId, 'OwnerBot')
  db.prepare(
    'INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
  ).run(guildId, 'Domain Guild', ownerId, 'Bot domain')
  db.prepare('INSERT INTO channels (id, guild_id, name) VALUES (?, ?, ?)').run(
    channelId,
    guildId,
    'domain'
  )
  db.prepare(
    `INSERT INTO applications (id, owner_id, name, verify_key)
     VALUES (?, ?, ?, ?)`
  ).run(applicationId, ownerId, 'Domain App', 'verify-key')
  db.prepare(
    'INSERT INTO skus (id, application_id, name, slug) VALUES (?, ?, ?, ?)'
  ).run(skuId, applicationId, 'Domain SKU', 'domain-sku')
  return { applicationId, channelId, guildId, ownerId, skuId, userId }
}

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

describe('full Discord v10 persistence migration', () => {
  it('creates every domain table, column, index, and foreign key in a fresh database', () => {
    const db = initializeDatabase(':memory:')

    expectDomainSchema(db)

    db.close()
  })

  it('adds the domain schema while preserving a database from the previous schema', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fauxcord-legacy-domain-'))
    const dbPath = path.join(dir, 'legacy.db')
    try {
      const legacy = new BetterSqlite3(dbPath)
      legacy.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE bots (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL DEFAULT 'MockBot',
          discriminator TEXT NOT NULL DEFAULT '0',
          bot INTEGER NOT NULL DEFAULT 1,
          avatar TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          discriminator TEXT NOT NULL DEFAULT '0',
          avatar TEXT,
          bot INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE guilds (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT,
          owner_id TEXT NOT NULL,
          bot_token TEXT NOT NULL REFERENCES bots(token) ON DELETE CASCADE,
          verification_level INTEGER NOT NULL DEFAULT 0,
          default_message_notifications INTEGER NOT NULL DEFAULT 0,
          explicit_content_filter INTEGER NOT NULL DEFAULT 0,
          premium_tier INTEGER NOT NULL DEFAULT 0,
          preferred_locale TEXT NOT NULL DEFAULT 'en-US',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE channels (
          id TEXT PRIMARY KEY,
          guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
          type INTEGER NOT NULL DEFAULT 0,
          name TEXT
        );
        INSERT INTO users (id, username) VALUES ('legacy-owner', 'Legacy');
        INSERT INTO bots (token, user_id) VALUES ('Bot legacy', 'legacy-owner');
        INSERT INTO guilds (id, name, owner_id, bot_token)
          VALUES ('legacy-guild', 'Legacy Guild', 'legacy-owner', 'Bot legacy');
        INSERT INTO channels (id, guild_id, name)
          VALUES ('legacy-channel', 'legacy-guild', 'general');
      `)
      legacy.close()

      const migrated = initializeDatabase(dbPath)
      expectDomainSchema(migrated)
      expect(
        migrated
          .prepare('SELECT name FROM channels WHERE id = ?')
          .pluck()
          .get('legacy-channel')
      ).toBe('general')
      migrated.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('domain transactions', () => {
  it('creates related resources atomically', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, ownerId } = seedDomainRoots(db)
    runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO application_emojis
           (id, application_id, name, user_id)
         VALUES ('created-emoji', ?, 'created', ?)`
      ).run(applicationId, ownerId)
      db.prepare(
        `INSERT INTO application_role_connection_metadata
           (application_id, key, type, name, description)
         VALUES (?, 'score', 2, 'Score', 'Player score')`
      ).run(applicationId)
    })

    expect(
      db.prepare('SELECT COUNT(*) FROM application_emojis').pluck().get()
    ).toBe(1)
    expect(
      db
        .prepare('SELECT COUNT(*) FROM application_role_connection_metadata')
        .pluck()
        .get()
    ).toBe(1)
    db.close()
  })

  it('rolls back an update when a later write fails', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId } = seedDomainRoots(db)
    expect(() => {
      runInTransaction(db, () => {
        db.prepare('UPDATE applications SET name = ? WHERE id = ?').run(
          'Changed',
          applicationId
        )
        db.prepare(
          `INSERT INTO application_emojis (id, application_id, name)
           VALUES ('invalid', 'missing-application', 'invalid')`
        ).run()
      })
    }).toThrow()
    expect(
      db
        .prepare('SELECT name FROM applications WHERE id = ?')
        .pluck()
        .get(applicationId)
    ).toBe('Domain App')
    db.close()
  })

  it('deletes an event and its exceptions in one transaction', () => {
    const db = initializeDatabase(':memory:')
    const { guildId, ownerId } = seedDomainRoots(db)
    db.prepare(
      `INSERT INTO scheduled_events
         (id, guild_id, creator_id, name, scheduled_start_time, entity_type)
       VALUES ('event-delete', ?, ?, 'Delete me', '2030-01-01T00:00:00Z', 3)`
    ).run(guildId, ownerId)
    db.prepare(
      `INSERT INTO scheduled_event_exceptions (id, event_id)
       VALUES ('exception-delete', 'event-delete')`
    ).run()

    runInTransaction(db, () => {
      db.prepare('DELETE FROM scheduled_events WHERE id = ?').run(
        'event-delete'
      )
    })

    expect(
      db
        .prepare('SELECT COUNT(*) FROM scheduled_event_exceptions')
        .pluck()
        .get()
    ).toBe(0)
    db.close()
  })

  it('records entitlement consumption atomically', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, skuId, userId } = seedDomainRoots(db)
    db.prepare(
      `INSERT INTO entitlements
         (id, sku_id, application_id, user_id)
       VALUES ('entitlement-consume', ?, ?, ?)`
    ).run(skuId, applicationId, userId)

    runInTransaction(db, () => {
      db.prepare(
        'UPDATE entitlements SET consumed = 1 WHERE id = ? AND consumed = 0'
      ).run('entitlement-consume')
      db.prepare(
        'INSERT INTO entitlement_consumptions (entitlement_id) VALUES (?)'
      ).run('entitlement-consume')
    })

    expect(
      db
        .prepare('SELECT consumed FROM entitlements WHERE id = ?')
        .pluck()
        .get('entitlement-consume')
    ).toBe(1)
    expect(
      db.prepare('SELECT COUNT(*) FROM entitlement_consumptions').pluck().get()
    ).toBe(1)
    db.close()
  })

  it('joins a lobby with its first message atomically', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, channelId, ownerId, userId } = seedDomainRoots(db)
    db.prepare(
      `INSERT INTO lobbies (id, application_id, owner_id, linked_channel_id)
       VALUES ('lobby-join', ?, ?, ?)`
    ).run(applicationId, ownerId, channelId)

    runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO lobby_members (lobby_id, user_id)
         VALUES ('lobby-join', ?)`
      ).run(userId)
      db.prepare(
        `INSERT INTO lobby_messages
           (id, lobby_id, channel_id, author_id, application_id, content)
         VALUES ('lobby-message', 'lobby-join', ?, ?, ?, 'joined')`
      ).run(channelId, userId, applicationId)
    })

    expect(db.prepare('SELECT COUNT(*) FROM lobby_members').pluck().get()).toBe(
      1
    )
    expect(
      db.prepare('SELECT COUNT(*) FROM lobby_messages').pluck().get()
    ).toBe(1)
    db.close()
  })

  it('removes a lobby member and their messages atomically', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, channelId, ownerId, userId } = seedDomainRoots(db)
    db.prepare(
      `INSERT INTO lobbies (id, application_id, owner_id, linked_channel_id)
       VALUES ('lobby-leave', ?, ?, ?)`
    ).run(applicationId, ownerId, channelId)
    db.prepare(
      `INSERT INTO lobby_members (lobby_id, user_id)
       VALUES ('lobby-leave', ?)`
    ).run(userId)
    db.prepare(
      `INSERT INTO lobby_messages
         (id, lobby_id, channel_id, author_id, application_id, content)
       VALUES ('leaving-message', 'lobby-leave', ?, ?, ?, 'leaving')`
    ).run(channelId, userId, applicationId)

    runInTransaction(db, () => {
      db.prepare(
        'DELETE FROM lobby_messages WHERE lobby_id = ? AND author_id = ?'
      ).run('lobby-leave', userId)
      db.prepare(
        'DELETE FROM lobby_members WHERE lobby_id = ? AND user_id = ?'
      ).run('lobby-leave', userId)
    })

    expect(db.prepare('SELECT COUNT(*) FROM lobby_members').pluck().get()).toBe(
      0
    )
    expect(
      db.prepare('SELECT COUNT(*) FROM lobby_messages').pluck().get()
    ).toBe(0)
    db.close()
  })

  it('rejects asynchronous callbacks before committing their writes', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId } = seedDomainRoots(db)
    const asynchronousOperation = async () => {
      db.prepare(
        `INSERT INTO application_emojis (id, application_id, name)
         VALUES ('async-emoji', ?, 'async')`
      ).run(applicationId)
      await Promise.resolve()
      return 1
    }

    expect(() =>
      runInTransaction(db, asynchronousOperation as unknown as () => number)
    ).toThrow('Transaction operation must be synchronous')
    expect(
      db.prepare('SELECT COUNT(*) FROM application_emojis').pluck().get()
    ).toBe(0)
    db.close()
  })
})

describe('domain foreign-key cascades', () => {
  it('removes application-owned and owner-owned state with the application owner', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, channelId, guildId, ownerId, skuId, userId } =
      seedDomainRoots(db)
    db.prepare(
      `INSERT INTO application_emojis (id, application_id, name, user_id)
       VALUES ('cascade-emoji', ?, 'cascade', ?)`
    ).run(applicationId, ownerId)
    db.prepare(
      `INSERT INTO entitlements (id, sku_id, application_id, user_id)
       VALUES ('cascade-entitlement', ?, ?, ?)`
    ).run(skuId, applicationId, userId)
    db.prepare(
      `INSERT INTO lobbies (id, application_id, owner_id, linked_channel_id)
       VALUES ('cascade-lobby', ?, ?, ?)`
    ).run(applicationId, ownerId, channelId)
    db.prepare(
      `INSERT INTO lobby_members (lobby_id, user_id)
       VALUES ('cascade-lobby', ?)`
    ).run(userId)
    db.prepare(
      `INSERT INTO application_commands
         (id, application_id, guild_id, name, version)
       VALUES ('cascade-command', ?, ?, 'cascade', '1')`
    ).run(applicationId, guildId)
    db.prepare(
      `INSERT INTO application_command_permissions
         (application_id, guild_id, command_id)
       VALUES (?, ?, 'cascade-command')`
    ).run(applicationId, guildId)
    db.prepare(
      `INSERT INTO interactions
         (id, application_id, token, type, user_id)
       VALUES ('cascade-interaction', ?, 'cascade-token', 2, ?)`
    ).run(applicationId, userId)

    db.prepare('DELETE FROM users WHERE id = ?').run(ownerId)

    for (const table of [
      'applications',
      'application_emojis',
      'entitlements',
      'skus',
      'lobbies',
      'lobby_members',
      'application_commands',
      'application_command_permissions',
      'interactions',
    ]) {
      expect(
        db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get(),
        table
      ).toBe(0)
    }
    db.close()
  })

  it('removes guild-owned state when its guild is deleted', () => {
    const db = initializeDatabase(':memory:')
    const { guildId, ownerId } = seedDomainRoots(db)
    db.prepare(
      `INSERT INTO auto_moderation_rules
         (id, guild_id, creator_id, name, event_type, trigger_type)
       VALUES ('cascade-rule', ?, ?, 'Rule', 1, 1)`
    ).run(guildId, ownerId)
    db.prepare(
      `INSERT INTO scheduled_events
         (id, guild_id, creator_id, name, scheduled_start_time, entity_type)
       VALUES ('cascade-event', ?, ?, 'Event', '2030-01-01T00:00:00Z', 3)`
    ).run(guildId, ownerId)
    db.prepare(
      `INSERT INTO soundboard_sounds (id, guild_id, user_id, name)
       VALUES ('cascade-sound', ?, ?, 'Sound')`
    ).run(guildId, ownerId)
    db.prepare(
      `INSERT INTO stickers (id, guild_id, user_id, name, tags)
       VALUES ('cascade-sticker', ?, ?, 'Sticker', 'tag')`
    ).run(guildId, ownerId)
    db.prepare(
      `INSERT INTO guild_templates (code, source_guild_id, creator_id, name)
       VALUES ('cascade-template', ?, ?, 'Template')`
    ).run(guildId, ownerId)
    db.prepare(
      `INSERT INTO guild_onboarding_settings (guild_id) VALUES (?)`
    ).run(guildId)
    db.prepare(`INSERT INTO guild_widget_settings (guild_id) VALUES (?)`).run(
      guildId
    )
    db.prepare(
      `INSERT INTO guild_welcome_screen_settings (guild_id) VALUES (?)`
    ).run(guildId)
    db.prepare(
      `INSERT INTO guild_presentation_settings (guild_id) VALUES (?)`
    ).run(guildId)

    db.prepare('DELETE FROM guilds WHERE id = ?').run(guildId)

    for (const table of [
      'auto_moderation_rules',
      'scheduled_events',
      'soundboard_sounds',
      'stickers',
      'guild_templates',
      'guild_onboarding_settings',
      'guild_widget_settings',
      'guild_welcome_screen_settings',
      'guild_presentation_settings',
    ]) {
      expect(
        db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get(),
        table
      ).toBe(0)
    }
    db.close()
  })

  it('removes channel-owned stage and lobby-message state', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, channelId, guildId, ownerId } = seedDomainRoots(db)
    db.prepare(
      `INSERT INTO stage_instances (id, guild_id, channel_id, topic)
       VALUES ('cascade-stage', ?, ?, 'Stage')`
    ).run(guildId, channelId)
    db.prepare(
      `INSERT INTO lobbies (id, application_id, owner_id, linked_channel_id)
       VALUES ('channel-lobby', ?, ?, ?)`
    ).run(applicationId, ownerId, channelId)
    db.prepare(
      `INSERT INTO lobby_messages
         (id, lobby_id, channel_id, author_id, application_id, content)
       VALUES ('channel-message', 'channel-lobby', ?, ?, ?, 'Message')`
    ).run(channelId, ownerId, applicationId)

    db.prepare('DELETE FROM channels WHERE id = ?').run(channelId)

    expect(
      db.prepare('SELECT COUNT(*) FROM stage_instances').pluck().get()
    ).toBe(0)
    expect(
      db.prepare('SELECT COUNT(*) FROM lobby_messages').pluck().get()
    ).toBe(0)
    expect(
      db
        .prepare('SELECT linked_channel_id FROM lobbies WHERE id = ?')
        .pluck()
        .get('channel-lobby')
    ).toBeNull()
    db.close()
  })
})

describe('isolated persistence fixtures', () => {
  it('seeds distinct application owners, bearer credentials, and users', () => {
    const db = initializeDatabase(':memory:')
    const { seedApplicationOwner, seedBearerCredential, seedSecondUser } =
      testHelpers

    const firstApplication = seedApplicationOwner(db)
    const secondApplication = seedApplicationOwner(db)
    const firstCredential = seedBearerCredential(db)
    const secondCredential = seedBearerCredential(db)
    const firstUser = seedSecondUser(db)
    const secondUser = seedSecondUser(db)

    expect(secondApplication).not.toEqual(firstApplication)
    expect(secondCredential).not.toEqual(firstCredential)
    expect(secondUser).not.toEqual(firstUser)
    expect(
      db
        .prepare(
          `SELECT COUNT(*) FROM applications
           WHERE id IN (?, ?) AND owner_id IN (?, ?)`
        )
        .pluck()
        .get(
          firstApplication.applicationId,
          secondApplication.applicationId,
          firstApplication.ownerId,
          secondApplication.ownerId
        )
    ).toBe(2)
    expect(
      db
        .prepare(
          `SELECT COUNT(*) FROM oauth2_access_tokens
           WHERE token IN (?, ?) AND user_id IN (?, ?)`
        )
        .pluck()
        .get(
          firstCredential.bearerToken,
          secondCredential.bearerToken,
          firstCredential.userId,
          secondCredential.userId
        )
    ).toBe(2)
    db.close()
  })

  it('seeds related lobby, stage, subscription, template, event, and webhook-original resources', () => {
    const db = initializeDatabase(':memory:')
    const {
      seedApplicationOwner,
      seedGuildTemplate,
      seedLobby,
      seedScheduledEvent,
      seedSkuSubscription,
      seedStageChannel,
      seedWebhookOriginalMessage,
    } = testHelpers
    const token = testHelpers.seedBot(db)
    const guildId = testHelpers.seedGuild(db, token)
    const channelId = testHelpers.seedChannel(db, guildId)
    const { applicationId, ownerId } = seedApplicationOwner(db)

    const lobby = seedLobby(db, applicationId, ownerId, channelId)
    const stage = seedStageChannel(db, guildId)
    const subscription = seedSkuSubscription(db, applicationId, ownerId)
    const template = seedGuildTemplate(db, guildId, ownerId)
    const event = seedScheduledEvent(db, guildId, ownerId, stage.stageChannelId)
    const original = seedWebhookOriginalMessage(
      db,
      applicationId,
      channelId,
      ownerId
    )
    const secondLobby = seedLobby(db, applicationId, ownerId, channelId)
    const secondStage = seedStageChannel(db, guildId)
    const secondSubscription = seedSkuSubscription(db, applicationId, ownerId)
    const secondTemplate = seedGuildTemplate(db, guildId, ownerId)
    const secondEvent = seedScheduledEvent(
      db,
      guildId,
      ownerId,
      secondStage.stageChannelId
    )
    const secondOriginal = seedWebhookOriginalMessage(
      db,
      applicationId,
      channelId,
      ownerId
    )

    expect(secondLobby.lobbyId).not.toBe(lobby.lobbyId)
    expect(secondStage.stageChannelId).not.toBe(stage.stageChannelId)
    expect(secondSubscription.subscriptionId).not.toBe(
      subscription.subscriptionId
    )
    expect(secondSubscription.skuId).not.toBe(subscription.skuId)
    expect(secondTemplate.templateCode).not.toBe(template.templateCode)
    expect(secondEvent.eventId).not.toBe(event.eventId)
    expect(secondOriginal.originalMessageId).not.toBe(
      original.originalMessageId
    )
    expect(secondOriginal.interactionId).not.toBe(original.interactionId)
    expect(secondOriginal.webhookToken).not.toBe(original.webhookToken)

    expect(
      db
        .prepare(
          'SELECT application_id FROM lobbies WHERE id = ? AND owner_id = ?'
        )
        .pluck()
        .get(lobby.lobbyId, ownerId)
    ).toBe(applicationId)
    expect(
      db
        .prepare('SELECT type FROM channels WHERE id = ?')
        .pluck()
        .get(stage.stageChannelId)
    ).toBe(13)
    expect(
      db
        .prepare('SELECT sku_id FROM subscriptions WHERE id = ?')
        .pluck()
        .get(subscription.subscriptionId)
    ).toBe(subscription.skuId)
    expect(
      db
        .prepare('SELECT source_guild_id FROM guild_templates WHERE code = ?')
        .pluck()
        .get(template.templateCode)
    ).toBe(guildId)
    expect(
      db
        .prepare('SELECT channel_id FROM scheduled_events WHERE id = ?')
        .pluck()
        .get(event.eventId)
    ).toBe(stage.stageChannelId)
    expect(
      db
        .prepare(
          `SELECT COUNT(*) FROM interactions
           WHERE initial_response_message_id = ? AND application_id = ?
             AND token = ?`
        )
        .pluck()
        .get(
          original.originalMessageId,
          original.webhookId,
          original.webhookToken
        )
    ).toBe(1)
    db.close()
  })

  it('creates independently disposable uploaded files', async () => {
    const { seedDisposableUploadedFile } = testHelpers

    const first = await seedDisposableUploadedFile('first upload')
    const second = await seedDisposableUploadedFile('second upload')
    expect(first.filePath).not.toBe(second.filePath)
    expect(readFileSync(first.filePath, 'utf8')).toBe('first upload')
    expect(readFileSync(second.filePath, 'utf8')).toBe('second upload')

    await first.cleanup()
    expect(existsSync(first.uploadDirectory)).toBe(false)
    expect(existsSync(second.filePath)).toBe(true)
    await second.cleanup()
  })
})
