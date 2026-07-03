/**
 * SQLite database initialization and migration
 *
 * Uses better-sqlite3 and runs in WAL mode.
 */

import BetterSqlite3 from 'better-sqlite3'
import type { Database } from 'better-sqlite3'

/** Thread-related columns added to the `channels` table, with their DDL. */
const CHANNELS_THREAD_COLUMNS: Record<string, string> = {
  owner_id: 'TEXT',
  archived: 'INTEGER NOT NULL DEFAULT 0',
  auto_archive_duration: 'INTEGER NOT NULL DEFAULT 1440',
  locked: 'INTEGER NOT NULL DEFAULT 0',
  invitable: 'INTEGER NOT NULL DEFAULT 1',
  archive_timestamp: 'TEXT',
}

/**
 * Adds thread-related columns to an existing `channels` table when missing.
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a database
 * created before thread support would otherwise lack these columns and cause
 * thread INSERT/SELECTs to fail at runtime.
 * @param db - Database instance
 */
function migrateChannelsThreadColumns(db: Database): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(channels)').all() as { name: string }[]).map(
      (col) => col.name
    )
  )
  for (const [name, ddl] of Object.entries(CHANNELS_THREAD_COLUMNS)) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE channels ADD COLUMN ${name} ${ddl}`)
    }
  }
}

/**
 * Initializes the database and creates tables.
 * @param dbPath - SQLite file path (":memory:" for an in-memory DB)
 * @returns Initialized Database instance
 */
export function initializeDatabase(dbPath: string): Database {
  const db = new BetterSqlite3(dbPath)

  // Performance and integrity settings
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA synchronous = NORMAL')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      token         TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      username      TEXT NOT NULL DEFAULT 'MockBot',
      discriminator TEXT NOT NULL DEFAULT '0',
      bot           INTEGER NOT NULL DEFAULT 1,
      avatar        TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL,
      discriminator TEXT NOT NULL DEFAULT '0',
      avatar        TEXT,
      bot           INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guilds (
      id                              TEXT PRIMARY KEY,
      name                            TEXT NOT NULL,
      icon                            TEXT,
      owner_id                        TEXT NOT NULL,
      bot_token                       TEXT NOT NULL REFERENCES bots(token) ON DELETE CASCADE,
      verification_level              INTEGER NOT NULL DEFAULT 0,
      default_message_notifications   INTEGER NOT NULL DEFAULT 0,
      explicit_content_filter         INTEGER NOT NULL DEFAULT 0,
      premium_tier                    INTEGER NOT NULL DEFAULT 0,
      preferred_locale                TEXT NOT NULL DEFAULT 'en-US',
      created_at                      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channels (
      id                    TEXT PRIMARY KEY,
      guild_id              TEXT REFERENCES guilds(id) ON DELETE CASCADE,
      type                  INTEGER NOT NULL DEFAULT 0,
      name                  TEXT,
      topic                 TEXT,
      nsfw                  INTEGER NOT NULL DEFAULT 0,
      position              INTEGER NOT NULL DEFAULT 0,
      rate_limit_per_user   INTEGER NOT NULL DEFAULT 0,
      parent_id             TEXT,
      last_message_id       TEXT,
      owner_id              TEXT,
      archived              INTEGER NOT NULL DEFAULT 0,
      auto_archive_duration INTEGER NOT NULL DEFAULT 1440,
      locked                INTEGER NOT NULL DEFAULT 0,
      invitable             INTEGER NOT NULL DEFAULT 1,
      archive_timestamp     TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_channels_guild ON channels(guild_id);

    CREATE TABLE IF NOT EXISTS channel_overwrites (
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      id         TEXT NOT NULL,
      type       INTEGER NOT NULL,
      allow      TEXT NOT NULL DEFAULT '0',
      deny       TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_channel_overwrites_channel ON channel_overwrites(channel_id);

    CREATE TABLE IF NOT EXISTS thread_members (
      thread_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id        TEXT NOT NULL,
      join_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      flags          INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_thread_members_thread ON thread_members(thread_id);

    CREATE TABLE IF NOT EXISTS guild_bans (
      guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL,
      reason     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bans_guild ON guild_bans(guild_id);

    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id),
      nick       TEXT,
      joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
      deaf       INTEGER NOT NULL DEFAULT 0,
      mute       INTEGER NOT NULL DEFAULT 0,
      flags      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_members_guild ON guild_members(guild_id);

    CREATE TABLE IF NOT EXISTS roles (
      id          TEXT PRIMARY KEY,
      guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name        TEXT NOT NULL DEFAULT 'new role',
      color       INTEGER NOT NULL DEFAULT 0,
      hoist       INTEGER NOT NULL DEFAULT 0,
      position    INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '0',
      managed     INTEGER NOT NULL DEFAULT 0,
      mentionable INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_roles_guild ON roles(guild_id);

    CREATE TABLE IF NOT EXISTS emojis (
      id          TEXT PRIMARY KEY,
      guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      roles       TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_emojis_guild ON emojis(guild_id);

    CREATE TABLE IF NOT EXISTS member_roles (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      role_id  TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (guild_id, user_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_member_roles_member ON member_roles(guild_id, user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id                    TEXT PRIMARY KEY,
      channel_id            TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      author_id             TEXT NOT NULL,
      author_token          TEXT,
      content               TEXT NOT NULL DEFAULT '',
      tts                   INTEGER NOT NULL DEFAULT 0,
      mention_everyone      INTEGER NOT NULL DEFAULT 0,
      pinned                INTEGER NOT NULL DEFAULT 0,
      type                  INTEGER NOT NULL DEFAULT 0,
      flags                 INTEGER NOT NULL DEFAULT 0,
      referenced_message_id TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      edited_at             TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);

    CREATE TABLE IF NOT EXISTS embeds (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      data       TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_embeds_message ON embeds(message_id);

    CREATE TABLE IF NOT EXISTS attachments (
      id           TEXT PRIMARY KEY,
      message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      filename     TEXT NOT NULL,
      size         INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      file_path    TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

    CREATE TABLE IF NOT EXISTS reactions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL,
      emoji      TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (message_id, user_id, emoji)
    );

    CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

    CREATE TABLE IF NOT EXISTS pins (
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      pinned_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id         TEXT PRIMARY KEY,
      type       INTEGER NOT NULL DEFAULT 1,
      guild_id   TEXT REFERENCES guilds(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      avatar     TEXT,
      token      TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_webhooks_channel ON webhooks(channel_id);
    CREATE INDEX IF NOT EXISTS idx_webhooks_guild ON webhooks(guild_id);

    CREATE TABLE IF NOT EXISTS oauth2_clients (
      client_id     TEXT PRIMARY KEY,
      client_secret TEXT NOT NULL,
      bot_token     TEXT REFERENCES bots(token) ON DELETE SET NULL,
      redirect_uris TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth2_auth_codes (
      code         TEXT PRIMARY KEY,
      client_id    TEXT NOT NULL REFERENCES oauth2_clients(client_id),
      user_id      TEXT NOT NULL,
      scope        TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      used         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS oauth2_access_tokens (
      token         TEXT PRIMARY KEY,
      client_id     TEXT NOT NULL REFERENCES oauth2_clients(client_id),
      user_id       TEXT,
      scope         TEXT NOT NULL,
      token_type    TEXT NOT NULL DEFAULT 'Bearer',
      expires_at    TEXT NOT NULL,
      refresh_token TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS invites (
      code        TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      guild_id    TEXT REFERENCES guilds(id) ON DELETE CASCADE,
      inviter_id  TEXT,
      max_age     INTEGER NOT NULL DEFAULT 86400,
      max_uses    INTEGER NOT NULL DEFAULT 0,
      temporary   INTEGER NOT NULL DEFAULT 0,
      uses        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_invites_channel ON invites(channel_id);
  `)

  migrateChannelsThreadColumns(db)

  return db
}

/**
 * Closes the database connection.
 * @param db - Database instance to close
 */
export function closeDatabase(db: Database): void {
  if (db.open) {
    db.close()
  }
}

export { type Database } from 'better-sqlite3'
