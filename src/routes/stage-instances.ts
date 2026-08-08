import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import type { AppEnv } from '../middleware/auth'
import { createStageInstance, deleteStageInstance, getStageInstance, updateStageInstance } from '../services/stage-instances'

const SNOWFLAKE = /^(0|[1-9][0-9]*)$/
const bad = () => validationError({ id: { _errors: [{ code: 'BASE_TYPE_BAD_FORMAT', message: 'Invalid snowflake.' }] } }).body

/** Creates stage instance routes. */
export function createStageInstanceRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.post('/stage-instances', async (c) => {
    const payload = await c.req.json<{ channel_id?: string; topic?: string; privacy_level?: number; guild_scheduled_event_id?: string | null }>().catch(() => ({} as { channel_id?: string; topic?: string; privacy_level?: number; guild_scheduled_event_id?: string | null }))
    if (!payload.channel_id || !SNOWFLAKE.test(payload.channel_id) || !payload.topic || payload.topic.length > 120) return c.json(bad(), 400)
    const channel = db.prepare('SELECT guild_id, type FROM channels WHERE id = ?').get(payload.channel_id) as { guild_id: string | null; type: number } | undefined
    if (!channel?.guild_id || channel.type !== 13) return c.json(discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404).body, 404)
    if (payload.guild_scheduled_event_id && !SNOWFLAKE.test(payload.guild_scheduled_event_id)) return c.json(bad(), 400)
    return c.json(createStageInstance(db, { guildId: channel.guild_id, channelId: payload.channel_id, topic: payload.topic, privacyLevel: payload.privacy_level, guildScheduledEventId: payload.guild_scheduled_event_id }))
  })
  app.get('/stage-instances/:channelId', (c) => {
    const channelId = c.req.param('channelId')
    if (!SNOWFLAKE.test(channelId)) return c.json(bad(), 400)
    const stage = getStageInstance(db, channelId)
    return stage ? c.json(stage) : c.json(discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404).body, 404)
  })
  app.patch('/stage-instances/:channelId', async (c) => {
    const channelId = c.req.param('channelId')
    if (!SNOWFLAKE.test(channelId)) return c.json(bad(), 400)
    const payload = await c.req.json<{ topic?: string; privacy_level?: number }>().catch(() => ({} as { topic?: string; privacy_level?: number }))
    if (payload.topic !== undefined && (payload.topic.length === 0 || payload.topic.length > 120)) return c.json(bad(), 400)
    const stage = updateStageInstance(db, channelId, { topic: payload.topic, privacyLevel: payload.privacy_level })
    return stage ? c.json(stage) : c.json(discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404).body, 404)
  })
  app.delete('/stage-instances/:channelId', (c) => {
    const channelId = c.req.param('channelId')
    if (!SNOWFLAKE.test(channelId)) return c.json(bad(), 400)
    return deleteStageInstance(db, channelId) ? c.body(null, 204) : c.json(discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404).body, 404)
  })
  return app
}
