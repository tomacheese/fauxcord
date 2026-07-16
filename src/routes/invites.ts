/**
 * Invites API routing
 *
 * Implements the /invites/:code endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import {
  getInvite,
  deleteInvite,
  getInviteTargetUsersCsv,
  setInviteTargetUsers,
  getInviteTargetUsersJobStatus,
} from '../services/invites'
import { parseTargetUsersCsv } from '../validators/invite-target-users'
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

  // GET /invites/:code/target-users — Retrieve the target-users CSV
  app.get('/invites/:code/target-users', (c) => {
    const { code } = c.req.param()
    const csv = getInviteTargetUsersCsv(db, code)
    if (csv === null) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_INVITE,
        'Unknown Invite',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(csv, 200, { 'Content-Type': 'text/csv' })
  })

  // PUT /invites/:code/target-users — Replace the target-users CSV
  app.put('/invites/:code/target-users', async (c) => {
    const { code } = c.req.param()
    const invite = requireEntity(
      c,
      getInvite(db, code),
      DiscordErrorCode.UNKNOWN_INVITE,
      'Unknown Invite'
    )
    if (invite instanceof Response) return invite

    const contentType = c.req.header('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      return c.json(
        validationError({
          target_users_file: {
            _errors: [
              {
                code: 'BASE_TYPE_REQUIRED',
                message: 'target_users_file is required.',
              },
            ],
          },
        }).body,
        400
      )
    }

    const formData = await c.req.formData()
    const file = formData.get('target_users_file')
    if (!(file instanceof File)) {
      return c.json(
        validationError({
          target_users_file: {
            _errors: [
              {
                code: 'BASE_TYPE_REQUIRED',
                message: 'target_users_file is required.',
              },
            ],
          },
        }).body,
        400
      )
    }

    const text = await file.text()
    const parsed = parseTargetUsersCsv(text)
    if ('errors' in parsed) {
      return c.json(validationError(parsed.errors).body, 400)
    }

    setInviteTargetUsers(db, code, text, parsed.userIds)
    return c.body(null, 204)
  })

  // GET /invites/:code/target-users/job-status — Retrieve the target-users job status
  app.get('/invites/:code/target-users/job-status', (c) => {
    const { code } = c.req.param()
    const status = getInviteTargetUsersJobStatus(db, code)
    if (status === null) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_INVITE,
        'Unknown Invite',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(status)
  })

  return app
}
