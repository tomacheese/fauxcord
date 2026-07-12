/**
 * Users API routing
 *
 * Implements the /users/* and /applications/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../database'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { getBotUser, getUser, getApp, updateBotUser } from '../services/users'
import { getBotGuilds } from '../services/guilds'
import { validateCurrentUserUpdate } from '../validators/user'
import type { AppEnvironment } from '../middleware/auth'

/**
 * Creates the Users API routes.
 * @param database - Database
 * @returns Hono router instance
 */
export function createUserRoutes(database: Database): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>()

  // GET /users/@me — Retrieve the authenticated bot user's information
  app.get('/users/@me', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const user = getBotUser(database, bot.token)
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
    let parsed: unknown
    try {
      parsed = await c.req.json()
    } catch {
      parsed = {}
    }
    const body: Record<string, unknown> =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}

    const errors = validateCurrentUserUpdate(body)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const user = updateBotUser(database, bot.token, body)
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
      const user = getBotUser(database, bot.token)
      if (!user) {
        return c.json({ message: '401: Unauthorized', code: 0 }, 401)
      }
      return c.json(user)
    }

    const user = getUser(database, userId)
    if (!user) {
      const error = discordError(
        DiscordErrorCode.UNKNOWN_USER,
        'Unknown User',
        404
      )
      return c.json(error.body, 404)
    }
    return c.json(user)
  })

  // GET /users/@me/guilds — List the guilds the bot has joined
  app.get('/users/@me/guilds', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const guilds = getBotGuilds(database, bot.token)
    return c.json(guilds)
  })

  // GET /applications/@me — Retrieve application information
  app.get('/applications/@me', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const app_ = getApp(database, bot.token)
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

    const app_ = getApp(database, bot.token)
    if (!app_) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(app_)
  })

  return app
}
