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
import { getChannel } from '../services/channels'
import {
  getDefaultSoundboardSounds,
  recordSoundboardPlayback,
} from '../services/soundboard'
import { parseJsonBody } from '../lib/route-helpers'

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
    if (!getChannel(db, channelId)) {
      return c.json({ message: 'Unknown Channel', code: 10_003 }, 404)
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
    const bot = c.get('bot')
    recordSoundboardPlayback(
      db,
      channelId,
      bot?.user_id ?? '000000000000000000',
      payload.sound_id,
      typeof payload.source_guild_id === 'string'
        ? payload.source_guild_id
        : undefined
    )
    return c.body(null, 204)
  })

  return app
}
