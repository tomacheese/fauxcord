/**
 * Guilds API routing
 *
 * Implements the /guilds/* endpoints (guild CRUD, channels, webhooks) and
 * composes the role/member sub-routers.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { getGuild, updateGuild, deleteGuild } from '../services/guilds'
import { getGuildChannels, createGuildChannel } from '../services/channels'
import { getGuildWebhooks } from '../services/webhooks'
import {
  validateChannelCreate,
  validateGuildName,
  GUILD_LIMITS,
} from '../validators/guild'
import { requireEntity } from '../lib/route-helpers'
import { createGuildRoleRoutes } from './guild-roles'
import { createGuildMemberRoutes } from './guild-members'
import { createGuildEmojiRoutes } from './guild-emojis'
import { createGuildBanRoutes } from './guild-bans'

/**
 * Creates the guilds API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createGuildRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /guilds/:guildId — Retrieve guild information
  app.get('/guilds/:guildId', (c) => {
    const { guildId } = c.req.param()
    const withCounts = c.req.query('with_counts') === 'true'

    const guild = requireEntity(
      c,
      getGuild(db, guildId, withCounts),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild
    return c.json(guild)
  })

  // PATCH /guilds/:guildId — Update guild information
  app.patch('/guilds/:guildId', async (c) => {
    const { guildId } = c.req.param()
    const payload = await c.req.json<{ name?: string }>()

    if (payload.name !== undefined) {
      const errors = validateGuildName(payload.name)
      if (Object.keys(errors).length > 0) {
        return c.json(validationError(errors).body, 400)
      }
    }

    const updated = requireEntity(
      c,
      updateGuild(db, guildId, { name: payload.name }),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (updated instanceof Response) return updated
    return c.json(updated)
  })

  // DELETE /guilds/:guildId — Delete a guild
  app.delete('/guilds/:guildId', (c) => {
    const { guildId } = c.req.param()

    const deleted = deleteGuild(db, guildId)
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        'Unknown Guild',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  // GET /guilds/:guildId/channels — List a guild's channels
  app.get('/guilds/:guildId/channels', (c) => {
    const { guildId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const channels = getGuildChannels(db, guildId)
    return c.json(channels)
  })

  // POST /guilds/:guildId/channels — Create a channel in a guild
  app.post('/guilds/:guildId/channels', async (c) => {
    const { guildId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const channels = getGuildChannels(db, guildId)
    if (channels.length >= GUILD_LIMITS.CHANNELS_MAX) {
      const err = discordError(
        DiscordErrorCode.MAX_CHANNELS_REACHED,
        'Maximum number of guild channels reached (500)',
        400
      )
      return c.json(err.body, 400)
    }

    const payload = await c.req.json<{
      name: string
      type?: number
      topic?: string | null
      nsfw?: boolean
      parent_id?: string | null
      position?: number | null
    }>()

    const errors = validateChannelCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const newChannel = createGuildChannel(db, {
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
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const webhooks = getGuildWebhooks(db, guildId)
    return c.json(webhooks)
  })

  app.route('/', createGuildRoleRoutes(db))
  app.route('/', createGuildMemberRoutes(db))
  app.route('/', createGuildEmojiRoutes(db))
  app.route('/', createGuildBanRoutes(db))

  return app
}
