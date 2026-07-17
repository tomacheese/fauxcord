/**
 * Users API routing
 *
 * Implements the /users/* and /applications/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import {
  getBotUser,
  getUser,
  getApplication,
  updateBotUser,
} from '../services/users'
import { getBotGuilds } from '../services/guilds'
import {
  getOrCreateDmChannel,
  createGroupDmChannel,
} from '../services/channels'
import { validateCurrentUserUpdate } from '../validators/user'
import { requiredError } from '../validators/common'
import { parseJsonBody } from '../lib/route-helpers'
import type { AppEnv } from '../middleware/auth'

/**
 * Creates the Users API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createUserRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /users/@me — Retrieve the authenticated bot user's information
  app.get('/users/@me', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const user = getBotUser(db, bot.token)
    if (!user) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(user)
  })

  // PATCH /users/@me — Update the authenticated bot user's profile
  app.patch('/users/@me', async (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    // Tolerate an empty/invalid/non-object JSON body (including a literal
    // `null` or an array, both of which parse without error): treat it as an
    // empty (no-op) update rather than dereferencing a non-object.
    const parsed: unknown = await c.req.json().catch(() => ({}))
    const body: Record<string, unknown> =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}

    const errors = validateCurrentUserUpdate(body)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const user = updateBotUser(db, bot.token, body)
    if (!user) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(user)
  })

  // GET /users/:userId — Retrieve the specified user's information
  // Some libraries such as discord.js percent-encode @ and send %40me,
  // so a parameter value of "@me" (already decoded) is also treated as @me
  app.get('/users/:userId', (c) => {
    // Hono auto-decodes path parameters, so %40me has already been converted to @me
    // Calling decodeURIComponent again would double-decode (e.g. %25me → %me) and throw an exception
    const userId = c.req.param('userId')

    if (userId === '@me') {
      const bot = c.get('bot')
      if (!bot) {
        return c.json({ message: '401: Unauthorized', code: 0 }, 401)
      }
      const user = getBotUser(db, bot.token)
      if (!user) {
        return c.json({ message: '401: Unauthorized', code: 0 }, 401)
      }
      return c.json(user)
    }

    const user = getUser(db, userId)
    if (!user) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_USER,
        'Unknown User',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(user)
  })

  // GET /users/@me/guilds — List the guilds the bot has joined
  app.get('/users/@me/guilds', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const guilds = getBotGuilds(db, bot.token)
    return c.json(guilds)
  })

  // POST /users/@me/channels — Create a DM or group-DM channel
  app.post('/users/@me/channels', async (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const payload = (await parseJsonBody(c)) as {
      recipient_id?: unknown
      access_tokens?: unknown
    }

    if (
      Array.isArray(payload.access_tokens) &&
      payload.access_tokens.length > 0
    ) {
      const channel = createGroupDmChannel(db, bot.user_id)
      return c.json(channel)
    }

    if (typeof payload.recipient_id === 'string') {
      const recipient = db
        .prepare('SELECT id FROM users WHERE id = ?')
        .get(payload.recipient_id)
      if (!recipient) {
        const err = discordError(
          DiscordErrorCode.UNKNOWN_USER,
          'Unknown User',
          404
        )
        return c.json(err.body, 404)
      }
      const channel = getOrCreateDmChannel(
        db,
        bot.user_id,
        payload.recipient_id
      )
      return c.json(channel)
    }

    return c.json(
      validationError({
        recipient_id: { _errors: [requiredError()] },
      }).body,
      400
    )
  })

  // GET /applications/@me — Retrieve application information
  app.get('/applications/@me', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const app_ = getApplication(db, bot.token)
    if (!app_) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(app_)
  })

  // GET /oauth2/applications/@me — Retrieve application information (Discord.Net-compatible alias)
  // Get Current Bot Application Information (legacy endpoint).
  // Libraries such as Discord.Net call this at login,
  // so it is implemented as an alias that returns the same response as /applications/@me
  app.get('/oauth2/applications/@me', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const app_ = getApplication(db, bot.token)
    if (!app_) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(app_)
  })

  return app
}
