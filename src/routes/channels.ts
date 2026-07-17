/**
 * Channels API routing
 *
 * Implements channel CRUD and composes the message/reaction/pin/webhook
 * sub-routers under /channels/*.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import {
  getChannel,
  updateChannel,
  deleteChannel,
  type ChannelUpdatePayload,
} from '../services/channels'
import { getThread } from '../services/threads'
import { validateChannelUpdate } from '../validators/channel'
import type { AppEnv } from '../middleware/auth'
import { requireEntity, parseJsonBody } from '../lib/route-helpers'
import { createChannelPinRoutes } from './channel-pins'
import { createChannelMessageRoutes } from './channel-messages'
import { createChannelReactionRoutes } from './channel-reactions'
import { createChannelWebhookRoutes } from './channel-webhooks'
import { createChannelTypingRoutes } from './channel-typing'
import { createChannelInviteRoutes } from './channel-invites'
import { createChannelPermissionRoutes } from './channel-permissions'
import { createChannelThreadRoutes } from './channel-threads'
import { createChannelFollowRoutes } from './channel-follow'
import { createChannelVoiceStatusRoutes } from './channel-voice-status'

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
    // Threads (types 10/11/12) must include `thread_metadata` (and message/
    // member counts) here — real Discord always does, and object-model
    // client libraries (e.g. Discord.Net) use its presence, not just `type`,
    // to decide whether to construct a thread-shaped model.
    const channel = requireEntity(
      c,
      getThread(db, channelId) ?? getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    return c.json(channel)
  })

  // PATCH /channels/:channelId — Update channel information
  app.patch('/channels/:channelId', async (c) => {
    const { channelId } = c.req.param()
    const payload = (await parseJsonBody(c)) as ChannelUpdatePayload

    const errors = validateChannelUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

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

  // Thread routes. Their paths ("/threads/*", "/thread-members/*", and the
  // 4-segment "/messages/:messageId/threads") do not overlap the message/pin
  // routes, so mount order is not load-bearing here; they are grouped with the
  // other channel sub-routers for readability.
  app.route('/', createChannelThreadRoutes(db))

  // channel-pins MUST be mounted before channel-messages: its literal
  // "/messages/pins" route must win over channel-messages' parameterized
  // "/messages/:messageId" route (Hono is first-match-wins).
  app.route('/', createChannelPinRoutes(db, baseUrl))
  app.route('/', createChannelMessageRoutes(db, baseUrl, uploadPath))
  app.route('/', createChannelReactionRoutes(db, baseUrl))
  app.route('/', createChannelWebhookRoutes(db))
  app.route('/', createChannelTypingRoutes(db))
  app.route('/', createChannelInviteRoutes(db))
  app.route('/', createChannelPermissionRoutes(db))
  app.route('/', createChannelFollowRoutes(db))
  app.route('/', createChannelVoiceStatusRoutes(db))

  return app
}
