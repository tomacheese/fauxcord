/**
 * Channel invites API routing
 *
 * Implements the /channels/:channelId/invites endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { getChannel } from '../services/channels'
import {
  getChannelInvites,
  createInvite,
  setInviteTargetUsers,
} from '../services/invites'
import {
  validateInviteCreate,
  type InviteCreatePayload,
} from '../validators/channel'
import type { AppEnv, BotRecord } from '../middleware/auth'
import { requireEntity } from '../lib/route-helpers'
import { parseTargetUsersCsv } from '../validators/invite-target-users'

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
    const contentType = c.req.header('content-type') ?? ''
    let parsed: unknown
    let targetUsers: { rawCsv: string; userIds: string[] } | undefined
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData()
      const payloadJson = form.get('payload_json')
      const file = form.get('target_users_file')
      try {
        parsed = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : {}
      } catch {
        return c.json(validationError({}).body, 400)
      }
      if (!(file instanceof File)) {
        return c.json(validationError({ target_users_file: {} }).body, 400)
      }
      if (file.size > 25 * 1024 * 1024) {
        return c.json(
          discordError(
            DiscordErrorCode.FILE_TOO_LARGE,
            'File uploaded exceeds the maximum size',
            400
          ).body,
          400
        )
      }
      const rawCsv = await file.text()
      const result = parseTargetUsersCsv(rawCsv)
      if ('errors' in result) {
        return c.json(validationError(result.errors).body, 400)
      }
      targetUsers = { rawCsv, userIds: result.userIds }
    } else {
      try {
        const text = await c.req.text()
        parsed = text.length === 0 ? {} : JSON.parse(text)
      } catch {
        return c.json(validationError({}).body, 400)
      }
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

    if (targetUsers) {
      setInviteTargetUsers(
        db,
        invite.code,
        targetUsers.rawCsv,
        targetUsers.userIds
      )
      return c.body(null, 204)
    }

    return c.json(invite)
  })

  return app
}
