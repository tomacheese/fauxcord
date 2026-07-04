/**
 * Guild roles API routing
 *
 * Implements the /guilds/:guildId/roles/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { generateSnowflake } from '../snowflake'
import { getGuild } from '../services/guilds'
import {
  getGuildRoles,
  createRole,
  updateRole,
  deleteRole,
} from '../services/guild-roles'
import {
  validateRoleCreate,
  validateRoleUpdate,
  GUILD_LIMITS,
  type RoleCreatePayload,
  type RoleUpdatePayload,
} from '../validators/guild'
import { requireEntity, parseJsonBody } from '../lib/route-helpers'

/**
 * Creates the guild roles API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createGuildRoleRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /guilds/:guildId/roles — List a guild's roles
  app.get('/guilds/:guildId/roles', (c) => {
    const { guildId } = c.req.param()
    const roles = getGuildRoles(db, guildId)
    return c.json(roles)
  })

  // POST /guilds/:guildId/roles — Create a role in a guild
  app.post('/guilds/:guildId/roles', async (c) => {
    const { guildId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const roles = getGuildRoles(db, guildId)
    if (roles.length >= GUILD_LIMITS.ROLES_MAX) {
      const err = discordError(
        DiscordErrorCode.MAX_ROLES_REACHED,
        'Maximum number of guild roles reached (250)',
        400
      )
      return c.json(err.body, 400)
    }

    const payload = (await parseJsonBody(c)) as RoleCreatePayload

    const errors = validateRoleCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const roleId = generateSnowflake()
    const role = createRole(db, {
      roleId,
      guildId,
      ...payload,
    })

    return c.json(role)
  })

  // PATCH /guilds/:guildId/roles/:roleId — Update role information
  app.patch('/guilds/:guildId/roles/:roleId', async (c) => {
    const { guildId, roleId } = c.req.param()

    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const payload = (await parseJsonBody(c)) as RoleUpdatePayload

    const errors = validateRoleUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const updated = updateRole(db, guildId, roleId, payload)
    const result = requireEntity(
      c,
      updated,
      DiscordErrorCode.UNKNOWN_ROLE,
      'Unknown Role'
    )
    if (result instanceof Response) return result
    return c.json(result)
  })

  // DELETE /guilds/:guildId/roles/:roleId — Delete a role
  app.delete('/guilds/:guildId/roles/:roleId', (c) => {
    const { guildId, roleId } = c.req.param()

    // The @everyone role (id == guild_id) cannot be deleted
    if (roleId === guildId) {
      const err = discordError(
        DiscordErrorCode.INVALID_ROLE,
        'Invalid role',
        400
      )
      return c.json(err.body, 400)
    }

    const deleted = deleteRole(db, guildId, roleId)
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_ROLE,
        'Unknown Role',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  return app
}
