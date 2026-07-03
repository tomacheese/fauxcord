/**
 * Guild emojis API routing
 *
 * Implements the /guilds/:guildId/emojis/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, discordError, validationError } from '../errors.js'
import { generateSnowflake } from '../snowflake.js'
import { getGuild } from '../services/guilds.js'
import {
  getGuildEmojis,
  getEmoji,
  createEmoji,
  updateEmoji,
  deleteEmoji,
} from '../services/guild-emojis.js'
import {
  validateEmojiCreate,
  validateEmojiUpdate,
} from '../validators/guild.js'
import { requireEntity } from '../lib/route-helpers.js'

/** Minimal bot record shape needed to resolve the emoji creator. */
interface BotRow {
  user_id: string
  token: string
}

/**
 * Creates the guild emojis API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createGuildEmojiRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /guilds/:guildId/emojis — List a guild's emojis
  app.get('/guilds/:guildId/emojis', (c) => {
    const { guildId } = c.req.param()
    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild
    return c.json(getGuildEmojis(db, guildId))
  })

  // GET /guilds/:guildId/emojis/:emojiId — Retrieve a single emoji
  app.get('/guilds/:guildId/emojis/:emojiId', (c) => {
    const { guildId, emojiId } = c.req.param()
    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild
    const emoji = requireEntity(
      c,
      getEmoji(db, guildId, emojiId),
      DiscordErrorCode.UNKNOWN_EMOJI,
      'Unknown Emoji'
    )
    if (emoji instanceof Response) return emoji
    return c.json(emoji)
  })

  // POST /guilds/:guildId/emojis — Create an emoji
  app.post('/guilds/:guildId/emojis', async (c) => {
    const { guildId } = c.req.param()
    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    // `name` is typed as required so downstream usage needs no assertion;
    // its runtime presence is enforced by validateEmojiCreate below.
    const payload = await c.req.json<{
      name: string
      image?: string
      roles?: string[] | null
    }>()

    const errors = validateEmojiCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    // Resolve the authenticated bot as the emoji creator via the
    // Authorization header (works with or without the auth middleware).
    const authHeader = c.req.header('Authorization')
    const bot = authHeader
      ? (db.prepare('SELECT * FROM bots WHERE token = ?').get(authHeader) as
          | BotRow
          | undefined)
      : undefined

    const emoji = createEmoji(db, {
      emojiId: generateSnowflake(),
      guildId,
      name: payload.name,
      userId: bot?.user_id ?? null,
      roles: payload.roles,
    })
    return c.json(emoji, 201)
  })

  // PATCH /guilds/:guildId/emojis/:emojiId — Update an emoji
  app.patch('/guilds/:guildId/emojis/:emojiId', async (c) => {
    const { guildId, emojiId } = c.req.param()
    const guild = requireEntity(
      c,
      getGuild(db, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const payload = await c.req.json<{
      name?: string
      roles?: string[] | null
    }>()

    const errors = validateEmojiUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const updated = requireEntity(
      c,
      updateEmoji(db, guildId, emojiId, payload),
      DiscordErrorCode.UNKNOWN_EMOJI,
      'Unknown Emoji'
    )
    if (updated instanceof Response) return updated
    return c.json(updated)
  })

  // DELETE /guilds/:guildId/emojis/:emojiId — Delete an emoji
  app.delete('/guilds/:guildId/emojis/:emojiId', (c) => {
    const { guildId, emojiId } = c.req.param()
    const deleted = deleteEmoji(db, guildId, emojiId)
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_EMOJI,
        'Unknown Emoji',
        404
      )
      return c.json(err.body, 404)
    }
    return c.body(null, 204)
  })

  return app
}
