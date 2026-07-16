/**
 * Guild invites API routing
 *
 * Implements the /guilds/:guildId/invites endpoint.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode } from '../errors'
import { getGuild } from '../services/guilds'
import { getGuildInvites } from '../services/invites'
import { requireEntity } from '../lib/route-helpers'

/**
 * Creates the guild invites API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createGuildInviteRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /guilds/:guildId/invites — List a guild's invites (across all its channels)
  app.get('/guilds/:guildId/invites', (c) => {
    const { guildId } = c.req.param()
    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild
    return c.json(getGuildInvites(db, guildId))
  })

  return app
}
