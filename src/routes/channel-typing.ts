/**
 * Channel typing indicator API routing
 *
 * Implements the trigger-typing-indicator endpoint. Fauxcord has no Gateway,
 * so this records the latest indicator without simulating its expiry.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode } from '../errors'
import { getChannel } from '../services/channels'
import { requireEntity } from '../lib/route-helpers'

/**
 * Creates the channel typing indicator API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createChannelTypingRoutes(db: Database): Hono {
  const app = new Hono()

  // POST /channels/:channelId/typing — Trigger the typing indicator.
  app.post('/channels/:channelId/typing', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    db.prepare(
      "UPDATE channels SET typing_at = datetime('now') WHERE id = ?"
    ).run(channelId)
    if (channel.type === 3) return c.json({})
    return c.body(null, 204)
  })

  return app
}
