/**
 * Channel polls API routing
 *
 * Implements GET /channels/:channelId/polls/:messageId/answers/:answerId
 * (poll answer voters).
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError } from '../errors'
import { getPollAnswerVoters } from '../services/polls'
import { parseLimitQuery } from '../lib/route-helpers'

/**
 * Creates the channel polls API routes.
 * @param db - Database
 * @param _baseUrl - Base URL (unused by this task's routes)
 * @returns Hono router instance
 */
export function createChannelPollRoutes(
  db: Database,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _baseUrl: string
): Hono {
  const app = new Hono()

  // GET /channels/:channelId/polls/:messageId/answers/:answerId — Get Answer Voters
  app.get('/channels/:channelId/polls/:messageId/answers/:answerId', (c) => {
    const { messageId, answerId } = c.req.param()
    const limit = parseLimitQuery(c, 25, 100)
    const after = c.req.query('after')

    const voters = getPollAnswerVoters(
      db,
      messageId,
      Number.parseInt(answerId, 10),
      limit,
      after
    )
    if (voters === 'UNKNOWN_MESSAGE') {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
        404
      )
      return c.json(err.body, 404)
    }

    return c.json({ users: voters })
  })

  return app
}
