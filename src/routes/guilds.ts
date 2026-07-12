/**
 * Guilds API routing
 *
 * Implements the /guilds/* endpoints (guild CRUD, channels, webhooks) and
 * composes the role/member sub-routers.
 */

import { Hono } from 'hono'
import type { Database } from '../database'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { getGuild, updateGuild, didDeleteGuild } from '../services/guilds'
import { getGuildChannels, createGuildChannel } from '../services/channels'
import { getGuildWebhooks } from '../services/webhooks'
import {
  validateChannelCreate,
  validateGuildName,
  GUILD_LIMITS,
  type ChannelCreatePayload,
} from '../validators/guild'
import { requireEntity, parseJsonBody } from '../lib/route-helpers'
import { createGuildRoleRoutes } from './guild-roles'
import { createGuildMemberRoutes } from './guild-members'
import { createGuildEmojiRoutes } from './guild-emojis'
import { createGuildBanRoutes } from './guild-bans'

/**
 * Creates the guilds API routes.
 * @param database - Database
 * @returns Hono router instance
 */
export function createGuildRoutes(database: Database): Hono {
  const app = new Hono()

  // GET /guilds/:guildId — Retrieve guild information
  app.get('/guilds/:guildId', (c) => {
    const { guildId } = c.req.param()
    const isWithCounts = c.req.query('with_counts') === 'true'

    const guild = requireEntity(
      c,
      getGuild(database, guildId, isWithCounts),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild
    return c.json(guild)
  })

  // PATCH /guilds/:guildId — Update guild information
  app.patch('/guilds/:guildId', async (c) => {
    const { guildId } = c.req.param()

    // Tolerate an empty/invalid/non-object JSON body (including a literal
    // `null` or an array, both of which parse without error): treat it as an
    // empty (no-op) payload rather than crashing on JSON.parse of an empty
    // body (same idiom as PATCH /users/@me and POST .../bans).
    let parsed: unknown
    try {
      parsed = await c.req.json()
    } catch {
      parsed = {}
    }
    const payload: { name?: string } =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : {}

    if (payload.name !== undefined) {
      const errors = validateGuildName(payload.name)
      if (Object.keys(errors).length > 0) {
        return c.json(validationError(errors).body, 400)
      }
    }

    const updated = requireEntity(
      c,
      updateGuild(database, guildId, { name: payload.name }),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (updated instanceof Response) return updated
    return c.json(updated)
  })

  // DELETE /guilds/:guildId — Delete a guild
  app.delete('/guilds/:guildId', (c) => {
    const { guildId } = c.req.param()

    const isDeleted = didDeleteGuild(database, guildId)
    if (!isDeleted) {
      const error = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        'Unknown Guild',
        404
      )
      return c.json(error.body, 404)
    }
    return c.body(null, 204)
  })

  // GET /guilds/:guildId/channels — List a guild's channels
  app.get('/guilds/:guildId/channels', (c) => {
    const { guildId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(database, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const channels = getGuildChannels(database, guildId)
    return c.json(channels)
  })

  // POST /guilds/:guildId/channels — Create a channel in a guild
  app.post('/guilds/:guildId/channels', async (c) => {
    const { guildId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(database, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const channels = getGuildChannels(database, guildId)
    if (channels.length >= GUILD_LIMITS.CHANNELS_MAX) {
      const error = discordError(
        DiscordErrorCode.MAX_CHANNELS_REACHED,
        'Maximum number of guild channels reached (500)',
        400
      )
      return c.json(error.body, 400)
    }

    const payload = (await parseJsonBody(c)) as unknown as ChannelCreatePayload

    const errors = validateChannelCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const newChannel = createGuildChannel(database, {
      guildId,
      name: payload.name,
      type: payload.type,
      topic: payload.topic,
      nsfw: payload.nsfw,
      parentId: payload.parent_id,
      position: payload.position ?? channels.length,
    })

    return c.json(newChannel, 201)
  })

  // GET /guilds/:guildId/webhooks — List a guild's webhooks
  app.get('/guilds/:guildId/webhooks', (c) => {
    const { guildId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(database, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const webhooks = getGuildWebhooks(database, guildId)
    return c.json(webhooks)
  })

  app.route('/', createGuildRoleRoutes(database))
  app.route('/', createGuildMemberRoutes(database))
  app.route('/', createGuildEmojiRoutes(database))
  app.route('/', createGuildBanRoutes(database))

  return app
}
