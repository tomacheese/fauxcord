import { Hono, type Context } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import type { AppEnv } from '../middleware/auth'
import {
  createStageInstance,
  deleteStageInstance,
  getStageInstance,
  updateStageInstance,
} from '../services/stage-instances'

const SNOWFLAKE = /^(0|[1-9][0-9]*)$/
const bad = () =>
  validationError({
    id: {
      _errors: [
        { code: 'BASE_TYPE_BAD_FORMAT', message: 'Invalid snowflake.' },
      ],
    },
  }).body

function missingAccess(c: Context<AppEnv>): Response {
  return c.json(
    discordError(DiscordErrorCode.MISSING_ACCESS, 'Missing Access', 403).body,
    403
  )
}

function ownsGuild(c: Context<AppEnv>, db: Database, guildId: string): boolean {
  const guild = db
    .prepare('SELECT bot_token FROM guilds WHERE id = ?')
    .get(guildId) as { bot_token: string } | undefined
  return guild?.bot_token === c.get('bot')?.token
}

function validPrivacyLevel(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2
}

/** Creates stage instance routes. */
export function createStageInstanceRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.post('/stage-instances', async (c) => {
    const payload: {
      channel_id?: string
      topic?: string
      privacy_level?: number | null
      guild_scheduled_event_id?: string | null
    } = await c.req.json().catch(() => ({}))
    if (
      !payload.channel_id ||
      !SNOWFLAKE.test(payload.channel_id) ||
      typeof payload.topic !== 'string' ||
      payload.topic.length === 0 ||
      payload.topic.length > 120
    )
      return c.json(bad(), 400)
    const channel = db
      .prepare('SELECT guild_id, type FROM channels WHERE id = ?')
      .get(payload.channel_id) as
      { guild_id: string | null; type: number } | undefined
    if (!channel?.guild_id || channel.type !== 13)
      return c.json(
        discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404)
          .body,
        404
      )
    if (!ownsGuild(c, db, channel.guild_id)) return missingAccess(c)
    if (
      payload.guild_scheduled_event_id &&
      !SNOWFLAKE.test(payload.guild_scheduled_event_id)
    )
      return c.json(bad(), 400)
    if (
      payload.privacy_level !== undefined &&
      payload.privacy_level !== null &&
      !validPrivacyLevel(payload.privacy_level)
    )
      return c.json(bad(), 400)
    if (payload.guild_scheduled_event_id) {
      const event = db
        .prepare('SELECT guild_id FROM scheduled_events WHERE id = ?')
        .get(payload.guild_scheduled_event_id) as
        { guild_id: string } | undefined
      if (event?.guild_id !== channel.guild_id) return c.json(bad(), 400)
    }
    return c.json(
      createStageInstance(db, {
        guildId: channel.guild_id,
        channelId: payload.channel_id,
        topic: payload.topic,
        privacyLevel: payload.privacy_level ?? undefined,
        guildScheduledEventId: payload.guild_scheduled_event_id,
      })
    )
  })
  app.get('/stage-instances/:channelId', (c) => {
    const channelId = c.req.param('channelId')
    if (!SNOWFLAKE.test(channelId)) return c.json(bad(), 400)
    const stage = getStageInstance(db, channelId)
    if (!stage)
      return c.json(
        discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404)
          .body,
        404
      )
    if (!ownsGuild(c, db, stage.guild_id)) return missingAccess(c)
    return c.json(stage)
  })
  app.patch('/stage-instances/:channelId', async (c) => {
    const channelId = c.req.param('channelId')
    if (!SNOWFLAKE.test(channelId)) return c.json(bad(), 400)
    const payload: { topic?: string; privacy_level?: number } = await c.req
      .json()
      .catch(() => ({}))
    if (
      payload.topic !== undefined &&
      (typeof payload.topic !== 'string' ||
        payload.topic.length === 0 ||
        payload.topic.length > 120)
    )
      return c.json(bad(), 400)
    if (
      payload.privacy_level !== undefined &&
      !validPrivacyLevel(payload.privacy_level)
    )
      return c.json(bad(), 400)
    const current = getStageInstance(db, channelId)
    if (!current)
      return c.json(
        discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404)
          .body,
        404
      )
    if (!ownsGuild(c, db, current.guild_id)) return missingAccess(c)
    const stage = updateStageInstance(db, channelId, {
      topic: payload.topic,
      privacyLevel: payload.privacy_level,
    })
    return stage
      ? c.json(stage)
      : c.json(
          discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404)
            .body,
          404
        )
  })
  app.delete('/stage-instances/:channelId', (c) => {
    const channelId = c.req.param('channelId')
    if (!SNOWFLAKE.test(channelId)) return c.json(bad(), 400)
    const current = getStageInstance(db, channelId)
    if (!current)
      return c.json(
        discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404)
          .body,
        404
      )
    if (!ownsGuild(c, db, current.guild_id)) return missingAccess(c)
    return deleteStageInstance(db, channelId)
      ? c.body(null, 204)
      : c.json(
          discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404)
            .body,
          404
        )
  })
  return app
}
