/**
 * Guild bans API routing
 *
 * Implements the /guilds/:guildId/bans/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { getGuild } from '../services/guilds'
import {
  getGuildBan,
  getGuildBans,
  createGuildBan,
  removeGuildBan,
} from '../services/guild-bans'
import { validateBanCreate, type BanCreatePayload } from '../validators/guild'
import { requireEntity, parseLimitQuery } from '../lib/route-helpers'

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

    // Tolerate an empty/invalid/non-object JSON body (including a literal
    // `null` or an array, both of which parse without error): treat it as an
    // empty (no-op) payload rather than dereferencing a non-object below
    // (same idiom as PATCH /users/@me).
    const parsed: unknown = await c.req.json().catch(() => ({}))
    const payload: BanCreatePayload =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : {}

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
