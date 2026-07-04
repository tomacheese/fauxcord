/**
 * Invites API routing
 *
 * Implements the /invites/:code endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError } from '../errors'
import { getInvite, deleteInvite } from '../services/invites'
import { requireEntity } from '../lib/route-helpers'

/**
 * Creates the invites API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createInviteRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /invites/:code — Retrieve invite information by code
  app.get('/invites/:code', (c) => {
    const { code } = c.req.param()
    const invite = requireEntity(
      c,
      getInvite(db, code),
      DiscordErrorCode.UNKNOWN_INVITE,
      'Unknown Invite'
    )
    if (invite instanceof Response) return invite
    return c.json(invite)
  })

  // DELETE /invites/:code — Delete an invite
  app.delete('/invites/:code', (c) => {
    const { code } = c.req.param()
    const invite = deleteInvite(db, code)
    if (!invite) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_INVITE,
        'Unknown Invite',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(invite)
  })

  return app
}
