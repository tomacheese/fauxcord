/**
 * Guild emojis API routing
 *
 * Implements the /guilds/:guildId/emojis/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../database'
import type { AppEnvironment } from '../middleware/auth'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { generateSnowflake } from '../snowflake'
import { getGuild } from '../services/guilds'
import {
  getGuildEmojis,
  getEmoji,
  createEmoji,
  updateEmoji,
  didDeleteEmoji,
} from '../services/guild-emojis'
import {
  validateEmojiCreate,
  validateEmojiUpdate,
  type EmojiCreatePayload,
  type EmojiUpdatePayload,
} from '../validators/guild'
import { requireEntity, parseJsonBody } from '../lib/route-helpers'

/** Minimal bot record shape needed to resolve the emoji creator. */
interface BotRow {
  user_id: string
  token: string
}

/**
 * Creates the guild emojis API routes.
 * @param database - Database
 * @returns Hono router instance
 */
export function createGuildEmojiRoutes(
  database: Database
): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>()

  // GET /guilds/:guildId/emojis — List a guild's emojis
  app.get('/guilds/:guildId/emojis', (c) => {
    const { guildId } = c.req.param()
    const guild = requireEntity(
      c,
      getGuild(database, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild
    return c.json(getGuildEmojis(database, guildId))
  })

  // GET /guilds/:guildId/emojis/:emojiId — Retrieve a single emoji
  app.get('/guilds/:guildId/emojis/:emojiId', (c) => {
    const { guildId, emojiId } = c.req.param()
    const guild = requireEntity(
      c,
      getGuild(database, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild
    const emoji = requireEntity(
      c,
      getEmoji(database, guildId, emojiId),
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
      getGuild(database, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const payload = (await parseJsonBody(c)) as EmojiCreatePayload

    const errors = validateEmojiCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    // Resolve the authenticated bot as the emoji creator. Prefer the bot
    // already resolved by the auth middleware; fall back to a direct token
    // lookup for unit tests that mount this router in isolation.
    let bot: BotRow | undefined = c.get('bot')
    if (!bot) {
      const authHeader = c.req.header('Authorization')
      if (authHeader) {
        bot = database
          .prepare('SELECT * FROM bots WHERE token = ?')
          .get(authHeader) as BotRow | undefined
      }
    }

    // `payload.name` is guaranteed present here: validateEmojiCreate above
    // requires it and would have returned a 400 otherwise. Widen to a
    // required-name shape rather than using a non-null assertion.
    const validatedPayload = payload as EmojiCreatePayload & { name: string }
    const emoji = createEmoji(database, {
      emojiId: generateSnowflake(),
      guildId,
      name: validatedPayload.name,
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
      getGuild(database, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild

    const payload = (await parseJsonBody(c)) as EmojiUpdatePayload

    const errors = validateEmojiUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    // `roles: null` means "not provided" per validateEmojiUpdate, so it must
    // not reach the service layer as an explicit roles-clearing update.
    const updated = requireEntity(
      c,
      updateEmoji(database, guildId, emojiId, {
        name: payload.name,
        roles: payload.roles ?? undefined,
      }),
      DiscordErrorCode.UNKNOWN_EMOJI,
      'Unknown Emoji'
    )
    if (updated instanceof Response) return updated
    return c.json(updated)
  })

  // DELETE /guilds/:guildId/emojis/:emojiId — Delete an emoji
  app.delete('/guilds/:guildId/emojis/:emojiId', (c) => {
    const { guildId, emojiId } = c.req.param()
    const guild = requireEntity(
      c,
      getGuild(database, guildId),
      DiscordErrorCode.UNKNOWN_GUILD,
      'Unknown Guild'
    )
    if (guild instanceof Response) return guild
    const isDeleted = didDeleteEmoji(database, guildId, emojiId)
    if (!isDeleted) {
      const error = discordError(
        DiscordErrorCode.UNKNOWN_EMOJI,
        'Unknown Emoji',
        404
      )
      return c.json(error.body, 404)
    }
    return c.body(null, 204)
  })

  return app
}
