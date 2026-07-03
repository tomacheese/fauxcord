/**
 * Channel permissions API routing
 *
 * Implements the /channels/:channelId/permissions/:overwriteId endpoints
 * (create/update and delete a channel permission overwrite).
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, validationError } from '../errors.js'
import {
  getChannel,
  putChannelOverwrite,
  deleteChannelOverwrite,
} from '../services/channels.js'
import {
  validatePermissionOverwrite,
  normalizePermissionOverwrite,
  type PermissionOverwritePayload,
} from '../validators/channel.js'
import { requireEntity } from '../lib/route-helpers.js'
import type { AppEnv } from '../middleware/auth.js'

/**
 * Creates the channel permissions API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createChannelPermissionRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // PUT /channels/:channelId/permissions/:overwriteId — Create or update an overwrite
  app.put('/channels/:channelId/permissions/:overwriteId', async (c) => {
    const { channelId, overwriteId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    const payload = await c.req.json<PermissionOverwritePayload>()
    const errors = validatePermissionOverwrite(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    putChannelOverwrite(
      db,
      channelId,
      overwriteId,
      normalizePermissionOverwrite(payload)
    )
    return c.body(null, 204)
  })

  // DELETE /channels/:channelId/permissions/:overwriteId — Delete an overwrite
  app.delete('/channels/:channelId/permissions/:overwriteId', (c) => {
    const { channelId, overwriteId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    deleteChannelOverwrite(db, channelId, overwriteId)
    return c.body(null, 204)
  })

  return app
}
