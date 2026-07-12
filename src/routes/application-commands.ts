/**
 * Application Commands API routing
 *
 * Implements global and guild-scoped command CRUD, bulk overwrite, and
 * command permission endpoints under /applications/*.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from '../db'
import type { AppEnv } from '../middleware/auth'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import {
  getCommands,
  getCommand,
  createCommand,
  updateCommand,
  deleteCommand,
  bulkOverwriteCommands,
  getAllCommandPermissions,
  getCommandPermissions,
  setCommandPermissions,
  normalizeName,
} from '../services/application-commands'
import { validateApplicationCommandCreate } from '../validators/application-command'
import type { ApplicationCommandCreatePayload } from '../validators/application-command'
import { getGuild } from '../services/guilds'

/** Shared 400 body for a name-collision on create/update */
const DUPLICATE_NAME_ERROR = validationError({
  name: {
    _errors: [
      {
        code: 'APPLICATION_COMMAND_NAME_ALREADY_EXISTS',
        message: 'A command with that name already exists.',
      },
    ],
  },
}).body

/**
 * Returns a 403 Missing Access response unless the authenticated bot owns
 * `applicationId` (the mock's convention: application_id === bot.user_id).
 * @param c - Hono context
 * @param applicationId - `:applicationId` route param
 * @returns A 403 Response, or undefined when access is allowed
 */
function requireOwnApplication(
  c: Context<AppEnv>,
  applicationId: string
): Response | undefined {
  const bot = c.get('bot')
  if (bot?.user_id !== applicationId) {
    const err = discordError(
      DiscordErrorCode.MISSING_ACCESS,
      'Missing Access',
      403
    )
    return c.json(err.body, 403)
  }
  return undefined
}

/**
 * Checks a bulk-overwrite payload for two or more entries sharing the same
 * `(type, name)` key -- without this check, such a payload would reach
 * `bulkOverwriteCommands`'s `INSERT`, which enforces the same uniqueness at
 * the DB layer and throws an unhandled error instead of a validation
 * response.
 * @param payloads - The full bulk-overwrite payload
 * @returns true if any two entries collide on `(type, name)`
 */
function hasDuplicateNameInPayload(
  payloads: ApplicationCommandCreatePayload[]
): boolean {
  const seen = new Set<string>()
  for (const payload of payloads) {
    const type = payload.type ?? 1
    const key = `${type}:${normalizeName(payload.name, type)}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/**
 * Creates the Application Commands API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createApplicationCommandRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /applications/:applicationId/commands — list global commands
  app.get('/applications/:applicationId/commands', (c) => {
    const { applicationId } = c.req.param()
    const denied = requireOwnApplication(c, applicationId)
    if (denied) return denied
    return c.json(getCommands(db, applicationId, null))
  })

  // PUT /applications/:applicationId/commands — bulk overwrite global commands
  app.put('/applications/:applicationId/commands', async (c) => {
    const { applicationId } = c.req.param()
    const denied = requireOwnApplication(c, applicationId)
    if (denied) return denied

    const payloads = await c.req.json<ApplicationCommandCreatePayload[]>()
    for (const payload of payloads) {
      const errors = validateApplicationCommandCreate(payload)
      if (Object.keys(errors).length > 0) {
        return c.json(validationError(errors).body, 400)
      }
    }
    if (hasDuplicateNameInPayload(payloads)) {
      return c.json(DUPLICATE_NAME_ERROR, 400)
    }
    return c.json(bulkOverwriteCommands(db, applicationId, null, payloads))
  })

  // POST /applications/:applicationId/commands — create a global command
  app.post('/applications/:applicationId/commands', async (c) => {
    const { applicationId } = c.req.param()
    const denied = requireOwnApplication(c, applicationId)
    if (denied) return denied

    const payload = await c.req.json<ApplicationCommandCreatePayload>()
    const errors = validateApplicationCommandCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const result = createCommand(db, applicationId, null, payload)
    if (!result.ok) return c.json(DUPLICATE_NAME_ERROR, 400)
    return c.json(result.command, 201)
  })

  // GET /applications/:applicationId/commands/:commandId
  app.get('/applications/:applicationId/commands/:commandId', (c) => {
    const { applicationId, commandId } = c.req.param()
    const denied = requireOwnApplication(c, applicationId)
    if (denied) return denied

    const command = getCommand(db, applicationId, null, commandId)
    if (!command) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_APPLICATION_COMMAND,
        'Unknown Application Command',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(command)
  })

  // PATCH /applications/:applicationId/commands/:commandId
  app.patch('/applications/:applicationId/commands/:commandId', async (c) => {
    const { applicationId, commandId } = c.req.param()
    const denied = requireOwnApplication(c, applicationId)
    if (denied) return denied

    const payload = await c.req.json<Partial<ApplicationCommandCreatePayload>>()
    const result = updateCommand(db, applicationId, null, commandId, payload)
    if (!result.ok) {
      if (result.reason === 'not_found') {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_APPLICATION_COMMAND,
          'Unknown Application Command',
          404
        )
        return c.json(err.body, 404)
      }
      return c.json(DUPLICATE_NAME_ERROR, 400)
    }
    return c.json(result.command)
  })

  // DELETE /applications/:applicationId/commands/:commandId
  app.delete('/applications/:applicationId/commands/:commandId', (c) => {
    const { applicationId, commandId } = c.req.param()
    const denied = requireOwnApplication(c, applicationId)
    if (denied) return denied

    const deleted = deleteCommand(db, applicationId, null, commandId)
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_APPLICATION_COMMAND,
        'Unknown Application Command',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  // ── Guild-scoped commands ─────────────────────────────────────────────

  // GET /applications/:applicationId/guilds/:guildId/commands
  app.get('/applications/:applicationId/guilds/:guildId/commands', (c) => {
    const { applicationId, guildId } = c.req.param()
    const denied = requireOwnApplication(c, applicationId)
    if (denied) return denied
    if (!getGuild(db, guildId)) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        'Unknown Guild',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(getCommands(db, applicationId, guildId))
  })

  // PUT /applications/:applicationId/guilds/:guildId/commands
  app.put(
    '/applications/:applicationId/guilds/:guildId/commands',
    async (c) => {
      const { applicationId, guildId } = c.req.param()
      const denied = requireOwnApplication(c, applicationId)
      if (denied) return denied
      if (!getGuild(db, guildId)) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_GUILD,
          'Unknown Guild',
          404
        )
        return c.json(err.body, 404)
      }

      const payloads = await c.req.json<ApplicationCommandCreatePayload[]>()
      for (const payload of payloads) {
        const errors = validateApplicationCommandCreate(payload)
        if (Object.keys(errors).length > 0) {
          return c.json(validationError(errors).body, 400)
        }
      }
      if (hasDuplicateNameInPayload(payloads)) {
        return c.json(DUPLICATE_NAME_ERROR, 400)
      }
      return c.json(bulkOverwriteCommands(db, applicationId, guildId, payloads))
    }
  )

  // POST /applications/:applicationId/guilds/:guildId/commands
  app.post(
    '/applications/:applicationId/guilds/:guildId/commands',
    async (c) => {
      const { applicationId, guildId } = c.req.param()
      const denied = requireOwnApplication(c, applicationId)
      if (denied) return denied
      if (!getGuild(db, guildId)) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_GUILD,
          'Unknown Guild',
          404
        )
        return c.json(err.body, 404)
      }

      const payload = await c.req.json<ApplicationCommandCreatePayload>()
      const errors = validateApplicationCommandCreate(payload)
      if (Object.keys(errors).length > 0) {
        return c.json(validationError(errors).body, 400)
      }

      const result = createCommand(db, applicationId, guildId, payload)
      if (!result.ok) return c.json(DUPLICATE_NAME_ERROR, 400)
      return c.json(result.command, 201)
    }
  )

  // GET /applications/:applicationId/guilds/:guildId/commands/permissions
  // Registered before GET .../commands/:commandId below (Hono is
  // first-match-wins), so the literal "permissions" segment is never
  // mistaken for a commandId.
  app.get(
    '/applications/:applicationId/guilds/:guildId/commands/permissions',
    (c) => {
      const { applicationId, guildId } = c.req.param()
      const denied = requireOwnApplication(c, applicationId)
      if (denied) return denied
      if (!getGuild(db, guildId)) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_GUILD,
          'Unknown Guild',
          404
        )
        return c.json(err.body, 404)
      }
      return c.json(getAllCommandPermissions(db, applicationId, guildId))
    }
  )

  // GET /applications/:applicationId/guilds/:guildId/commands/:commandId
  app.get(
    '/applications/:applicationId/guilds/:guildId/commands/:commandId',
    (c) => {
      const { applicationId, guildId, commandId } = c.req.param()
      const denied = requireOwnApplication(c, applicationId)
      if (denied) return denied

      const command = getCommand(db, applicationId, guildId, commandId)
      if (!command) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_APPLICATION_COMMAND,
          'Unknown Application Command',
          404
        )
        return c.json(err.body, 404)
      }
      return c.json(command)
    }
  )

  // PATCH /applications/:applicationId/guilds/:guildId/commands/:commandId
  app.patch(
    '/applications/:applicationId/guilds/:guildId/commands/:commandId',
    async (c) => {
      const { applicationId, guildId, commandId } = c.req.param()
      const denied = requireOwnApplication(c, applicationId)
      if (denied) return denied

      const payload =
        await c.req.json<Partial<ApplicationCommandCreatePayload>>()
      const result = updateCommand(
        db,
        applicationId,
        guildId,
        commandId,
        payload
      )
      if (!result.ok) {
        if (result.reason === 'not_found') {
          const err = discordError(
            DiscordErrorCode.UNKNOWN_APPLICATION_COMMAND,
            'Unknown Application Command',
            404
          )
          return c.json(err.body, 404)
        }
        return c.json(DUPLICATE_NAME_ERROR, 400)
      }
      return c.json(result.command)
    }
  )

  // DELETE /applications/:applicationId/guilds/:guildId/commands/:commandId
  app.delete(
    '/applications/:applicationId/guilds/:guildId/commands/:commandId',
    (c) => {
      const { applicationId, guildId, commandId } = c.req.param()
      const denied = requireOwnApplication(c, applicationId)
      if (denied) return denied

      const deleted = deleteCommand(db, applicationId, guildId, commandId)
      if (!deleted) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_APPLICATION_COMMAND,
          'Unknown Application Command',
          404
        )
        return c.json(err.body, 404)
      }
      return c.body(null, 204)
    }
  )

  // GET /applications/:applicationId/guilds/:guildId/commands/:commandId/permissions
  app.get(
    '/applications/:applicationId/guilds/:guildId/commands/:commandId/permissions',
    (c) => {
      const { applicationId, guildId, commandId } = c.req.param()
      const denied = requireOwnApplication(c, applicationId)
      if (denied) return denied

      const permissions = getCommandPermissions(
        db,
        applicationId,
        guildId,
        commandId
      )
      if (!permissions) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_APPLICATION_COMMAND,
          'Unknown Application Command',
          404
        )
        return c.json(err.body, 404)
      }
      return c.json(permissions)
    }
  )

  // PUT /applications/:applicationId/guilds/:guildId/commands/:commandId/permissions
  app.put(
    '/applications/:applicationId/guilds/:guildId/commands/:commandId/permissions',
    async (c) => {
      const { applicationId, guildId, commandId } = c.req.param()
      const denied = requireOwnApplication(c, applicationId)
      if (denied) return denied

      const command =
        getCommand(db, applicationId, guildId, commandId) ??
        getCommand(db, applicationId, null, commandId)
      if (!command) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_APPLICATION_COMMAND,
          'Unknown Application Command',
          404
        )
        return c.json(err.body, 404)
      }

      const payload = await c.req.json<{
        permissions: { id: string; type: number; permission: boolean }[]
      }>()
      return c.json(
        setCommandPermissions(
          db,
          applicationId,
          guildId,
          commandId,
          payload.permissions
        )
      )
    }
  )

  return app
}
