/**
 * Channel permissions API routing
 *
 * Implements the /channels/:channelId/permissions/:overwriteId endpoints
 * (create/update and delete a channel permission overwrite).
 */

import { Hono } from 'hono'
import type { Database } from '../database'
import { DiscordErrorCode, validationError } from '../errors'
import {
  getChannel,
  putChannelOverwrite,
  deleteChannelOverwrite,
} from '../services/channels'
import {
  validatePermissionOverwrite,
  normalizePermissionOverwrite,
  type PermissionOverwritePayload,
} from '../validators/channel'
import { requireEntity, parseJsonBody } from '../lib/route-helpers'
import type { AppEnvironment } from '../middleware/auth'

/**
 * Creates the channel permissions API routes.
 * @param database - Database
 * @returns Hono router instance
 */
export function createChannelPermissionRoutes(
  database: Database
): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>()

  // PUT /channels/:channelId/permissions/:overwriteId — Create or update an overwrite
  app.put('/channels/:channelId/permissions/:overwriteId', async (c) => {
    const { channelId, overwriteId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    const payload = (await parseJsonBody(c)) as PermissionOverwritePayload
    const errors = validatePermissionOverwrite(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    putChannelOverwrite(
      database,
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
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    deleteChannelOverwrite(database, channelId, overwriteId)
    return c.body(null, 204)
  })

  return app
}
