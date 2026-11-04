/**
 * Channel permissions API routing
 *
 * Implements the /channels/:channelId/permissions/:overwriteId endpoints
 * (create/update and delete a channel permission overwrite).
 */

import { Hono, type Context } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import {
  getChannel,
  putChannelOverwrite,
  deleteChannelOverwrite,
  type ChannelObject,
} from '../services/channels'
import {
  getChannelMemberPermissions,
  getChannelRolePermissions,
} from '../services/permissions'
import {
  validatePermissionOverwrite,
  normalizePermissionOverwrite,
  type PermissionOverwritePayload,
} from '../validators/channel'
import { requireEntity, parseJsonBody } from '../lib/route-helpers'
import type { AppEnv } from '../middleware/auth'

/**
 * Resolves a channel that belongs to a guild, or a 404 response.
 * A channel without a guild (e.g. a DM) is reported as unknown because
 * permissions only exist inside guilds.
 * @param c - Hono context
 * @param db - Database
 * @param channelId - Channel ID
 * @returns The channel with a non-null guild_id, or a 404 Response
 */
function requireGuildChannel(
  c: Context<AppEnv>,
  db: Database,
  channelId: string
): (ChannelObject & { guild_id: string }) | Response {
  const channel = requireEntity(
    c,
    getChannel(db, channelId),
    DiscordErrorCode.UNKNOWN_CHANNEL,
    'Unknown Channel'
  )
  if (channel instanceof Response) return channel
  if (channel.guild_id === null) {
    return c.json(
      discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404)
        .body,
      404
    )
  }
  return { ...channel, guild_id: channel.guild_id }
}

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

    const payload = (await parseJsonBody(c)) as PermissionOverwritePayload
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

  // GET /channels/:channelId/permissions/member/:userId — Computed member permissions
  app.get('/channels/:channelId/permissions/member/:userId', (c) => {
    const { channelId, userId } = c.req.param()

    const channel = requireGuildChannel(c, db, channelId)
    if (channel instanceof Response) return channel

    const permissions = getChannelMemberPermissions(
      db,
      channel.guild_id,
      channelId,
      userId
    )
    return permissions === null
      ? c.json(
          discordError(DiscordErrorCode.UNKNOWN_MEMBER, 'Unknown Member', 404)
            .body,
          404
        )
      : c.json({ permissions: permissions.toString() })
  })

  // GET /channels/:channelId/permissions/role/:roleId — Computed role permissions
  app.get('/channels/:channelId/permissions/role/:roleId', (c) => {
    const { channelId, roleId } = c.req.param()

    const channel = requireGuildChannel(c, db, channelId)
    if (channel instanceof Response) return channel

    const permissions = getChannelRolePermissions(
      db,
      channel.guild_id,
      channelId,
      roleId
    )
    return permissions === null
      ? c.json(
          discordError(DiscordErrorCode.UNKNOWN_ROLE, 'Unknown Role', 404).body,
          404
        )
      : c.json({ permissions: permissions.toString() })
  })

  return app
}
