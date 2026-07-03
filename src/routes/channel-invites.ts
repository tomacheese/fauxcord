/**
 * Channel invites API routing
 *
 * Implements the /channels/:channelId/invites endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, discordError, validationError } from '../errors.js'
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

    // DM channels have no guild_id, and invites only make sense for guild
    // channels; reject before touching createInvite (which assumes a guild).
    if (!channel.guild_id) {
      return c.json(
        discordError(
          DiscordErrorCode.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE,
          'Cannot execute action on this channel type',
          400
        ).body,
        400
      )
    }

    // An empty body means "use all defaults"; malformed or non-object JSON
    // must be rejected with 400 rather than silently falling back to
    // defaults, which could otherwise mask a caller's mistake as success.
    // Parsed as `unknown` (not the request's declared type) so the
    // object/null/array checks below are meaningful at compile time too.
    let parsed: unknown
    try {
      const text = await c.req.text()
      parsed = text.length === 0 ? {} : JSON.parse(text)
    } catch {
      return c.json(validationError({}).body, 400)
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return c.json(validationError({}).body, 400)
    }
    const payload = parsed as InviteCreatePayload

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
