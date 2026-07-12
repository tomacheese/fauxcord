/**
 * Channel webhooks API routing
 *
 * Implements the /channels/:channelId/webhooks endpoints.
 */

import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import type { Database } from '../database'
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
 * @param database - Database
 * @returns Hono router instance
 */
export function createChannelWebhookRoutes(database: Database): Hono {
  const app = new Hono()

  // GET /channels/:channelId/webhooks — List webhooks for a channel
  app.get('/channels/:channelId/webhooks', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    const webhooks = getChannelWebhooks(database, channelId)
    return c.json(webhooks)
  })

  // POST /channels/:channelId/webhooks — Create a webhook
  app.post('/channels/:channelId/webhooks', async (c) => {
    const { channelId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    const existingWebhooks = getChannelWebhooks(database, channelId)
    if (isChannelWebhookLimitReached(existingWebhooks.length)) {
      const error = discordError(
        DiscordErrorCode.MAX_WEBHOOKS_REACHED,
        'Maximum number of webhooks reached (15)',
        400
      )
      return c.json(error.body, 400)
    }

    const payload = (await parseJsonBody(c)) as unknown as WebhookCreatePayload

    const errors = validateWebhookCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const webhookId = generateSnowflake()
    // Webhook tokens are the only credential guarding the token-based webhook
    // endpoints, so use a CSPRNG rather than predictable sequential Snowflakes.
    const webhookToken = randomBytes(48).toString('base64url')

    const webhook = createWebhook(database, {
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
