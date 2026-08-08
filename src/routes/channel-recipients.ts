/**
 * Channel recipients API routing
 *
 * Implements PUT/DELETE /channels/:channelId/recipients/:userId
 * (group-DM membership). Gateway dispatch for recipient add/remove is out
 * of scope (see spec Issue #136).
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError } from '../errors'
import {
  getChannel,
  addChannelRecipient,
  removeChannelRecipient,
} from '../services/channels'

/**
 * Creates the channel recipients API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createChannelRecipientRoutes(db: Database): Hono {
  const app = new Hono()

  // PUT /channels/:channelId/recipients/:userId — Add a group-DM recipient
  app.put('/channels/:channelId/recipients/:userId', async (c) => {
    const { channelId, userId } = c.req.param()

    const channel = getChannel(db, channelId)
    if (channel?.type !== 3) {
      const err = discordError(
        DiscordErrorCode.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE,
        'Cannot execute action on this channel type',
        400
      )
      return c.json(err.body, 400)
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
    if (!user) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_USER,
        'Unknown User',
        404
      )
      return c.json(err.body, 404)
    }

    addChannelRecipient(db, channelId, userId)
    if ((c.req.header('content-type') ?? '').includes('application/json')) {
      await c.req.json()
      return c.json(getChannel(db, channelId), 201)
    }
    return c.body(null, 204)
  })

  // DELETE /channels/:channelId/recipients/:userId — Remove a group-DM recipient
  app.delete('/channels/:channelId/recipients/:userId', (c) => {
    const { channelId, userId } = c.req.param()

    const channel = getChannel(db, channelId)
    if (channel?.type !== 3) {
      const err = discordError(
        DiscordErrorCode.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE,
        'Cannot execute action on this channel type',
        400
      )
      return c.json(err.body, 400)
    }

    removeChannelRecipient(db, channelId, userId)
    return c.body(null, 204)
  })

  return app
}
