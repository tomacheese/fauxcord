import { runInTransaction, type Database } from '../db'
import { generateSnowflake } from '../snowflake'

export interface StageInstanceObject {
  guild_id: string
  channel_id: string
  topic: string
  privacy_level: number
  id: string
  discoverable_disabled: boolean
  guild_scheduled_event_id: string | null
}

interface StageInstanceRow {
  id: string
  guild_id: string
  channel_id: string
  topic: string
  privacy_level: number
  discoverable_disabled: number
  guild_scheduled_event_id: string | null
}

function toObject(row: StageInstanceRow): StageInstanceObject {
  return {
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    topic: row.topic,
    privacy_level: row.privacy_level,
    id: row.id,
    discoverable_disabled: row.discoverable_disabled === 1,
    guild_scheduled_event_id: row.guild_scheduled_event_id,
  }
}

export function getStageInstance(
  db: Database,
  channelId: string
): StageInstanceObject | null {
  const row = db
    .prepare('SELECT * FROM stage_instances WHERE channel_id = ?')
    .get(channelId) as StageInstanceRow | undefined
  return row ? toObject(row) : null
}

export function createStageInstance(
  db: Database,
  input: {
    guildId: string
    channelId: string
    topic: string
    privacyLevel?: number
    guildScheduledEventId?: string | null
  }
): StageInstanceObject {
  return runInTransaction(db, () => {
    const id = generateSnowflake()
    db.prepare(
      `INSERT INTO stage_instances
         (id, guild_id, channel_id, topic, privacy_level, guild_scheduled_event_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.guildId,
      input.channelId,
      input.topic,
      input.privacyLevel ?? 2,
      input.guildScheduledEventId ?? null
    )
    const stage = getStageInstance(db, input.channelId)
    if (!stage) throw new Error('created stage instance is missing')
    return stage
  })
}

export function updateStageInstance(
  db: Database,
  channelId: string,
  input: { topic?: string; privacyLevel?: number }
): StageInstanceObject | null {
  return runInTransaction(db, () => {
    const current = getStageInstance(db, channelId)
    if (!current) return null
    db.prepare(
      "UPDATE stage_instances SET topic = ?, privacy_level = ?, updated_at = datetime('now') WHERE channel_id = ?"
    ).run(
      input.topic ?? current.topic,
      input.privacyLevel ?? current.privacy_level,
      channelId
    )
    return getStageInstance(db, channelId)
  })
}

export function deleteStageInstance(db: Database, channelId: string): boolean {
  return runInTransaction(
    db,
    () =>
      db
        .prepare('DELETE FROM stage_instances WHERE channel_id = ?')
        .run(channelId).changes > 0
  )
}
