/**
 * Channel threads API routing
 *
 * Implements thread creation, membership, archived listings, and search under
 * /channels/:channelId/*.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from '../database'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import { getChannel } from '../services/channels'
import {
  createThread,
  getThread,
  getThreadMember,
  getThreadMembers,
  addThreadMember,
  removeThreadMember,
  getArchivedThreads,
  searchThreads,
} from '../services/threads'
import {
  validateThreadCreate,
  THREAD_CHANNEL_TYPES,
} from '../validators/thread'
import type { AppEnvironment, BotRecord } from '../middleware/auth'
import {
  requireEntity,
  parseJsonBody,
  parseLimitQuery,
} from '../lib/route-helpers'

/**
 * Resolves the authenticated bot's user ID, falling back to a direct token
 * lookup when the auth middleware was not applied (e.g. in unit tests).
 * @param c - Hono context
 * @param database - Database
 * @returns The resolved user ID (a placeholder when unauthenticated)
 */
function resolveUserId(c: Context<AppEnvironment>, database: Database): string {
  let bot = c.get('bot')
  if (!bot) {
    const authHeader = c.req.header('Authorization')
    if (authHeader) {
      bot = database
        .prepare('SELECT * FROM bots WHERE token = ?')
        .get(authHeader) as BotRecord | undefined
    }
  }
  return bot?.user_id ?? '000000000000000000'
}

/**
 * Creates the channel threads API routes.
 * @param database - Database
 * @returns Hono router instance
 */
export function createChannelThreadRoutes(
  database: Database
): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>()

  // POST /channels/:channelId/messages/:messageId/threads — Create from a message
  app.post('/channels/:channelId/messages/:messageId/threads', async (c) => {
    const { channelId, messageId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    // Scope the message lookup to the parent channel so a message from another
    // channel cannot be used to create a thread here (matches Discord's 404).
    const message = database
      .prepare('SELECT id FROM messages WHERE id = ? AND channel_id = ?')
      .get(messageId, channelId) as { id: string } | undefined
    if (!message) {
      return c.json(
        discordError(DiscordErrorCode.UNKNOWN_MESSAGE, 'Unknown Message', 404)
          .body,
        404
      )
    }

    // A message can only have one thread. The thread ID equals the message ID,
    // so an existing channel row with that ID means a thread already exists.
    if (getThread(database, messageId)) {
      return c.json(
        discordError(
          DiscordErrorCode.THREAD_ALREADY_CREATED,
          'A thread has already been created for this message',
          400
        ).body,
        400
      )
    }

    const payload = await parseJsonBody(c)
    const errors = validateThreadCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const thread = createThread(database, {
      parentId: channelId,
      threadId: messageId,
      name: payload.name as string,
      ownerId: resolveUserId(c, database),
      type: 11,
      autoArchiveDuration: payload.auto_archive_duration,
      rateLimitPerUser:
        typeof payload.rate_limit_per_user === 'number'
          ? payload.rate_limit_per_user
          : undefined,
    })
    return c.json(thread, 201)
  })

  // POST /channels/:channelId/threads — Create without a message
  app.post('/channels/:channelId/threads', async (c) => {
    const { channelId } = c.req.param()

    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel

    const payload = await parseJsonBody(c)
    const errors = validateThreadCreate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }

    const requestedType =
      typeof payload.type === 'number' ? payload.type : undefined
    const type =
      requestedType &&
      (THREAD_CHANNEL_TYPES as readonly number[]).includes(requestedType)
        ? requestedType
        : 11

    const thread = createThread(database, {
      parentId: channelId,
      name: payload.name as string,
      ownerId: resolveUserId(c, database),
      type,
      autoArchiveDuration: payload.auto_archive_duration,
      rateLimitPerUser:
        typeof payload.rate_limit_per_user === 'number'
          ? payload.rate_limit_per_user
          : undefined,
      invitable:
        typeof payload.invitable === 'boolean' ? payload.invitable : undefined,
    })
    return c.json(thread, 201)
  })

  // GET /channels/:channelId/threads/archived/public — Archived public threads
  app.get('/channels/:channelId/threads/archived/public', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    return c.json(
      getArchivedThreads(database, channelId, {
        private: false,
        memberUserId: resolveUserId(c, database),
      })
    )
  })

  // GET /channels/:channelId/threads/archived/private — Archived private threads
  app.get('/channels/:channelId/threads/archived/private', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    return c.json(
      getArchivedThreads(database, channelId, {
        private: true,
        memberUserId: resolveUserId(c, database),
      })
    )
  })

  // GET /channels/:channelId/users/@me/threads/archived/private — Joined private
  app.get('/channels/:channelId/users/@me/threads/archived/private', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    return c.json(
      getArchivedThreads(database, channelId, {
        private: true,
        joinedUserId: resolveUserId(c, database),
      })
    )
  })

  // GET /channels/:channelId/threads/search — Search threads
  app.get('/channels/:channelId/threads/search', (c) => {
    const { channelId } = c.req.param()
    const channel = requireEntity(
      c,
      getChannel(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (channel instanceof Response) return channel
    return c.json(searchThreads(database, channelId))
  })

  // GET /channels/:channelId/thread-members — List members
  app.get('/channels/:channelId/thread-members', (c) => {
    const { channelId } = c.req.param()
    const limit = parseLimitQuery(c, 100, 100)
    const after = c.req.query('after') ?? '0'
    const isWithMember = ['true', '1'].includes(
      c.req.query('with_member') ?? ''
    )
    const thread = requireEntity(
      c,
      getThread(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (thread instanceof Response) return thread
    return c.json(
      getThreadMembers(
        database,
        channelId,
        limit,
        after,
        thread.guild_id,
        isWithMember
      )
    )
  })

  // PUT /channels/:channelId/thread-members/@me — Join
  app.put('/channels/:channelId/thread-members/@me', (c) => {
    const { channelId } = c.req.param()
    const thread = requireEntity(
      c,
      getThread(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (thread instanceof Response) return thread
    addThreadMember(database, channelId, resolveUserId(c, database))
    return c.body(null, 204)
  })

  // DELETE /channels/:channelId/thread-members/@me — Leave
  app.delete('/channels/:channelId/thread-members/@me', (c) => {
    const { channelId } = c.req.param()
    const thread = requireEntity(
      c,
      getThread(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (thread instanceof Response) return thread
    removeThreadMember(database, channelId, resolveUserId(c, database))
    return c.body(null, 204)
  })

  // GET /channels/:channelId/thread-members/:userId — Get one member
  app.get('/channels/:channelId/thread-members/:userId', (c) => {
    const { channelId, userId } = c.req.param()
    const isWithMember = ['true', '1'].includes(
      c.req.query('with_member') ?? ''
    )
    const thread = requireEntity(
      c,
      getThread(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (thread instanceof Response) return thread

    const resolvedId = userId === '@me' ? resolveUserId(c, database) : userId
    const member = requireEntity(
      c,
      getThreadMember(
        database,
        channelId,
        resolvedId,
        thread.guild_id,
        isWithMember
      ),
      DiscordErrorCode.UNKNOWN_MEMBER,
      'Unknown Member'
    )
    if (member instanceof Response) return member
    return c.json(member)
  })

  // PUT /channels/:channelId/thread-members/:userId — Add member
  app.put('/channels/:channelId/thread-members/:userId', (c) => {
    const { channelId, userId } = c.req.param()
    const thread = requireEntity(
      c,
      getThread(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (thread instanceof Response) return thread
    const resolvedId = userId === '@me' ? resolveUserId(c, database) : userId
    addThreadMember(database, channelId, resolvedId)
    return c.body(null, 204)
  })

  // DELETE /channels/:channelId/thread-members/:userId — Remove member
  app.delete('/channels/:channelId/thread-members/:userId', (c) => {
    const { channelId, userId } = c.req.param()
    const thread = requireEntity(
      c,
      getThread(database, channelId),
      DiscordErrorCode.UNKNOWN_CHANNEL,
      'Unknown Channel'
    )
    if (thread instanceof Response) return thread
    const resolvedId = userId === '@me' ? resolveUserId(c, database) : userId
    removeThreadMember(database, channelId, resolvedId)
    return c.body(null, 204)
  })

  return app
}
