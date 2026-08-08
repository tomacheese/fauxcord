/**
 * Soundboard operations service
 *
 * Fauxcord does not model any soundboard sound data (no upload/storage
 * pipeline for the underlying audio), so this always returns an empty
 * result. This still satisfies the spec's response shape and unblocks
 * clients that call the endpoint unconditionally as part of their startup
 * sequence (see the Pycord Gateway compat finding referenced from
 * `.superpowers/sdd/decisions.md`).
 */

// Used for compile-time type drift detection.
import type { RESTGetAPISoundboardDefaultSoundsResult } from 'discord-api-types/v10'
import type { Database } from '../db'
import { generateSnowflake } from '../snowflake'

/**
 * Returns the list of default soundboard sounds for GET /soundboard-default-sounds.
 * @returns An empty array (Fauxcord has no default soundboard sound data)
 */
export function getDefaultSoundboardSounds(): RESTGetAPISoundboardDefaultSoundsResult {
  return []
}

function ensurePlaybackTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_soundboard_playbacks (
      id         TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sound_id   TEXT NOT NULL,
      source_guild_id TEXT REFERENCES guilds(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_soundboard_playbacks_channel
      ON channel_soundboard_playbacks(channel_id, id);
  `)
}

/** Records a local soundboard playback audit entry. */
export function recordSoundboardPlayback(
  db: Database,
  channelId: string,
  userId: string,
  soundId: string,
  sourceGuildId?: string
): void {
  ensurePlaybackTable(db)
  db.prepare(
    `INSERT INTO channel_soundboard_playbacks
       (id, channel_id, user_id, sound_id, source_guild_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(generateSnowflake(), channelId, userId, soundId, sourceGuildId ?? null)
}

/** Returns the number of locally recorded playbacks for a channel. */
export function countSoundboardPlaybacks(
  db: Database,
  channelId: string
): number {
  ensurePlaybackTable(db)
  return (
    db
      .prepare(
        'SELECT COUNT(*) AS count FROM channel_soundboard_playbacks WHERE channel_id = ?'
      )
      .get(channelId) as { count: number }
  ).count
}
