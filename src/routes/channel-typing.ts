/**
 * Channel typing indicator API routing
 *
 * Implements the trigger-typing-indicator endpoint. Fauxcord has no Gateway,
 * so this is a no-op that only validates the channel exists and returns 204.
 */

import { Hono } from 'hono'
import type { Database } from '../database'
import { DiscordErrorCode } from '../errors'
import { getChannel } from '../services/channels'
import { requireEntity } from '../lib/route-helpers'

/**
 * Creates the channel typing indicator API routes.
 * @param database - Database
 * @returns Hono router instance
 */
export function createChannelTypingRoutes(database: Database): Hono {
  const app = new Hono()

  // POST /channels/:channelId/typing — Trigger the typing indicator.
  // Discord returns 204 No Content (see the module jsdoc for the no-op rationale).
  app.post('/channels/:channelId/typing', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    return c.body(null, 204)
  })

  return app
}
