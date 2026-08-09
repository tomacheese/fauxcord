/* eslint-disable @typescript-eslint/no-use-before-define -- Transactional mutators delegate to grouped resource lookup functions. */
import type { Database } from '../db'
import { runInTransaction } from '../db'
import { generateSnowflake } from '../snowflake'

type JsonObject = Record<string, unknown>

interface AutoModerationRow {
  id: string
  guild_id: string
  creator_id: string
  name: string
  event_type: number
  trigger_type: number
  trigger_metadata: string
  actions: string
  enabled: number
  exempt_roles: string
  exempt_channels: string
}

export interface AutoModerationRulePayload {
  name?: string
  event_type?: number
  trigger_type?: number
  trigger_metadata?: JsonObject
  actions?: unknown[]
  enabled?: boolean
  exempt_roles?: string[]
  exempt_channels?: string[]
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toAutoModerationRule(row: AutoModerationRow): JsonObject {
  return {
    id: row.id,
    guild_id: row.guild_id,
    creator_id: row.creator_id,
    name: row.name,
    event_type: row.event_type,
    trigger_type: row.trigger_type,
    trigger_metadata: parseJson(row.trigger_metadata, {
      allow_list: [],
      presets: [],
    }),
    actions: parseJson(row.actions, []),
    enabled: row.enabled === 1,
    exempt_roles: parseJson(row.exempt_roles, []),
    exempt_channels: parseJson(row.exempt_channels, []),
  }
}

/** Creates an auto-moderation rule in a transaction. */
export function createAutoModerationRule(
  db: Database,
  guildId: string,
  creatorId: string,
  payload: AutoModerationRulePayload
): JsonObject & { id: string } {
  return runInTransaction(db, () => {
    const id = generateSnowflake()
    db.prepare(
      `INSERT INTO auto_moderation_rules
         (id, guild_id, creator_id, name, event_type, trigger_type,
          trigger_metadata, actions, enabled, exempt_roles, exempt_channels)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      guildId,
      creatorId,
      payload.name ?? 'New rule',
      payload.event_type ?? 1,
      payload.trigger_type ?? 4,
      JSON.stringify(
        payload.trigger_metadata ?? { allow_list: [], presets: [] }
      ),
      JSON.stringify(payload.actions ?? []),
      payload.enabled === false ? 0 : 1,
      JSON.stringify(payload.exempt_roles ?? []),
      JSON.stringify(payload.exempt_channels ?? [])
    )
    return getAutoModerationRule(db, guildId, id) as JsonObject & { id: string }
  })
}

/** Lists a guild's auto-moderation rules. */
export function listAutoModerationRules(
  db: Database,
  guildId: string
): JsonObject[] {
  return (
    db
      .prepare(
        'SELECT * FROM auto_moderation_rules WHERE guild_id = ? ORDER BY id'
      )
      .all(guildId) as AutoModerationRow[]
  ).map((row) => toAutoModerationRule(row))
}

/** Retrieves one auto-moderation rule. */
export function getAutoModerationRule(
  db: Database,
  guildId: string,
  ruleId: string
): (JsonObject & { id: string; name: string; enabled: boolean }) | null {
  const row = db
    .prepare(
      'SELECT * FROM auto_moderation_rules WHERE guild_id = ? AND id = ?'
    )
    .get(guildId, ruleId) as AutoModerationRow | undefined
  return row
    ? (toAutoModerationRule(row) as JsonObject & {
        id: string
        name: string
        enabled: boolean
      })
    : null
}

/** Updates one auto-moderation rule in a transaction. */
export function updateAutoModerationRule(
  db: Database,
  guildId: string,
  ruleId: string,
  payload: AutoModerationRulePayload
): (JsonObject & { id: string; name: string; enabled: boolean }) | null {
  return runInTransaction(db, () => {
    const current = getAutoModerationRule(db, guildId, ruleId)
    if (!current) return null
    db.prepare(
      `UPDATE auto_moderation_rules SET
         name = ?, event_type = ?, trigger_type = ?, trigger_metadata = ?,
         actions = ?, enabled = ?, exempt_roles = ?, exempt_channels = ?,
         updated_at = datetime('now')
       WHERE guild_id = ? AND id = ?`
    ).run(
      payload.name ?? current.name,
      payload.event_type ?? current.event_type,
      payload.trigger_type ?? current.trigger_type,
      JSON.stringify(payload.trigger_metadata ?? current.trigger_metadata),
      JSON.stringify(payload.actions ?? current.actions),
      payload.enabled === undefined
        ? current.enabled
          ? 1
          : 0
        : payload.enabled
          ? 1
          : 0,
      JSON.stringify(payload.exempt_roles ?? current.exempt_roles),
      JSON.stringify(payload.exempt_channels ?? current.exempt_channels),
      guildId,
      ruleId
    )
    return getAutoModerationRule(db, guildId, ruleId)
  })
}

/** Deletes one auto-moderation rule in a transaction. */
export function deleteAutoModerationRule(
  db: Database,
  guildId: string,
  ruleId: string
): boolean {
  return runInTransaction(
    db,
    () =>
      db
        .prepare(
          'DELETE FROM auto_moderation_rules WHERE guild_id = ? AND id = ?'
        )
        .run(guildId, ruleId).changes > 0
  )
}

interface ScheduledEventRow {
  id: string
  guild_id: string
  channel_id: string | null
  creator_id: string | null
  name: string
  description: string | null
  scheduled_start_time: string
  scheduled_end_time: string | null
  privacy_level: number
  status: number
  entity_type: number
  entity_id: string | null
  entity_metadata: string | null
  image: string | null
  recurrence_rule: string | null
}

export interface ScheduledEventPayload {
  name?: string
  description?: string | null
  channel_id?: string | null
  scheduled_start_time?: string
  scheduled_end_time?: string | null
  privacy_level?: number
  status?: number
  entity_type?: number
  entity_metadata?: JsonObject | null
  image?: string | null
  recurrence_rule?: JsonObject | null
}

function eventExceptions(db: Database, eventId: string): JsonObject[] {
  const rows = db
    .prepare(
      `SELECT id, event_id, scheduled_start_time, scheduled_end_time, is_canceled
       FROM scheduled_event_exceptions WHERE event_id = ? ORDER BY id`
    )
    .all(eventId) as {
    id: string
    event_id: string
    scheduled_start_time: string | null
    scheduled_end_time: string | null
    is_canceled: number
  }[]
  return rows.map((row) => ({
    event_id: row.event_id,
    event_exception_id: row.id,
    scheduled_start_time: row.scheduled_start_time,
    scheduled_end_time: row.scheduled_end_time,
    is_canceled: row.is_canceled === 1,
  }))
}

function toScheduledEvent(db: Database, row: ScheduledEventRow): JsonObject {
  const count = (
    db
      .prepare(
        'SELECT COUNT(*) AS count FROM scheduled_event_users WHERE event_id = ?'
      )
      .get(row.id) as { count: number }
  ).count
  return {
    id: row.id,
    guild_id: row.guild_id,
    name: row.name,
    description: row.description,
    channel_id: row.channel_id,
    creator_id: row.creator_id,
    image: row.image,
    scheduled_start_time: row.scheduled_start_time,
    scheduled_end_time: row.scheduled_end_time,
    status: row.status,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    recurrence_rule: parseJson<JsonObject | null>(row.recurrence_rule, null),
    user_count: count,
    privacy_level: row.privacy_level,
    guild_scheduled_event_exceptions: eventExceptions(db, row.id),
    entity_metadata: parseJson(row.entity_metadata, { location: 'Fauxcord' }),
  }
}

/** Creates a scheduled guild event. */
export function createGuildScheduledEvent(
  db: Database,
  guildId: string,
  creatorId: string,
  payload: ScheduledEventPayload
): JsonObject & { id: string } {
  return runInTransaction(db, () => {
    const id = generateSnowflake()
    db.prepare(
      `INSERT INTO scheduled_events
         (id, guild_id, channel_id, creator_id, name, description,
          scheduled_start_time, scheduled_end_time, privacy_level, status,
          entity_type, entity_metadata, image, recurrence_rule)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      guildId,
      payload.channel_id ?? null,
      creatorId,
      payload.name ?? 'Scheduled event',
      payload.description ?? null,
      payload.scheduled_start_time ?? new Date().toISOString(),
      payload.scheduled_end_time ?? null,
      payload.privacy_level ?? 2,
      payload.status ?? 1,
      payload.entity_type ?? 3,
      JSON.stringify(payload.entity_metadata ?? { location: 'Fauxcord' }),
      payload.image ?? null,
      JSON.stringify(payload.recurrence_rule ?? null)
    )
    return getGuildScheduledEvent(db, guildId, id) as JsonObject & {
      id: string
    }
  })
}

/** Retrieves a scheduled guild event. */
export function getGuildScheduledEvent(
  db: Database,
  guildId: string,
  eventId: string
): (JsonObject & { id: string; name: string }) | null {
  const row = db
    .prepare('SELECT * FROM scheduled_events WHERE guild_id = ? AND id = ?')
    .get(guildId, eventId) as ScheduledEventRow | undefined
  return row
    ? (toScheduledEvent(db, row) as JsonObject & { id: string; name: string })
    : null
}

/** Lists a guild's scheduled events. */
export function listGuildScheduledEvents(
  db: Database,
  guildId: string
): JsonObject[] {
  return (
    db
      .prepare('SELECT * FROM scheduled_events WHERE guild_id = ? ORDER BY id')
      .all(guildId) as ScheduledEventRow[]
  ).map((row) => toScheduledEvent(db, row))
}

interface SoundboardRow {
  id: string
  guild_id: string
  user_id: string | null
  name: string
  volume: number
  emoji_id: string | null
  emoji_name: string | null
  available: number
}

export interface GuildSoundboardPayload {
  sound_id?: string
  name?: string
  volume?: number
  emoji_id?: string | null
  emoji_name?: string | null
}

function toSoundboardSound(row: SoundboardRow): JsonObject & {
  sound_id: string
} {
  return {
    name: row.name,
    sound_id: row.id,
    volume: row.volume,
    emoji_id: row.emoji_id,
    emoji_name: row.emoji_name,
    guild_id: row.guild_id,
    available: row.available === 1,
  }
}

/** Creates a guild soundboard sound. */
export function createGuildSoundboardSound(
  db: Database,
  guildId: string,
  userId: string,
  payload: GuildSoundboardPayload
): JsonObject & { sound_id: string } {
  return runInTransaction(db, () => {
    const soundId = payload.sound_id ?? generateSnowflake()
    db.prepare(
      `INSERT INTO soundboard_sounds
         (id, guild_id, user_id, name, volume, emoji_id, emoji_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      soundId,
      guildId,
      userId,
      payload.name ?? 'New sound',
      payload.volume ?? 1,
      payload.emoji_id ?? null,
      payload.emoji_name ?? null
    )
    return getGuildSoundboardSound(db, guildId, soundId) as JsonObject & {
      sound_id: string
    }
  })
}

/** Retrieves a guild soundboard sound. */
export function getGuildSoundboardSound(
  db: Database,
  guildId: string,
  soundId: string
): (JsonObject & { sound_id: string; name: string; volume: number }) | null {
  const row = db
    .prepare('SELECT * FROM soundboard_sounds WHERE guild_id = ? AND id = ?')
    .get(guildId, soundId) as SoundboardRow | undefined
  return row
    ? (toSoundboardSound(row) as JsonObject & {
        sound_id: string
        name: string
        volume: number
      })
    : null
}

/** Lists guild soundboard sounds. */
export function listGuildSoundboardSounds(
  db: Database,
  guildId: string
): JsonObject[] {
  return (
    db
      .prepare('SELECT * FROM soundboard_sounds WHERE guild_id = ? ORDER BY id')
      .all(guildId) as SoundboardRow[]
  ).map((row) => toSoundboardSound(row))
}

export interface GuildTemplatePayload {
  name?: string
  description?: string | null
}

interface TemplateRow {
  code: string
  source_guild_id: string
  creator_id: string
  name: string
  description: string | null
  usage_count: number
  is_dirty: number | null
  created_at: string
  updated_at: string
}

function userObject(db: Database, userId: string): JsonObject {
  const user = db
    .prepare(
      'SELECT id, username, discriminator, avatar, bot FROM users WHERE id = ?'
    )
    .get(userId) as
    | {
        id: string
        username: string
        discriminator: string
        avatar: string | null
        bot: number
      }
    | undefined
  return {
    id: user?.id ?? userId,
    username: user?.username ?? 'Unknown User',
    discriminator: user?.discriminator ?? '0',
    avatar: user?.avatar ?? null,
    bot: user?.bot === 1,
    public_flags: 0,
    flags: 0,
    global_name: null,
    primary_guild: null,
  }
}

function templateSnapshot(db: Database, guildId: string): JsonObject {
  const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId) as
    | {
        name: string
        verification_level: number
        default_message_notifications: number
        explicit_content_filter: number
        preferred_locale: string
      }
    | undefined
  return {
    name: guild?.name ?? 'Unknown Guild',
    description: null,
    region: null,
    verification_level: guild?.verification_level ?? 0,
    default_message_notifications: guild?.default_message_notifications ?? 0,
    explicit_content_filter: guild?.explicit_content_filter ?? 0,
    preferred_locale: guild?.preferred_locale ?? 'en-US',
    afk_channel_id: null,
    afk_timeout: 300,
    system_channel_id: null,
    system_channel_flags: 0,
    roles: [],
    channels: [],
  }
}

function toTemplate(
  db: Database,
  row: TemplateRow
): JsonObject & {
  code: string
  name: string
  source_guild_id: string
} {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    usage_count: row.usage_count,
    creator_id: row.creator_id,
    creator: userObject(db, row.creator_id),
    created_at: new Date(`${row.created_at}Z`).toISOString(),
    updated_at: new Date(`${row.updated_at}Z`).toISOString(),
    source_guild_id: row.source_guild_id,
    serialized_source_guild: templateSnapshot(db, row.source_guild_id),
    is_dirty: row.is_dirty === null ? null : row.is_dirty === 1,
  }
}

/** Creates a reusable guild template. */
export function createGuildTemplate(
  db: Database,
  guildId: string,
  creatorId: string,
  payload: GuildTemplatePayload
): JsonObject & { code: string; name: string; source_guild_id: string } {
  return runInTransaction(db, () => {
    const code = generateSnowflake().slice(-12)
    db.prepare(
      `INSERT INTO guild_templates
         (code, source_guild_id, creator_id, name, description,
          serialized_source_guild)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      code,
      guildId,
      creatorId,
      payload.name ?? 'New Template',
      payload.description ?? null,
      JSON.stringify(templateSnapshot(db, guildId))
    )
    return getGuildTemplate(db, code) as JsonObject & {
      code: string
      name: string
      source_guild_id: string
    }
  })
}

/** Retrieves a guild template by public code. */
export function getGuildTemplate(
  db: Database,
  code: string
):
  | (JsonObject & { code: string; name: string; source_guild_id: string })
  | null {
  const row = db
    .prepare('SELECT * FROM guild_templates WHERE code = ?')
    .get(code) as TemplateRow | undefined
  return row ? toTemplate(db, row) : null
}

/** Lists templates sourced from a guild. */
export function listGuildTemplates(
  db: Database,
  guildId: string
): JsonObject[] {
  return (
    db
      .prepare(
        'SELECT * FROM guild_templates WHERE source_guild_id = ? ORDER BY code'
      )
      .all(guildId) as TemplateRow[]
  ).map((row) => toTemplate(db, row))
}

/** Updates or deletes a scheduled event. */
export function updateGuildScheduledEvent(
  db: Database,
  guildId: string,
  eventId: string,
  payload: ScheduledEventPayload
): JsonObject | null {
  const current = getGuildScheduledEvent(db, guildId, eventId)
  if (!current) return null
  return runInTransaction(db, () => {
    db.prepare(
      `UPDATE scheduled_events SET name = ?, description = ?, channel_id = ?,
         scheduled_start_time = ?, scheduled_end_time = ?, privacy_level = ?,
         status = ?, entity_type = ?, entity_metadata = ?, image = ?,
         recurrence_rule = ?, updated_at = datetime('now')
       WHERE guild_id = ? AND id = ?`
    ).run(
      payload.name ?? current.name,
      payload.description === undefined
        ? current.description
        : payload.description,
      payload.channel_id === undefined
        ? current.channel_id
        : payload.channel_id,
      payload.scheduled_start_time ?? current.scheduled_start_time,
      payload.scheduled_end_time === undefined
        ? current.scheduled_end_time
        : payload.scheduled_end_time,
      payload.privacy_level ?? current.privacy_level,
      payload.status ?? current.status,
      payload.entity_type ?? current.entity_type,
      JSON.stringify(payload.entity_metadata ?? current.entity_metadata),
      payload.image === undefined ? current.image : payload.image,
      JSON.stringify(payload.recurrence_rule ?? current.recurrence_rule),
      guildId,
      eventId
    )
    return getGuildScheduledEvent(db, guildId, eventId)
  })
}

/** Deletes a scheduled event. */
export function deleteGuildScheduledEvent(
  db: Database,
  guildId: string,
  eventId: string
): boolean {
  return runInTransaction(
    db,
    () =>
      db
        .prepare('DELETE FROM scheduled_events WHERE guild_id = ? AND id = ?')
        .run(guildId, eventId).changes > 0
  )
}

export interface EventExceptionPayload {
  scheduled_start_time?: string | null
  scheduled_end_time?: string | null
  is_canceled?: boolean
}

/** Creates an exception for a scheduled event. */
export function createScheduledEventException(
  db: Database,
  eventId: string,
  payload: EventExceptionPayload
): JsonObject & { event_exception_id: string } {
  return runInTransaction(db, () => {
    const id = generateSnowflake()
    db.prepare(
      `INSERT INTO scheduled_event_exceptions
         (id, event_id, scheduled_start_time, scheduled_end_time, is_canceled)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      id,
      eventId,
      payload.scheduled_start_time ?? null,
      payload.scheduled_end_time ?? null,
      payload.is_canceled ? 1 : 0
    )
    return getScheduledEventException(db, eventId, id) as JsonObject & {
      event_exception_id: string
    }
  })
}

/** Retrieves a scheduled event exception. */
export function getScheduledEventException(
  db: Database,
  eventId: string,
  exceptionId: string
): (JsonObject & { event_exception_id: string }) | null {
  const row = db
    .prepare(
      `SELECT id, event_id, scheduled_start_time, scheduled_end_time, is_canceled
       FROM scheduled_event_exceptions WHERE event_id = ? AND id = ?`
    )
    .get(eventId, exceptionId) as
    | {
        id: string
        event_id: string
        scheduled_start_time: string | null
        scheduled_end_time: string | null
        is_canceled: number
      }
    | undefined
  return row
    ? {
        event_id: row.event_id,
        event_exception_id: row.id,
        scheduled_start_time: row.scheduled_start_time,
        scheduled_end_time: row.scheduled_end_time,
        is_canceled: row.is_canceled === 1,
      }
    : null
}

/** Updates a scheduled event exception. */
export function updateScheduledEventException(
  db: Database,
  eventId: string,
  exceptionId: string,
  payload: EventExceptionPayload
): JsonObject | null {
  const current = getScheduledEventException(db, eventId, exceptionId)
  if (!current) return null
  db.prepare(
    `UPDATE scheduled_event_exceptions SET scheduled_start_time = ?,
       scheduled_end_time = ?, is_canceled = ? WHERE event_id = ? AND id = ?`
  ).run(
    payload.scheduled_start_time === undefined
      ? current.scheduled_start_time
      : payload.scheduled_start_time,
    payload.scheduled_end_time === undefined
      ? current.scheduled_end_time
      : payload.scheduled_end_time,
    payload.is_canceled === undefined
      ? current.is_canceled
        ? 1
        : 0
      : payload.is_canceled
        ? 1
        : 0,
    eventId,
    exceptionId
  )
  return getScheduledEventException(db, eventId, exceptionId)
}

/** Deletes a scheduled event exception. */
export function deleteScheduledEventException(
  db: Database,
  eventId: string,
  exceptionId: string
): boolean {
  return (
    db
      .prepare(
        'DELETE FROM scheduled_event_exceptions WHERE event_id = ? AND id = ?'
      )
      .run(eventId, exceptionId).changes > 0
  )
}

/** Lists event subscribers or exception subscribers. */
export function listScheduledEventUsers(
  db: Database,
  eventId: string,
  exceptionId?: string
): JsonObject[] {
  const rows = exceptionId
    ? (db
        .prepare(
          `SELECT user_id FROM scheduled_event_exception_users
           WHERE exception_id = ? ORDER BY user_id`
        )
        .all(exceptionId) as { user_id: string }[])
    : (db
        .prepare(
          `SELECT user_id FROM scheduled_event_users
           WHERE event_id = ? ORDER BY user_id`
        )
        .all(eventId) as { user_id: string }[])
  return rows.map((row) => ({
    guild_scheduled_event_id: eventId,
    ...(exceptionId && {
      guild_scheduled_event_exception_id: exceptionId,
    }),
    user_id: row.user_id,
    user: userObject(db, row.user_id),
    response: 1,
  }))
}

/** Returns scheduled event and exception RSVP counts. */
export function getScheduledEventUserCounts(
  db: Database,
  eventId: string
): JsonObject {
  const eventCount = (
    db
      .prepare(
        'SELECT COUNT(*) AS count FROM scheduled_event_users WHERE event_id = ?'
      )
      .get(eventId) as { count: number }
  ).count
  const exceptionRows = db
    .prepare(
      `SELECT e.id AS guild_scheduled_event_exception_id,
              COUNT(u.user_id) AS count
       FROM scheduled_event_exceptions e
       LEFT JOIN scheduled_event_exception_users u ON u.exception_id = e.id
       WHERE e.event_id = ? GROUP BY e.id ORDER BY e.id`
    )
    .all(eventId)
  const exceptionCounts = Object.fromEntries(
    (
      exceptionRows as {
        guild_scheduled_event_exception_id: string
        count: number
      }[]
    ).map((row) => [row.guild_scheduled_event_exception_id, row.count])
  )
  return {
    guild_scheduled_event_count: eventCount,
    guild_scheduled_event_exception_counts: exceptionCounts,
  }
}

/** Updates or deletes guild soundboard sounds. */
export function updateGuildSoundboardSound(
  db: Database,
  guildId: string,
  soundId: string,
  payload: GuildSoundboardPayload
): JsonObject | null {
  const current = getGuildSoundboardSound(db, guildId, soundId)
  if (!current) return null
  db.prepare(
    `UPDATE soundboard_sounds SET name = ?, volume = ?, emoji_id = ?,
       emoji_name = ? WHERE guild_id = ? AND id = ?`
  ).run(
    payload.name ?? current.name,
    payload.volume ?? current.volume,
    payload.emoji_id === undefined ? current.emoji_id : payload.emoji_id,
    payload.emoji_name === undefined ? current.emoji_name : payload.emoji_name,
    guildId,
    soundId
  )
  return getGuildSoundboardSound(db, guildId, soundId)
}

/** Deletes a guild soundboard sound. */
export function deleteGuildSoundboardSound(
  db: Database,
  guildId: string,
  soundId: string
): boolean {
  return (
    db
      .prepare('DELETE FROM soundboard_sounds WHERE guild_id = ? AND id = ?')
      .run(guildId, soundId).changes > 0
  )
}

export interface GuildStickerPayload {
  name?: string
  description?: string | null
  tags?: string
  asset_path?: string | null
}

function toSticker(row: {
  id: string
  guild_id: string
  name: string
  description: string | null
  tags: string
  type: number
  format_type: number
  available: number
}): JsonObject & { id: string } {
  return {
    id: row.id,
    name: row.name,
    tags: row.tags,
    type: row.type,
    format_type: row.format_type,
    description: row.description,
    available: row.available === 1,
    guild_id: row.guild_id,
  }
}

/** Creates a guild sticker. */
export function createGuildSticker(
  db: Database,
  guildId: string,
  userId: string,
  payload: GuildStickerPayload
): JsonObject & { id: string } {
  const id = generateSnowflake()
  db.prepare(
    `INSERT INTO stickers
       (id, guild_id, user_id, name, description, tags, type, format_type,
        asset_path)
     VALUES (?, ?, ?, ?, ?, ?, 2, 1, ?)`
  ).run(
    id,
    guildId,
    userId,
    payload.name ?? 'New sticker',
    payload.description ?? null,
    payload.tags ?? 'sticker',
    payload.asset_path ?? null
  )
  return getGuildSticker(db, guildId, id) as JsonObject & { id: string }
}

/** Gets one guild sticker. */
export function getGuildSticker(
  db: Database,
  guildId: string,
  stickerId: string
): (JsonObject & { id: string }) | null {
  const row = db
    .prepare('SELECT * FROM stickers WHERE guild_id = ? AND id = ?')
    .get(guildId, stickerId) as Parameters<typeof toSticker>[0] | undefined
  return row ? toSticker(row) : null
}

/** Lists guild stickers. */
export function listGuildStickers(db: Database, guildId: string): JsonObject[] {
  return (
    db
      .prepare('SELECT * FROM stickers WHERE guild_id = ? ORDER BY id')
      .all(guildId) as Parameters<typeof toSticker>[0][]
  ).map((row) => toSticker(row))
}

/** Updates a guild sticker. */
export function updateGuildSticker(
  db: Database,
  guildId: string,
  stickerId: string,
  payload: GuildStickerPayload
): JsonObject | null {
  const current = getGuildSticker(db, guildId, stickerId)
  if (!current) return null
  db.prepare(
    `UPDATE stickers SET name = ?, description = ?, tags = ?
     WHERE guild_id = ? AND id = ?`
  ).run(
    payload.name ?? current.name,
    payload.description === undefined
      ? current.description
      : payload.description,
    payload.tags ?? current.tags,
    guildId,
    stickerId
  )
  return getGuildSticker(db, guildId, stickerId)
}

/** Deletes a guild sticker. */
export function deleteGuildSticker(
  db: Database,
  guildId: string,
  stickerId: string
): boolean {
  return (
    db
      .prepare('DELETE FROM stickers WHERE guild_id = ? AND id = ?')
      .run(guildId, stickerId).changes > 0
  )
}

/** Updates or synchronizes a guild template. */
export function updateGuildTemplate(
  db: Database,
  guildId: string,
  code: string,
  payload: GuildTemplatePayload = {}
): JsonObject | null {
  const current = getGuildTemplate(db, code)
  if (current?.source_guild_id !== guildId) return null
  db.prepare(
    `UPDATE guild_templates SET name = ?, description = ?,
       serialized_source_guild = ?, updated_at = datetime('now'), is_dirty = 0
     WHERE source_guild_id = ? AND code = ?`
  ).run(
    payload.name ?? current.name,
    payload.description === undefined
      ? current.description
      : payload.description,
    JSON.stringify(templateSnapshot(db, guildId)),
    guildId,
    code
  )
  return getGuildTemplate(db, code)
}

/** Deletes and returns a guild template. */
export function deleteGuildTemplate(
  db: Database,
  guildId: string,
  code: string
): JsonObject | null {
  const current = getGuildTemplate(db, code)
  if (current?.source_guild_id !== guildId) return null
  db.prepare(
    'DELETE FROM guild_templates WHERE source_guild_id = ? AND code = ?'
  ).run(guildId, code)
  return current
}

/** Replaces persisted onboarding settings. */
export function setGuildOnboarding(
  db: Database,
  guildId: string,
  payload: JsonObject
): JsonObject {
  db.prepare(
    `INSERT INTO guild_onboarding_settings
       (guild_id, prompts, default_channel_ids, enabled, mode, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(guild_id) DO UPDATE SET prompts = excluded.prompts,
       default_channel_ids = excluded.default_channel_ids,
       enabled = excluded.enabled, mode = excluded.mode,
       updated_at = excluded.updated_at`
  ).run(
    guildId,
    JSON.stringify(payload.prompts ?? []),
    JSON.stringify(payload.default_channel_ids ?? []),
    payload.enabled ? 1 : 0,
    typeof payload.mode === 'number' ? payload.mode : 0
  )
  return getGuildOnboarding(db, guildId)
}

/** Gets guild onboarding settings with deterministic defaults. */
export function getGuildOnboarding(db: Database, guildId: string): JsonObject {
  const row = db
    .prepare('SELECT * FROM guild_onboarding_settings WHERE guild_id = ?')
    .get(guildId) as
    | {
        prompts: string
        default_channel_ids: string
        enabled: number
        mode: number
      }
    | undefined
  return {
    guild_id: guildId,
    prompts: parseJson(row?.prompts ?? null, []),
    default_channel_ids: parseJson(row?.default_channel_ids ?? null, []),
    enabled: row?.enabled === 1,
    mode: row?.mode ?? 0,
  }
}

/** Updates a guild voice state. */
export function setGuildVoiceState(
  db: Database,
  guildId: string,
  userId: string,
  payload: JsonObject
): void {
  const existing = getGuildVoiceState(db, guildId, userId)
  db.prepare(
    `INSERT INTO guild_voice_states
       (guild_id, user_id, channel_id, session_id, suppress,
        request_to_speak_timestamp)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       channel_id = excluded.channel_id, suppress = excluded.suppress,
       request_to_speak_timestamp = excluded.request_to_speak_timestamp`
  ).run(
    guildId,
    userId,
    payload.channel_id === undefined
      ? (existing?.channel_id ?? null)
      : payload.channel_id,
    existing?.session_id ?? `session-${userId}`,
    payload.suppress === undefined
      ? existing?.suppress
        ? 1
        : 0
      : payload.suppress
        ? 1
        : 0,
    payload.request_to_speak_timestamp === undefined
      ? (existing?.request_to_speak_timestamp ?? null)
      : payload.request_to_speak_timestamp
  )
}

/** Gets a guild voice state. */
export function getGuildVoiceState(
  db: Database,
  guildId: string,
  userId: string
):
  | (JsonObject & {
      channel_id: unknown
      session_id: string
      suppress: boolean
    })
  | null {
  const row = db
    .prepare(
      'SELECT * FROM guild_voice_states WHERE guild_id = ? AND user_id = ?'
    )
    .get(guildId, userId) as
    | {
        channel_id: string | null
        session_id: string
        deaf: number
        mute: number
        self_deaf: number
        self_mute: number
        self_stream: number | null
        self_video: number
        suppress: number
        request_to_speak_timestamp: string | null
      }
    | undefined
  return row
    ? {
        channel_id: row.channel_id,
        deaf: row.deaf === 1,
        guild_id: guildId,
        mute: row.mute === 1,
        request_to_speak_timestamp: row.request_to_speak_timestamp,
        suppress: row.suppress === 1,
        self_stream: row.self_stream === null ? false : row.self_stream === 1,
        self_deaf: row.self_deaf === 1,
        self_mute: row.self_mute === 1,
        self_video: row.self_video === 1,
        session_id: row.session_id,
        user_id: userId,
      }
    : null
}

/** Gets or updates welcome-screen settings. */
export function setGuildWelcomeScreen(
  db: Database,
  guildId: string,
  payload: JsonObject
): JsonObject {
  const current = getGuildWelcomeScreen(db, guildId)
  const channels =
    payload.welcome_channels ?? payload.channels ?? current.welcome_channels
  db.prepare(
    `INSERT INTO guild_welcome_screen_settings
       (guild_id, description, channels, enabled, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(guild_id) DO UPDATE SET description = excluded.description,
       channels = excluded.channels, enabled = excluded.enabled,
       updated_at = excluded.updated_at`
  ).run(
    guildId,
    payload.description === undefined
      ? current.description
      : payload.description,
    JSON.stringify(channels),
    payload.enabled === undefined
      ? current.enabled
        ? 1
        : 0
      : payload.enabled
        ? 1
        : 0
  )
  return getGuildWelcomeScreen(db, guildId)
}

/** Gets welcome-screen settings. */
export function getGuildWelcomeScreen(
  db: Database,
  guildId: string
): JsonObject & { welcome_channels: unknown[]; enabled: boolean } {
  const row = db
    .prepare('SELECT * FROM guild_welcome_screen_settings WHERE guild_id = ?')
    .get(guildId) as
    | { description: string | null; channels: string; enabled: number }
    | undefined
  return {
    description: row?.description ?? null,
    welcome_channels: parseJson(row?.channels ?? null, []),
    enabled: row?.enabled === 1,
  }
}

/** Gets or updates widget settings. */
export function setGuildWidget(
  db: Database,
  guildId: string,
  payload: JsonObject
): JsonObject {
  const current = getGuildWidget(db, guildId)
  db.prepare(
    `INSERT INTO guild_widget_settings
       (guild_id, enabled, channel_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled,
       channel_id = excluded.channel_id, updated_at = excluded.updated_at`
  ).run(
    guildId,
    payload.enabled === undefined
      ? current.enabled
        ? 1
        : 0
      : payload.enabled
        ? 1
        : 0,
    payload.channel_id === undefined ? current.channel_id : payload.channel_id
  )
  return getGuildWidget(db, guildId)
}

/** Gets widget settings. */
export function getGuildWidget(
  db: Database,
  guildId: string
): JsonObject & { enabled: boolean; channel_id: string | null } {
  const row = db
    .prepare(
      'SELECT enabled, channel_id FROM guild_widget_settings WHERE guild_id = ?'
    )
    .get(guildId) as { enabled: number; channel_id: string | null } | undefined
  return { enabled: row?.enabled === 1, channel_id: row?.channel_id ?? null }
}

/** Returns a deterministic public widget payload. */
export function getGuildWidgetJson(db: Database, guildId: string): JsonObject {
  const guild = db
    .prepare('SELECT name FROM guilds WHERE id = ?')
    .get(guildId) as { name: string } | undefined
  const channels = db
    .prepare(
      'SELECT id, name, position FROM channels WHERE guild_id = ? ORDER BY position, id'
    )
    .all(guildId)
  const count = (
    db
      .prepare('SELECT COUNT(*) AS count FROM guild_members WHERE guild_id = ?')
      .get(guildId) as { count: number }
  ).count
  return {
    id: guildId,
    name: guild?.name ?? 'Unknown Guild',
    instant_invite: null,
    channels,
    members: [],
    presence_count: count,
  }
}

/** Returns deterministic presentation metadata. */
export function getGuildPresentation(
  db: Database,
  guildId: string
): JsonObject {
  const row = db
    .prepare('SELECT * FROM guild_presentation_settings WHERE guild_id = ?')
    .get(guildId) as
    | {
        vanity_url_code: string | null
        description: string | null
        splash: string | null
        discovery_splash: string | null
        features: string
      }
    | undefined
  return {
    vanity_url_code: row?.vanity_url_code ?? null,
    description: row?.description ?? null,
    splash: row?.splash ?? null,
    discovery_splash: row?.discovery_splash ?? null,
    features: parseJson(row?.features ?? null, []),
  }
}
