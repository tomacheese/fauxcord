/**
 * Channel reactions API routing
 *
 * Implements the /channels/:channelId/messages/:messageId/reactions/* endpoints.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from '../database'
import {
  didAddReaction,
  removeReaction,
  removeEmojiReactions,
  removeAllReactions,
  getReactionUsers,
} from '../services/reactions'
import { getMessage } from '../services/messages'
import { DiscordErrorCode, discordError } from '../errors'
import type { AppEnvironment } from '../middleware/auth'
import { parseLimitQuery } from '../lib/route-helpers'

/**
 * Safely decodes a percent-encoded emoji path segment. Returns a Discord-format
 * 400 error response when the value is malformed, since `decodeURIComponent`
 * throws a `URIError` on invalid percent-encoding (e.g. "%E0%A4%A").
 * @param c - Hono context
 * @param emoji - Raw (percent-encoded) emoji path segment
 * @returns The decoded emoji, or a 400 Response when decoding fails
 */
function decodeEmojiParameter(
  c: Context<AppEnvironment>,
  emoji: string
): string | Response {
  try {
    return decodeURIComponent(emoji)
  } catch {
    const error = discordError(
      DiscordErrorCode.INVALID_FORM_BODY,
      'Invalid emoji',
      400
    )
    return c.json(error.body, 400)
  }
}

/**
 * Creates the channel reactions API routes.
 * @param database - Database
 * @param baseUrl - Base URL, used to build the message existence check
 * @returns Hono router instance
 */
export function createChannelReactionRoutes(
  database: Database,
  baseUrl: string
): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>()

  // PUT /channels/:channelId/messages/:messageId/reactions/:emoji/@me — Add own reaction
  app.put(
    '/channels/:channelId/messages/:messageId/reactions/:emoji/@me',
    (c) => {
      const { messageId, emoji } = c.req.param()
      const bot = c.get('bot')
      const userId = bot?.user_id ?? '000000000000000000'
      const decodedResult = decodeEmojiParameter(c, emoji)
      if (decodedResult instanceof Response) return decodedResult
      const decodedEmoji = decodedResult

      const message = getMessage(database, messageId, baseUrl)
      if (!message) {
        const error = discordError(
          DiscordErrorCode.UNKNOWN_MESSAGE,
          'Unknown Message',
          404
        )
        return c.json(error.body, 404)
      }

      didAddReaction(database, messageId, userId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/@me — Remove own reaction
  app.delete(
    '/channels/:channelId/messages/:messageId/reactions/:emoji/@me',
    (c) => {
      const { messageId, emoji } = c.req.param()
      const bot = c.get('bot')
      const userId = bot?.user_id ?? '000000000000000000'
      const decodedResult = decodeEmojiParameter(c, emoji)
      if (decodedResult instanceof Response) return decodedResult
      const decodedEmoji = decodedResult

      removeReaction(database, messageId, userId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/:userId — Remove a specific user's reaction
  app.delete(
    '/channels/:channelId/messages/:messageId/reactions/:emoji/:userId',
    (c) => {
      const { messageId, emoji, userId } = c.req.param()
      const decodedResult = decodeEmojiParameter(c, emoji)
      if (decodedResult instanceof Response) return decodedResult
      const decodedEmoji = decodedResult

      removeReaction(database, messageId, userId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // GET /channels/:channelId/messages/:messageId/reactions/:emoji — List users who reacted
  app.get('/channels/:channelId/messages/:messageId/reactions/:emoji', (c) => {
    const { messageId, emoji } = c.req.param()
    const decodedResult = decodeEmojiParameter(c, emoji)
    if (decodedResult instanceof Response) return decodedResult
    const decodedEmoji = decodedResult
    const limit = parseLimitQuery(c, 25, 100)
    const after = c.req.query('after')

    const users = getReactionUsers(
      database,
      messageId,
      decodedEmoji,
      limit,
      after
    )
    return c.json(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        discriminator: u.discriminator,
        avatar: u.avatar,
        bot: u.bot === 1,
      }))
    )
  })

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji — Remove all reactions for an emoji
  app.delete(
    '/channels/:channelId/messages/:messageId/reactions/:emoji',
    (c) => {
      const { messageId, emoji } = c.req.param()
      const decodedResult = decodeEmojiParameter(c, emoji)
      if (decodedResult instanceof Response) return decodedResult
      const decodedEmoji = decodedResult
      removeEmojiReactions(database, messageId, decodedEmoji)
      return c.body(null, 204)
    }
  )

  // DELETE /channels/:channelId/messages/:messageId/reactions — Remove all reactions from a message
  app.delete('/channels/:channelId/messages/:messageId/reactions', (c) => {
    const { messageId } = c.req.param()
    removeAllReactions(database, messageId)
    return c.body(null, 204)
  })

  return app
}
