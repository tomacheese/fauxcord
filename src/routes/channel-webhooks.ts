/**
 * Channel webhooks API routing
 *
 * Implements the /channels/:channelId/webhooks endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { generateSnowflake } from '../snowflake'
import { getChannel } from '../services/channels'
import { getChannelWebhooks, createWebhook } from '../services/webhooks'
import {
  validateWebhookCreate,
  isChannelWebhookLimitReached,
  type WebhookCreatePayload,
} from '../validators/webhook'
import { requireEntity, parseJsonBody } from '../lib/route-helpers'

/**
 * Creates the channel webhooks API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createChannelWebhookRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /channels/:channelId/webhooks — List webhooks for a channel
  app.get('/channels/:channelId/webhooks', (c) => {
    const { channelId } = c.req.param()
    const webhooks = getChannelWebhooks(db, channelId)
    return c.json(webhooks)
  })

  // POST /channels/:channelId/webhooks — Create a webhook
  app.post('/channels/:channelId/webhooks', async (c) => {
    const { channelId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(db, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    const existingWebhooks = getChannelWebhooks(db, channelId)
    if (isChannelWebhookLimitReached(existingWebhooks.length)) {
      const err = discordError(
        DiscordErrorCode.MAX_WEBHOOKS_REACHED,
        'Maximum number of webhooks reached (15)',
        400
      )
      return c.json(err.body, 400)
    }

    const payload = (await parseJsonBody(c)) as unknown as WebhookCreatePayload

    const errors = validateWebhookCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const webhookId = generateSnowflake()
    const webhookToken = generateSnowflake() + generateSnowflake()

    const webhook = createWebhook(db, {
      webhookId,
      channelId,
      guildId: channel.guild_id,
      name: payload.name,
      avatar: payload.avatar,
      token: webhookToken,
    })

    return c.json(webhook)
  })

  return app
}
