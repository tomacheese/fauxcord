/**
 * Channels API routing
 *
 * Implements channel CRUD and composes the message/reaction/pin/webhook
 * sub-routers under /channels/*.
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, discordError } from '../errors.js'
import {
  getChannel,
  updateChannel,
  deleteChannel,
} from '../services/channels.js'
import type { AppEnv } from '../middleware/auth.js'
import { requireEntity } from '../lib/route-helpers.js'
import { createChannelPinRoutes } from './channel-pins.js'
import { createChannelMessageRoutes } from './channel-messages.js'
import { createChannelReactionRoutes } from './channel-reactions.js'
import { createChannelWebhookRoutes } from './channel-webhooks.js'

/**
 * Creates the channels API routes.
 * @param db - Database
 * @param baseUrl - Base URL
 * @param uploadPath - Directory attachments are saved to
 * @returns Hono router instance
 */
export function createChannelRoutes(
  db: Database,
  baseUrl: string,
  uploadPath = '/data/uploads'
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /channels/:channelId — Retrieve channel information
  app.get('/channels/:channelId', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    return c.json(channel)
  })

  // PATCH /channels/:channelId — Update channel information
  app.patch('/channels/:channelId', async (c) => {
    const { channelId } = c.req.param()
    const payload = await c.req.json<{
      name?: string
      topic?: string | null
      nsfw?: boolean
      rate_limit_per_user?: number
      position?: number
    }>()

    const updated = requireEntity(
      c,
      updateChannel(db, channelId, payload),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (updated instanceof Response) return updated
    return c.json(updated)
  })

  // DELETE /channels/:channelId — Delete a channel
  app.delete('/channels/:channelId', (c) => {
    const { channelId } = c.req.param()
    const deleted = deleteChannel(db, channelId)
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(deleted)
  })

  // channel-pins MUST be mounted before channel-messages: its literal
  // "/messages/pins" route must win over channel-messages' parameterized
  // "/messages/:messageId" route (Hono is first-match-wins).
  app.route('/', createChannelPinRoutes(db, baseUrl))
  app.route('/', createChannelMessageRoutes(db, baseUrl, uploadPath))
  app.route('/', createChannelReactionRoutes(db, baseUrl))
  app.route('/', createChannelWebhookRoutes(db))

  return app
}
