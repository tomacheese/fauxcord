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
  addInviteTargetUsers,
  removeInviteTargetUsers,
  getInviteTargetUsersJobStatus,
} from '../services/invites'
import {
  parseTargetUsersCsv,
  SNOWFLAKE_PATTERN,
} from '../validators/invite-target-users'
import { requireEntity } from '../lib/route-helpers'

/**
 * Extracts the raw `user_ids` array entries from a JSON request body as
 * digit strings, avoiding precision loss from `JSON.parse` on 19-digit
 * Snowflakes. Entries are not yet validated as well-formed Snowflakes —
 * callers must check each one against `SNOWFLAKE_PATTERN`.
 * @param rawBody - Raw request body text
 * @returns The extracted digit strings (empty array if the field is absent)
 */
function extractUserIds(rawBody: string): string[] {
  const match = /"user_ids"\s*:\s*\[([^\]]*)\]/.exec(rawBody)
  return match ? (match[1].match(/\d+/g) ?? []) : []
}

/**
 * Builds the standard validation-error body for an invalid Snowflake ID.
 * @param field - The request field to attach the error to (`user_id` or `user_ids`)
 * @returns Field-keyed error map body
 */
function invalidUserIdsError(field: 'user_id' | 'user_ids') {
  return validationError({
    [field]: {
      _errors: [
        {
          code: 'BASE_TYPE_INVALID',
          message: `${field} must contain only valid Snowflake IDs.`,
        },
      ],
    },
  }).body
}

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

    if (file.size > 25 * 1024 * 1024) {
      const err = discordError(
        DiscordErrorCode.FILE_TOO_LARGE,
        'File uploaded exceeds the maximum size',
        400
      )
      return c.json(err.body, 400)
    }

    const text = await file.text()
    const parsed = parseTargetUsersCsv(text)
    if ('errors' in parsed) {
      return c.json(validationError(parsed.errors).body, 400)
    }

    setInviteTargetUsers(db, code, parsed.userIds)
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

  // POST /invites/:code/target-users/bulk-add — Add multiple target users
  app.post('/invites/:code/target-users/bulk-add', async (c) => {
    const { code } = c.req.param()
    const rawBody = await c.req.text()
    const userIds = extractUserIds(rawBody)
    if (userIds.length === 0 || userIds.length > 1000) {
      return c.json(
        validationError({
          user_ids: {
            _errors: [
              {
                code: 'BASE_TYPE_REQUIRED',
                message: 'user_ids must contain between 1 and 1000 IDs.',
              },
            ],
          },
        }).body,
        400
      )
    }
    if (userIds.some((id) => !SNOWFLAKE_PATTERN.test(id))) {
      return c.json(invalidUserIdsError('user_ids'), 400)
    }
    if (!addInviteTargetUsers(db, code, userIds)) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_INVITE,
        'Unknown Invite',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  // POST /invites/:code/target-users/bulk-delete — Remove multiple target users
  app.post('/invites/:code/target-users/bulk-delete', async (c) => {
    const { code } = c.req.param()
    const rawBody = await c.req.text()
    const userIds = extractUserIds(rawBody)
    if (userIds.length === 0 || userIds.length > 1000) {
      return c.json(
        validationError({
          user_ids: {
            _errors: [
              {
                code: 'BASE_TYPE_REQUIRED',
                message: 'user_ids must contain between 1 and 1000 IDs.',
              },
            ],
          },
        }).body,
        400
      )
    }
    if (userIds.some((id) => !SNOWFLAKE_PATTERN.test(id))) {
      return c.json(invalidUserIdsError('user_ids'), 400)
    }
    if (!removeInviteTargetUsers(db, code, userIds)) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_INVITE,
        'Unknown Invite',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  // PUT /invites/:code/target-users/:user_id — Add a single target user
  app.put('/invites/:code/target-users/:user_id', (c) => {
    const { code, user_id: userId } = c.req.param()
    if (!SNOWFLAKE_PATTERN.test(userId)) {
      return c.json(invalidUserIdsError('user_id'), 400)
    }
    if (!addInviteTargetUsers(db, code, [userId])) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_INVITE,
        'Unknown Invite',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  // DELETE /invites/:code/target-users/:user_id — Remove a single target user
  app.delete('/invites/:code/target-users/:user_id', (c) => {
    const { code, user_id: userId } = c.req.param()
    if (!SNOWFLAKE_PATTERN.test(userId)) {
      return c.json(invalidUserIdsError('user_id'), 400)
    }
    if (!removeInviteTargetUsers(db, code, [userId])) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_INVITE,
        'Unknown Invite',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  return app
}
