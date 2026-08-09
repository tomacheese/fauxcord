/**
 * Soundboard API routing
 *
 * Implements GET /soundboard-default-sounds. Bot-authenticated (via the
 * global auth middleware, same as most other non-public endpoints).
 */

import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import type { Database } from '../db'
import { DiscordErrorCode, validationError } from '../errors'
import {
  getDefaultSoundboardSounds,
  recordSoundboardPlayback,
} from '../services/soundboard'
import { parseJsonBody } from '../lib/route-helpers'

const SNOWFLAKE_PATTERN = /^(0|[1-9][0-9]*)$/

/**
 * Creates the Soundboard API routes.
 * @returns Hono router instance
 */
export function createSoundboardRoutes(db?: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /soundboard-default-sounds — Requires Bot authentication
  app.get('/soundboard-default-sounds', (c) => {
    return c.json(getDefaultSoundboardSounds())
  })

  app.post('/channels/:channelId/send-soundboard-sound', async (c) => {
    if (!db) return c.notFound()
    const { channelId } = c.req.param()
    if (!SNOWFLAKE_PATTERN.test(channelId)) {
      return c.json(
        validationError({
          channel_id: {
            _errors: [
              {
                code: 'BASE_TYPE_BAD_FORMAT',
                message: 'Value is not a valid snowflake.',
              },
            ],
          },
        }).body,
        400
      )
    }
    const channel = db
      .prepare(
        `SELECT c.guild_id, c.type, g.bot_token
         FROM channels c LEFT JOIN guilds g ON g.id = c.guild_id
         WHERE c.id = ?`
      )
      .get(channelId) as
      | { guild_id: string | null; type: number; bot_token: string | null }
      | undefined
    if (!channel?.guild_id) {
      return c.json({ message: 'Unknown Channel', code: 10_003 }, 404)
    }
    if (channel.type !== 2 && channel.type !== 13) {
      return c.json({ message: 'Unknown Channel', code: 10_003 }, 404)
    }
    const bot = c.get('bot')
    if (bot?.token !== channel.bot_token) {
      return c.json({ message: 'Missing Access', code: 50_001 }, 403)
    }
    const payload = await parseJsonBody(c)
    if (typeof payload.sound_id !== 'string' || payload.sound_id.length === 0) {
      return c.json(
        validationError({
          sound_id: {
            _errors: [
              {
                code: String(DiscordErrorCode.INVALID_FORM_BODY),
                message: 'This field is required',
              },
            ],
          },
        }).body,
        400
      )
    }
    recordSoundboardPlayback(
      db,
      channelId,
      bot.user_id,
      payload.sound_id,
      typeof payload.source_guild_id === 'string'
        ? payload.source_guild_id
        : undefined
    )
    return c.body(null, 204)
  })

  return app
}
