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

/** Additional channel feature columns (voice status), independent of thread support. */
const CHANNELS_FEATURE_COLUMNS: Record<string, string> = {
  voice_status: 'TEXT',
  typing_at: 'TEXT',
}

/**
 * Adds channel feature columns (currently just voice_status) to an
 * existing `channels` table when missing. Kept separate from
 * migrateChannelsThreadColumns so voice-related migrations stay
 * independent of thread-support semantics.
 * @param db - Database instance
 */
function migrateChannelsFeatureColumns(db: Database): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(channels)').all() as { name: string }[]).map(
      (col) => col.name
    )
  )
  for (const [name, ddl] of Object.entries(CHANNELS_FEATURE_COLUMNS)) {
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
      voice_status          TEXT,
      typing_at             TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_channels_guild ON channels(guild_id);

    CREATE TABLE IF NOT EXISTS channel_recipients (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (channel_id, user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_channel_recipients_channel ON channel_recipients(channel_id);

    CREATE TABLE IF NOT EXISTS polls (
      message_id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      allow_multiselect INTEGER NOT NULL DEFAULT 0,
      expiry TEXT,
      finalized INTEGER NOT NULL DEFAULT 0,
      layout_type INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS poll_answers (
      id INTEGER NOT NULL,
      message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      emoji TEXT,
      PRIMARY KEY (message_id, id),
      FOREIGN KEY (message_id) REFERENCES polls(message_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      message_id TEXT NOT NULL,
      answer_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (message_id, answer_id, user_id),
      FOREIGN KEY (message_id) REFERENCES polls(message_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_poll_votes_message ON poll_votes(message_id);

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

    CREATE TABLE IF NOT EXISTS partner_sdk_provisional_identities (
      client_id           TEXT NOT NULL REFERENCES oauth2_clients(client_id) ON DELETE CASCADE,
      external_auth_token TEXT NOT NULL,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (client_id, external_auth_token)
    );
    CREATE INDEX IF NOT EXISTS idx_partner_sdk_provisional_identities_user
      ON partner_sdk_provisional_identities(user_id);

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

    CREATE TABLE IF NOT EXISTS invite_target_users (
      code            TEXT PRIMARY KEY REFERENCES invites(code) ON DELETE CASCADE,
      raw_csv         TEXT NOT NULL,
      total_users     INTEGER NOT NULL,
      processed_users INTEGER NOT NULL,
      status          INTEGER NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT,
      error_message   TEXT
    );

    CREATE TABLE IF NOT EXISTS application_commands (
      id                          TEXT PRIMARY KEY,
      application_id              TEXT NOT NULL,
      guild_id                    TEXT REFERENCES guilds(id) ON DELETE CASCADE,
      type                        INTEGER NOT NULL DEFAULT 1,
      name                        TEXT NOT NULL,
      description                 TEXT NOT NULL DEFAULT '',
      options                     TEXT NOT NULL DEFAULT '[]',
      default_member_permissions  TEXT,
      dm_permission                INTEGER,
      nsfw                        INTEGER NOT NULL DEFAULT 0,
      version                     TEXT NOT NULL,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_app_commands_app ON application_commands(application_id, guild_id);
    -- SQLite treats NULL as distinct in a plain UNIQUE constraint, which
    -- would let multiple global (guild_id IS NULL) commands share a
    -- name/type; COALESCE to '' so global commands are deduplicated too.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_commands_unique
      ON application_commands(application_id, COALESCE(guild_id, ''), type, name);

    CREATE TABLE IF NOT EXISTS application_command_permissions (
      application_id TEXT NOT NULL,
      guild_id       TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      command_id     TEXT NOT NULL REFERENCES application_commands(id) ON DELETE CASCADE,
      permissions    TEXT NOT NULL DEFAULT '[]',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, command_id)
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id                          TEXT PRIMARY KEY,
      application_id              TEXT NOT NULL,
      token                       TEXT NOT NULL UNIQUE,
      type                        INTEGER NOT NULL,
      guild_id                    TEXT,
      channel_id                  TEXT,
      command_id                  TEXT,
      data                        TEXT NOT NULL DEFAULT '{}',
      user_id                     TEXT NOT NULL,
      member_json                 TEXT,
      responded                   INTEGER NOT NULL DEFAULT 0,
      initial_response_message_id TEXT,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_interactions_app ON interactions(application_id);

    CREATE TABLE IF NOT EXISTS applications (
      id                       TEXT PRIMARY KEY,
      owner_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                     TEXT NOT NULL,
      icon                     TEXT,
      description              TEXT NOT NULL DEFAULT '',
      type                     INTEGER,
      cover_image              TEXT,
      primary_sku_id           TEXT,
      guild_id                 TEXT REFERENCES guilds(id) ON DELETE SET NULL,
      rpc_origins              TEXT NOT NULL DEFAULT '[]',
      bot_public               INTEGER NOT NULL DEFAULT 1,
      bot_require_code_grant   INTEGER NOT NULL DEFAULT 0,
      terms_of_service_url     TEXT,
      privacy_policy_url       TEXT,
      custom_install_url       TEXT,
      install_params           TEXT,
      integration_types_config TEXT NOT NULL DEFAULT '{}',
      verify_key               TEXT NOT NULL,
      flags                    INTEGER NOT NULL DEFAULT 0,
      flags_new                TEXT NOT NULL DEFAULT '0',
      max_participants         INTEGER,
      tags                     TEXT NOT NULL DEFAULT '[]',
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_applications_owner ON applications(owner_id);
    CREATE TRIGGER IF NOT EXISTS trg_applications_delete_legacy_state
      AFTER DELETE ON applications
      BEGIN
        DELETE FROM application_command_permissions
          WHERE application_id = OLD.id;
        DELETE FROM application_commands WHERE application_id = OLD.id;
        DELETE FROM interactions WHERE application_id = OLD.id;
      END;

    CREATE TABLE IF NOT EXISTS skus (
      id             TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      slug           TEXT NOT NULL,
      type           INTEGER NOT NULL DEFAULT 5,
      flags          INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skus_application ON skus(application_id);

    CREATE TABLE IF NOT EXISTS application_emojis (
      id             TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
      roles          TEXT NOT NULL DEFAULT '[]',
      require_colons INTEGER NOT NULL DEFAULT 1,
      managed        INTEGER NOT NULL DEFAULT 0,
      animated       INTEGER NOT NULL DEFAULT 0,
      available      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_application_emojis_application
      ON application_emojis(application_id);

    CREATE TABLE IF NOT EXISTS entitlements (
      id                 TEXT PRIMARY KEY,
      sku_id             TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
      application_id     TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      user_id            TEXT REFERENCES users(id) ON DELETE CASCADE,
      guild_id           TEXT REFERENCES guilds(id) ON DELETE CASCADE,
      deleted            INTEGER NOT NULL DEFAULT 0,
      starts_at          TEXT,
      ends_at            TEXT,
      type               INTEGER NOT NULL DEFAULT 1,
      fulfilled_at       TEXT,
      fulfillment_status INTEGER,
      consumed           INTEGER NOT NULL DEFAULT 0,
      gifter_user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      parent_id          TEXT REFERENCES entitlements(id) ON DELETE SET NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (user_id IS NOT NULL OR guild_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_entitlements_application
      ON entitlements(application_id, id);
    CREATE INDEX IF NOT EXISTS idx_entitlements_owner_user
      ON entitlements(user_id);
    CREATE INDEX IF NOT EXISTS idx_entitlements_owner_guild
      ON entitlements(guild_id);

    CREATE TABLE IF NOT EXISTS entitlement_consumptions (
      entitlement_id TEXT PRIMARY KEY REFERENCES entitlements(id) ON DELETE CASCADE,
      consumed_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS application_role_connection_metadata (
      application_id            TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      key                       TEXT NOT NULL,
      type                      INTEGER NOT NULL,
      name                      TEXT NOT NULL,
      name_localizations        TEXT,
      description               TEXT NOT NULL,
      description_localizations TEXT,
      PRIMARY KEY (application_id, key)
    );

    CREATE TABLE IF NOT EXISTS user_application_role_connections (
      application_id    TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform_name     TEXT,
      platform_username TEXT,
      metadata          TEXT NOT NULL DEFAULT '{}',
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (application_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS auto_moderation_rules (
      id               TEXT PRIMARY KEY,
      guild_id         TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      creator_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
      name             TEXT NOT NULL,
      event_type       INTEGER NOT NULL,
      trigger_type     INTEGER NOT NULL,
      trigger_metadata TEXT NOT NULL DEFAULT '{}',
      actions          TEXT NOT NULL DEFAULT '[]',
      enabled          INTEGER NOT NULL DEFAULT 1,
      exempt_roles     TEXT NOT NULL DEFAULT '[]',
      exempt_channels  TEXT NOT NULL DEFAULT '[]',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_automod_rules_guild
      ON auto_moderation_rules(guild_id);

    CREATE TABLE IF NOT EXISTS scheduled_events (
      id                     TEXT PRIMARY KEY,
      guild_id               TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      channel_id             TEXT REFERENCES channels(id) ON DELETE CASCADE,
      creator_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
      name                   TEXT NOT NULL,
      description            TEXT,
      scheduled_start_time   TEXT NOT NULL,
      scheduled_end_time     TEXT,
      privacy_level          INTEGER NOT NULL DEFAULT 2,
      status                 INTEGER NOT NULL DEFAULT 1,
      entity_type            INTEGER NOT NULL,
      entity_id              TEXT,
      entity_metadata        TEXT,
      image                  TEXT,
      recurrence_rule        TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_events_guild
      ON scheduled_events(guild_id, id);

    CREATE TABLE IF NOT EXISTS scheduled_event_exceptions (
      id                   TEXT PRIMARY KEY,
      event_id             TEXT NOT NULL REFERENCES scheduled_events(id) ON DELETE CASCADE,
      scheduled_start_time TEXT,
      scheduled_end_time   TEXT,
      is_canceled          INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_event_exceptions_event
      ON scheduled_event_exceptions(event_id, id);

    CREATE TABLE IF NOT EXISTS scheduled_event_users (
      event_id  TEXT NOT NULL REFERENCES scheduled_events(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS scheduled_event_exception_users (
      exception_id TEXT NOT NULL REFERENCES scheduled_event_exceptions(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (exception_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS soundboard_sounds (
      id         TEXT PRIMARY KEY,
      guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      name       TEXT NOT NULL,
      volume     REAL NOT NULL DEFAULT 1.0,
      emoji_id   TEXT,
      emoji_name TEXT,
      available  INTEGER NOT NULL DEFAULT 1,
      file_path  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_soundboard_sounds_guild
      ON soundboard_sounds(guild_id, id);

    CREATE TABLE IF NOT EXISTS sticker_packs (
      id               TEXT PRIMARY KEY,
      sku_id           TEXT NOT NULL UNIQUE REFERENCES skus(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      description      TEXT,
      cover_sticker_id TEXT REFERENCES stickers(id) ON DELETE SET NULL,
      banner_asset_id  TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sticker_packs_sku ON sticker_packs(sku_id);

    CREATE TABLE IF NOT EXISTS stickers (
      id             TEXT PRIMARY KEY,
      guild_id       TEXT REFERENCES guilds(id) ON DELETE CASCADE,
      application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
      user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
      name           TEXT NOT NULL,
      description    TEXT,
      tags           TEXT NOT NULL,
      type           INTEGER NOT NULL DEFAULT 2,
      format_type    INTEGER NOT NULL DEFAULT 1,
      available      INTEGER NOT NULL DEFAULT 1,
      pack_id        TEXT REFERENCES sticker_packs(id) ON DELETE CASCADE,
      sort_value     INTEGER,
      asset_path     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stickers_guild ON stickers(guild_id, id);
    CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id, sort_value);

    CREATE TABLE IF NOT EXISTS guild_templates (
      code                    TEXT PRIMARY KEY,
      source_guild_id         TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      creator_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                    TEXT NOT NULL,
      description             TEXT,
      usage_count             INTEGER NOT NULL DEFAULT 0,
      serialized_source_guild TEXT NOT NULL DEFAULT '{}',
      is_dirty                INTEGER,
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_guild_templates_source
      ON guild_templates(source_guild_id);

    CREATE TABLE IF NOT EXISTS stage_instances (
      id                       TEXT PRIMARY KEY,
      guild_id                 TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      channel_id               TEXT NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
      topic                    TEXT NOT NULL,
      privacy_level            INTEGER NOT NULL DEFAULT 2,
      discoverable_disabled    INTEGER NOT NULL DEFAULT 0,
      guild_scheduled_event_id TEXT REFERENCES scheduled_events(id) ON DELETE SET NULL,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stage_instances_guild
      ON stage_instances(guild_id);

    CREATE TABLE IF NOT EXISTS lobbies (
      id                          TEXT PRIMARY KEY,
      application_id              TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      owner_id                    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      linked_channel_id           TEXT REFERENCES channels(id) ON DELETE SET NULL,
      metadata                    TEXT,
      flags                       INTEGER NOT NULL DEFAULT 0,
      override_event_webhooks_url TEXT,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lobbies_application
      ON lobbies(application_id, id);

    CREATE TABLE IF NOT EXISTS lobby_members (
      lobby_id       TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      metadata       TEXT,
      flags          INTEGER NOT NULL DEFAULT 0,
      additional_name TEXT,
      joined_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (lobby_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lobby_members_user
      ON lobby_members(user_id, lobby_id);

    CREATE TABLE IF NOT EXISTS lobby_messages (
      id                  TEXT PRIMARY KEY,
      lobby_id            TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
      channel_id          TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      author_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      application_id      TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      type                INTEGER NOT NULL DEFAULT 0,
      content             TEXT NOT NULL DEFAULT '',
      metadata            TEXT,
      moderation_metadata TEXT,
      flags               INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lobby_messages_lobby
      ON lobby_messages(lobby_id, id);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id                   TEXT PRIMARY KEY,
      sku_id               TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
      user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sku_ids              TEXT NOT NULL DEFAULT '[]',
      renewal_sku_ids      TEXT,
      entitlement_ids      TEXT NOT NULL DEFAULT '[]',
      current_period_start TEXT NOT NULL,
      current_period_end   TEXT NOT NULL,
      status               INTEGER NOT NULL DEFAULT 0,
      canceled_at          TEXT,
      country              TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_sku
      ON subscriptions(sku_id, id);

    CREATE TABLE IF NOT EXISTS guild_voice_states (
      guild_id                  TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id                TEXT REFERENCES channels(id) ON DELETE CASCADE,
      session_id                TEXT NOT NULL,
      deaf                      INTEGER NOT NULL DEFAULT 0,
      mute                      INTEGER NOT NULL DEFAULT 0,
      self_deaf                 INTEGER NOT NULL DEFAULT 0,
      self_mute                 INTEGER NOT NULL DEFAULT 0,
      self_stream               INTEGER,
      self_video                INTEGER NOT NULL DEFAULT 0,
      suppress                  INTEGER NOT NULL DEFAULT 0,
      request_to_speak_timestamp TEXT,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_guild_voice_states_channel
      ON guild_voice_states(channel_id);

    CREATE TABLE IF NOT EXISTS guild_onboarding_settings (
      guild_id            TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
      prompts             TEXT NOT NULL DEFAULT '[]',
      default_channel_ids TEXT NOT NULL DEFAULT '[]',
      enabled             INTEGER NOT NULL DEFAULT 0,
      mode                INTEGER NOT NULL DEFAULT 0,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guild_widget_settings (
      guild_id   TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
      enabled    INTEGER NOT NULL DEFAULT 0,
      channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guild_welcome_screen_settings (
      guild_id   TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
      description TEXT,
      channels    TEXT NOT NULL DEFAULT '[]',
      enabled     INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guild_presentation_settings (
      guild_id          TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
      vanity_url_code   TEXT,
      description       TEXT,
      banner            TEXT,
      splash            TEXT,
      discovery_splash  TEXT,
      features          TEXT NOT NULL DEFAULT '[]',
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  migrateChannelsThreadColumns(db)
  migrateChannelsFeatureColumns(db)

  return db
}

/**
 * Runs a synchronous database operation in a SQLite transaction.
 * @param db - Database instance
 * @param operation - Operation whose writes must commit or roll back together
 * @returns The operation result
 */
export function runInTransaction<T>(
  db: Database,
  operation: () => T & (T extends PromiseLike<unknown> ? never : unknown)
): T {
  return db.transaction(() => {
    const result: unknown = operation()
    if (
      typeof result === 'object' &&
      result !== null &&
      'then' in result &&
      typeof result.then === 'function'
    ) {
      throw new TypeError('Transaction operation must be synchronous')
    }
    return result as T
  })()
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
