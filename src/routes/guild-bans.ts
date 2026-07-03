/**
 * Guild bans API routing
 *
 * Implements the /guilds/:guildId/bans/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, discordError, validationError } from '../errors.js'
import { getGuild } from '../services/guilds.js'
import {
  getGuildBan,
  getGuildBans,
  createGuildBan,
  removeGuildBan,
} from '../services/guild-bans.js'
import { validateBanCreate } from '../validators/guild.js'
import { requireEntity, parseLimitQuery } from '../lib/route-helpers.js'

/**
 * Creates the guild bans API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createGuildBanRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /guilds/:guildId/bans — List a guild's bans
  app.get('/guilds/:guildId/bans', (c) => {
    const { guildId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const limit = parseLimitQuery(c, 1000, 1000)
    const before = c.req.query('before')
    const after = c.req.query('after')

    const bans = getGuildBans(db, guildId, limit, before, after)
    return c.json(bans)
  })

  // GET /guilds/:guildId/bans/:userId — Retrieve a specific ban
  app.get('/guilds/:guildId/bans/:userId', (c) => {
    const { guildId, userId } = c.req.param()

    // Check guild existence first so a missing guild returns Unknown Guild.
    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const ban = requireEntity(
      c,
      getGuildBan(db, guildId, userId),
      DiscordErrorCode.UNKNOWN_BAN,
      'Unknown Ban'
    )
    if (ban instanceof Response) return ban
    return c.json(ban)
  })

  // PUT /guilds/:guildId/bans/:userId — Ban a user from the guild
  app.put('/guilds/:guildId/bans/:userId', async (c) => {
    const { guildId, userId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    // The request body is optional; default to an empty object when absent.
    const payload = await c.req
      .json<{
        delete_message_seconds?: number | null
        delete_message_days?: number | null
      }>()
      .catch(() => ({}))

    const errors = validateBanCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const reason = c.req.header('X-Audit-Log-Reason') ?? null
    createGuildBan(db, guildId, userId, reason)
    return c.body(null, 204)
  })

  // DELETE /guilds/:guildId/bans/:userId — Remove a ban (unban)
  app.delete('/guilds/:guildId/bans/:userId', (c) => {
    const { guildId, userId } = c.req.param()

    // Check guild existence first so a missing guild returns Unknown Guild.
    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const removed = removeGuildBan(db, guildId, userId)
    if (!removed) {
      const err = discordError(DiscordErrorCode.UNKNOWN_BAN, 'Unknown Ban', 404)
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  return app
}
