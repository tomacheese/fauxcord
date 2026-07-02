/**
 * Channel pins API routing
 *
 * Implements both the legacy (/channels/:channelId/pins...) and new-format
 * (/channels/:channelId/messages/pins...) pin endpoints.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, discordError } from '../errors.js'
import {
  getPinnedMessages,
  pinMessage,
  unpinMessage,
} from '../services/pins.js'

/**
 * Builds the Hono response for a `pinMessage()` result code.
 * @param c - Hono context
 * @param result - Result code returned by `pinMessage()`
 * @returns 204 on success, or the Discord error response matching the code
 */
function respondToPinResult(
  c: Context,
  result: 0 | 10_008 | 40_041 | 30_003 | 50_019
) {
  switch (result) {
    case 10_008: {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        'Unknown Message',
        404
      )
      return c.json(err.body, 404)
    }
    case 40_041: {
      const err = discordError(
        DiscordErrorCode.ALREADY_PINNED,
        'This message was already pinned',
        400
      )
      return c.json(err.body, 400)
    }
    case 30_003: {
      const err = discordError(
        DiscordErrorCode.MAX_PINS_REACHED,
        'Maximum number of pins reached for the channel (50)',
        400
      )
      return c.json(err.body, 400)
    }
    case 50_019: {
      const err = discordError(
        DiscordErrorCode.WRONG_PIN_CHANNEL,
        'A message can only be pinned to the channel it was sent in',
        403
      )
      return c.json(err.body, 403)
    }
    default: {
      return c.body(null, 204)
    }
  }
}

/**
 * Creates the channel pins API routes (legacy and new-format).
 * @param db - Database
 * @param baseUrl - Base URL
 * @returns Hono router instance
 */
export function createChannelPinRoutes(db: Database, baseUrl: string): Hono {
  const app = new Hono()

  // Note: this sub-router MUST be composed BEFORE createChannelMessageRoutes
  // in createChannelRoutes. If mounted after, "pins" would be interpreted as
  // a message ID by GET /channels/:cid/messages/:mid (Hono is first-match-wins).

  // GET /channels/:channelId/messages/pins — List pinned messages (new API format)
  // Used by discord.py 2.7+: {"items":[{"pinned_at":...,"message":{...}}],"has_more":false}
  app.get('/channels/:channelId/messages/pins', (c) => {
    const { channelId } = c.req.param()
    const pins = getPinnedMessages(db, channelId, baseUrl)
    const pinRows = db
      .prepare(
        'SELECT message_id, pinned_at FROM pins WHERE channel_id = ? ORDER BY pinned_at ASC'
      )
      .all(channelId) as { message_id: string; pinned_at: string }[]

    const pinnedAtMap = new Map(
      pinRows.map((r) => [r.message_id, r.pinned_at])
    )
    return c.json({
      items: pins.map((msg) => ({
        pinned_at: new Date(
          pinnedAtMap.get(msg.id) ?? msg.timestamp
        ).toISOString(),
        message: msg,
      })),
      has_more: false,
    })
  })

  // PUT /channels/:channelId/messages/pins/:messageId — Pin a message (new API format)
  app.put('/channels/:channelId/messages/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    const result = pinMessage(db, channelId, messageId)
    return respondToPinResult(c, result)
  })

  // DELETE /channels/:channelId/messages/pins/:messageId — Unpin a message (new API format)
  app.delete('/channels/:channelId/messages/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    unpinMessage(db, channelId, messageId)
    return c.body(null, 204)
  })

  // GET /channels/:channelId/pins — List pinned messages (legacy API format)
  app.get('/channels/:channelId/pins', (c) => {
    const { channelId } = c.req.param()
    const pins = getPinnedMessages(db, channelId, baseUrl)
    return c.json(pins)
  })

  // PUT /channels/:channelId/pins/:messageId — Pin a message (legacy API format)
  app.put('/channels/:channelId/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    const result = pinMessage(db, channelId, messageId)
    return respondToPinResult(c, result)
  })

  // DELETE /channels/:channelId/pins/:messageId — Unpin a message (legacy API format)
  app.delete('/channels/:channelId/pins/:messageId', (c) => {
    const { channelId, messageId } = c.req.param()
    unpinMessage(db, channelId, messageId)
    return c.body(null, 204)
  })

  return app
}
