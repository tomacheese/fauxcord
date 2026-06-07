/**
 * Users API routing
 *
 * Implements the /users/* and /applications/* endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, discordError } from '../errors.js'
import { getBotUser, getUser, getApplication } from '../services/users.js'
import { getBotGuilds } from '../services/guilds.js'
import type { AppEnv } from '../middleware/auth.js'

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
