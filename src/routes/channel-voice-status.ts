/**
 * Channel voice status API routing
 *
 * Implements PUT /channels/:channelId/voice-status. Gateway dispatch
 * (VOICE_CHANNEL_STATUS_UPDATE) is out of scope; this persists the status
 * via REST only (see spec Issue #136).
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { requireEntity, parseJsonBody } from '../lib/route-helpers'
import { getChannel, setVoiceStatus } from '../services/channels'
import { validateVoiceStatus } from '../validators/channel'

/**
 * Creates the channel voice status API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createChannelVoiceStatusRoutes(db: Database): Hono {
  const app = new Hono()

  // PUT /channels/:channelId/voice-status — Set a voice/stage channel's status
  app.put('/channels/:channelId/voice-status', async (c) => {
    const { channelId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    if (channel.type !== 2 && channel.type !== 13) {
      const err = discordError(
        DiscordErrorCode.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE,
        'Cannot execute action on this channel type',
        400
      )
      return c.json(err.body, 400)
    }

    const payload = (await parseJsonBody(c)) as { status?: unknown }
    const errors = validateVoiceStatus(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    setVoiceStatus(
      db,
      channelId,
      payload.status === undefined ? null : (payload.status as string | null)
    )
    return c.body(null, 204)
  })

  return app
}
