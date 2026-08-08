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
import { listEntitlements } from '../services/applications'

const BROAD_OAUTH2_SCOPES = new Set([
  'activities.invites.write',
  'activities.read',
  'activities.write',
  'applications.builds.read',
  'applications.builds.upload',
  'applications.commands',
  'applications.commands.permissions.update',
  'applications.commands.update',
  'applications.entitlements',
  'applications.store.update',
  'bot',
  'connections',
  'dm_channels.read',
  'email',
  'gdm.join',
  'guilds',
  'guilds.join',
  'guilds.members.read',
  'identify',
  'messages.read',
  'openid',
  'relationships.read',
  'role_connections.write',
  'rpc',
  'rpc.activities.write',
  'rpc.notifications.read',
  'rpc.screenshare.read',
  'rpc.screenshare.write',
  'rpc.video.read',
  'rpc.video.write',
  'rpc.voice.read',
  'rpc.voice.write',
  'voice',
  'webhook.incoming',
])

function hasOAuthScope(scope: string, allowed: ReadonlySet<string>): boolean {
  return scope.split(' ').some((item) => allowed.has(item))
}

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

  app.get('/users/@me/applications/:applicationId/entitlements', (c) => {
    const accessToken = c.get('accessToken')
    if (!accessToken?.user_id)
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    if (!hasOAuthScope(accessToken.scope, BROAD_OAUTH2_SCOPES))
      return c.json({ message: '403: Forbidden', code: 50_001 }, 403)
    return c.json(
      listEntitlements(db, c.req.param('applicationId'), {
        userId: accessToken.user_id,
        excludeDeleted: true,
      })
    )
  })

  app.get('/users/@me/applications/:applicationId/role-connection', (c) => {
    const accessToken = c.get('accessToken')
    if (
      !accessToken?.user_id ||
      !accessToken.scope.split(' ').includes('role_connections.write')
    )
      return c.json({ message: '403: Forbidden', code: 50_001 }, 403)
    const row = db
      .prepare(
        'SELECT platform_name, platform_username, metadata FROM user_application_role_connections WHERE application_id = ? AND user_id = ?'
      )
      .get(c.req.param('applicationId'), accessToken.user_id) as
      | {
          platform_name: string | null
          platform_username: string | null
          metadata: string
        }
      | undefined
    return c.json(
      row
        ? {
            platform_name: row.platform_name ?? '',
            platform_username: row.platform_username,
            metadata: JSON.parse(row.metadata),
          }
        : { platform_name: '', platform_username: null, metadata: {} }
    )
  })

  app.put(
    '/users/@me/applications/:applicationId/role-connection',
    async (c) => {
      const accessToken = c.get('accessToken')
      if (
        !accessToken?.user_id ||
        !accessToken.scope.split(' ').includes('role_connections.write')
      )
        return c.json({ message: '403: Forbidden', code: 50_001 }, 403)
      const body = await c.req
        .json<{
          platform_name?: string
          platform_username?: string | null
          metadata?: Record<string, string>
        }>()
        .catch(
          () =>
            ({}) as {
              platform_name?: string
              platform_username?: string | null
              metadata?: Record<string, string>
            }
        )
      db.prepare(
        `INSERT INTO user_application_role_connections (application_id, user_id, platform_name, platform_username, metadata) VALUES (?, ?, ?, ?, ?) ON CONFLICT(application_id, user_id) DO UPDATE SET platform_name = excluded.platform_name, platform_username = excluded.platform_username, metadata = excluded.metadata, updated_at = datetime('now')`
      ).run(
        c.req.param('applicationId'),
        accessToken.user_id,
        body.platform_name ?? '',
        body.platform_username ?? null,
        JSON.stringify(body.metadata ?? {})
      )
      return c.json({
        platform_name: body.platform_name ?? '',
        platform_username: body.platform_username ?? null,
        metadata: body.metadata ?? {},
      })
    }
  )

  app.delete('/users/@me/applications/:applicationId/role-connection', (c) => {
    const accessToken = c.get('accessToken')
    if (
      !accessToken?.user_id ||
      !accessToken.scope.split(' ').includes('role_connections.write')
    )
      return c.json({ message: '403: Forbidden', code: 50_001 }, 403)
    db.prepare(
      'DELETE FROM user_application_role_connections WHERE application_id = ? AND user_id = ?'
    ).run(c.req.param('applicationId'), accessToken.user_id)
    return c.body(null, 204)
  })

  app.get('/users/@me/connections', (c) => {
    const accessToken = c.get('accessToken')
    if (!accessToken && !c.get('bot'))
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    if (
      accessToken &&
      !hasOAuthScope(accessToken.scope, new Set(['connections']))
    )
      return c.json({ message: '403: Forbidden', code: 50_001 }, 403)
    return c.json([])
  })

  app.delete('/users/@me/guilds/:guildId', (c) => {
    const bot = c.get('bot')
    if (!bot) return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    db.prepare(
      'DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?'
    ).run(c.req.param('guildId'), bot.user_id)
    return c.body(null, 204)
  })

  app.get('/users/@me/guilds/:guildId/member', (c) => {
    const accessToken = c.get('accessToken')
    if (
      !accessToken?.user_id ||
      !accessToken.scope.split(' ').includes('guilds.members.read')
    )
      return c.json({ message: '403: Forbidden', code: 50_001 }, 403)
    const row = db
      .prepare(
        'SELECT guild_members.*, users.id, users.username, users.discriminator, users.avatar, users.bot FROM guild_members JOIN users ON users.id = guild_members.user_id WHERE guild_id = ? AND user_id = ?'
      )
      .get(c.req.param('guildId'), accessToken.user_id) as
      | {
          nick: string | null
          joined_at: string
          mute: number
          deaf: number
          flags: number
          id: string
          username: string
          discriminator: string
          avatar: string | null
          bot: number
        }
      | undefined
    if (!row)
      return c.json(
        discordError(DiscordErrorCode.UNKNOWN_MEMBER, 'Unknown Member', 404)
          .body,
        404
      )
    return c.json({
      avatar: null,
      avatar_decoration_data: null,
      banner: null,
      communication_disabled_until: null,
      flags: row.flags,
      joined_at: new Date(`${row.joined_at}Z`).toISOString(),
      nick: row.nick,
      pending: false,
      premium_since: null,
      roles: [],
      collectibles: null,
      user: {
        id: row.id,
        username: row.username,
        discriminator: row.discriminator,
        avatar: row.avatar,
        bot: row.bot === 1,
        public_flags: 0,
        flags: 0,
        global_name: null,
        primary_guild: null,
      },
      mute: row.mute === 1,
      deaf: row.deaf === 1,
      permissions: '0',
    })
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
