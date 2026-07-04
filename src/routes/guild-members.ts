/**
 * Guild members API routing
 *
 * Implements the /guilds/:guildId/members/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { getGuild } from '../services/guilds'
import { getRole } from '../services/guild-roles'
import {
  getGuildMember,
  getGuildMembers,
  updateGuildMember,
  removeGuildMember,
  addMemberRole,
  removeMemberRole,
} from '../services/guild-members'
import {
  validateGuildMemberUpdate,
  type GuildMemberUpdatePayload,
} from '../validators/guild'
import {
  requireEntity,
  parseLimitQuery,
  parseJsonBody,
} from '../lib/route-helpers'

/**
 * Creates the guild members API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createGuildMemberRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /guilds/:guildId/members — List a guild's members
  app.get('/guilds/:guildId/members', (c) => {
    const { guildId } = c.req.param()
    const limit = parseLimitQuery(c, 1, 1000)
    const after = c.req.query('after') ?? '0'

    const members = getGuildMembers(db, guildId, limit, after)
    return c.json(members)
  })

  // GET /guilds/:guildId/members/:userId — Retrieve a specific guild member
  app.get('/guilds/:guildId/members/:userId', (c) => {
    const { guildId, userId } = c.req.param()

    const member = requireEntity(
      c,
      getGuildMember(db, guildId, userId),
      DiscordErrorCode.UNKNOWN_MEMBER,
      'Unknown Member'
    )
    if (member instanceof Response) return member
    return c.json(member)
  })

  // PATCH /guilds/:guildId/members/:userId — Update member information
  app.patch('/guilds/:guildId/members/:userId', async (c) => {
    const { guildId, userId } = c.req.param()

    const payload = (await parseJsonBody(c)) as GuildMemberUpdatePayload

    const errors = validateGuildMemberUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    if (payload.roles !== undefined) {
      for (const roleId of payload.roles) {
        if (!getRole(db, guildId, roleId)) {
          const err = discordError(
            DiscordErrorCode.UNKNOWN_ROLE,
            'Unknown Role',
            404
          )
          return c.json(err.body, 404)
        }
      }
    }

    const updated = updateGuildMember(db, guildId, userId, payload)
    const result = requireEntity(
      c,
      updated,
      DiscordErrorCode.UNKNOWN_MEMBER,
      'Unknown Member'
    )
    if (result instanceof Response) return result
    return c.json(result)
  })

  // PUT /guilds/:guildId/members/:userId/roles/:roleId — Add a role to a member
  app.put('/guilds/:guildId/members/:userId/roles/:roleId', (c) => {
    const { guildId, userId, roleId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    if (roleId === guildId) {
      const err = discordError(
        DiscordErrorCode.INVALID_ROLE,
        'Invalid role',
        400
      )
      return c.json(err.body, 400)
    }

    if (!getRole(db, guildId, roleId)) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_ROLE,
        'Unknown Role',
        404
      )
      return c.json(err.body, 404)
    }

    const ok = addMemberRole(db, guildId, userId, roleId)
    if (!ok) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MEMBER,
        'Unknown Member',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  // DELETE /guilds/:guildId/members/:userId/roles/:roleId — Remove a role from a member
  app.delete('/guilds/:guildId/members/:userId/roles/:roleId', (c) => {
    const { guildId, userId, roleId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    if (roleId === guildId) {
      const err = discordError(
        DiscordErrorCode.INVALID_ROLE,
        'Invalid role',
        400
      )
      return c.json(err.body, 400)
    }

    if (!getRole(db, guildId, roleId)) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_ROLE,
        'Unknown Role',
        404
      )
      return c.json(err.body, 404)
    }

    const ok = removeMemberRole(db, guildId, userId, roleId)
    if (!ok) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MEMBER,
        'Unknown Member',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  // DELETE /guilds/:guildId/members/:userId — Kick a member
  app.delete('/guilds/:guildId/members/:userId', (c) => {
    const { guildId, userId } = c.req.param()

    const removed = removeGuildMember(db, guildId, userId)
    if (!removed) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MEMBER,
        'Unknown Member',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  return app
}
