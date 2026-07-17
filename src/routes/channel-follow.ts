/**
 * Channel follow API routing
 *
 * Implements POST /channels/:channelId/followers (announcement channel
 * following). Creates a webhook in the target channel as the minimal
 * reproduction of Discord's "follow announcement channel" entry point;
 * it does not implement actual cross-channel message forwarding.
 */

import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { generateSnowflake } from '../snowflake'
import { getChannel } from '../services/channels'
import { createWebhook } from '../services/webhooks'
import { requiredError } from '../validators/common'
import { parseJsonBody } from '../lib/route-helpers'

/**
 * Creates the channel follow API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createChannelFollowRoutes(db: Database): Hono {
  const app = new Hono()

  // POST /channels/:channelId/followers — Follow an announcement channel
  app.post('/channels/:channelId/followers', async (c) => {
    const { channelId } = c.req.param()

    const channel = getChannel(db, channelId)
    if (channel?.type !== 5) {
      const err = discordError(
        DiscordErrorCode.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE,
        'Cannot execute action on this channel type',
        400
      )
      return c.json(err.body, 400)
    }

    const payload = (await parseJsonBody(c)) as {
      webhook_channel_id?: unknown
    }
    if (
      typeof payload.webhook_channel_id !== 'string' ||
      payload.webhook_channel_id.length === 0
    ) {
      return c.json(
        validationError({
          webhook_channel_id: { _errors: [requiredError()] },
        }).body,
        400
      )
    }

    const targetChannel = getChannel(db, payload.webhook_channel_id)
    if (!targetChannel) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel',
        404
      )
      return c.json(err.body, 404)
    }

    const webhookId = generateSnowflake()
    const webhookToken = randomBytes(48).toString('base64url')
    const webhook = createWebhook(db, {
      webhookId,
      channelId: targetChannel.id,
      guildId: targetChannel.guild_id,
      name: 'Follower Webhook',
      token: webhookToken,
    })

    return c.json({ channel_id: channelId, webhook_id: webhook.id })
  })

  return app
}
