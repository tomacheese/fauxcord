/**
 * Channel invites API routing
 *
 * Implements the /channels/:channelId/invites endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, validationError } from '../errors.js'
import { getChannel } from '../services/channels.js'
import { getChannelInvites, createInvite } from '../services/invites.js'
import {
  validateInviteCreate,
  type InviteCreatePayload,
} from '../validators/channel.js'
import type { AppEnv, BotRecord } from '../middleware/auth.js'
import { requireEntity } from '../lib/route-helpers.js'

/**
 * Creates the channel invites API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createChannelInviteRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /channels/:channelId/invites — List a channel's invites
  app.get('/channels/:channelId/invites', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    return c.json(getChannelInvites(db, channelId))
  })

  // POST /channels/:channelId/invites — Create an invite
  app.post('/channels/:channelId/invites', async (c) => {
    const { channelId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    const payload = await c.req
      .json<InviteCreatePayload>()
      .catch((): InviteCreatePayload => ({}))

    const errors = validateInviteCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    // Resolve the inviter from the authenticated bot. Fall back to a direct
    // token lookup when the auth middleware wasn't applied (e.g. unit tests).
    let bot = c.get('bot')
    if (!bot) {
      const authHeader = c.req.header('Authorization')
      if (authHeader) {
        bot = db
          .prepare('SELECT * FROM bots WHERE token = ?')
          .get(authHeader) as BotRecord | undefined
      }
    }

    const invite = createInvite(db, {
      channelId,
      guildId: channel.guild_id,
      inviterId: bot?.user_id ?? null,
      maxAge: payload.max_age ?? undefined,
      maxUses: payload.max_uses ?? undefined,
      temporary: payload.temporary ?? undefined,
    })

    return c.json(invite)
  })

  return app
}
