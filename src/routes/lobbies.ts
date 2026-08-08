import { Hono, type Context } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import type { AppEnv } from '../middleware/auth'
import {
  addOrUpdateMember,
  createLobby,
  createLobbyMessage,
  deleteLobby,
  deleteLobbyMember,
  getLobby,
  isLobbyMember,
  listLobbyMessages,
  updateLobby,
  updateLobbyChannel,
  updateLobbyMessageModeration,
} from '../services/lobbies'

const SNOWFLAKE = /^(0|[1-9][0-9]*)$/

const UNKNOWN_LOBBY = 10_004

function invalid(c: Context<AppEnv>) {
  return c.json(validationError({ id: { _errors: [{ code: 'BASE_TYPE_BAD_FORMAT', message: 'Invalid snowflake.' }] } }).body, 400)
}

function unknown(c: Context<AppEnv>, code: number, message: string) {
  return c.json(discordError(code, message, 404).body, 404)
}

function currentUser(c: Context<AppEnv>): string | null {
  return c.get('bot')?.user_id ?? c.get('accessToken')?.user_id ?? null
}

function botUser(c: Context<AppEnv>): string | null {
  return c.get('bot')?.user_id ?? null
}

function mapMembers(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((member) => {
    if (!member || typeof member !== 'object') return []
    const input = member as Record<string, unknown>
    return typeof input.id === 'string' || typeof input.user_id === 'string'
      ? [{
          userId: (input.id ?? input.user_id) as string,
          metadata: input.metadata as Record<string, string> | null | undefined,
          flags: typeof input.flags === 'number' ? input.flags : undefined,
          additionalName: input.additional_name as string | null | undefined,
        }]
      : []
  })
}

/** Creates routes for Discord's local SDK lobby API. */
export function createLobbyRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.put('/lobbies', async (c) => {
    const ownerId = currentUser(c)
    if (!ownerId) return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    const payload = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const applicationId = (db
      .prepare('SELECT id FROM applications WHERE owner_id = ? ORDER BY id LIMIT 1')
      .get(ownerId) as { id: string } | undefined)?.id ?? ownerId
    return c.json(createLobby(db, {
      applicationId,
      ownerId,
      metadata: payload.lobby_metadata as Record<string, string> | null | undefined,
      flags: typeof payload.flags === 'number' ? payload.flags : undefined,
    }))
  })

  app.post('/lobbies', async (c) => {
    const ownerId = botUser(c)
    if (!ownerId) return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    const payload = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const channelId = typeof payload.channel_id === 'string' ? payload.channel_id : null
    const lobby = createLobby(db, {
      applicationId: (db
        .prepare('SELECT id FROM applications WHERE owner_id = ? ORDER BY id LIMIT 1')
        .get(ownerId) as { id: string } | undefined)?.id ?? ownerId,
      ownerId,
      channelId,
      metadata: payload.metadata as Record<string, string> | null | undefined,
      flags: typeof payload.flags === 'number' ? payload.flags : undefined,
      overrideEventWebhooksUrl: payload.override_event_webhooks_url as string | null | undefined,
      members: mapMembers(payload.members),
    })
    return c.json(lobby, 201)
  })

  app.get('/lobbies/:lobbyId', (c) => {
    const lobbyId = c.req.param('lobbyId')
    if (!SNOWFLAKE.test(lobbyId)) return invalid(c)
    const lobby = getLobby(db, lobbyId)
    if (!lobby) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (!botUser(c) || lobby.owner_id !== botUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    return c.json(lobby)
  })

  app.delete('/lobbies/:lobbyId', (c) => {
    const lobbyId = c.req.param('lobbyId')
    if (!SNOWFLAKE.test(lobbyId)) return invalid(c)
    const lobby = getLobby(db, lobbyId)
    if (!lobby) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (lobby.owner_id !== botUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    deleteLobby(db, lobbyId)
    return c.body(null, 204)
  })

  app.patch('/lobbies/:lobbyId', async (c) => {
    const lobbyId = c.req.param('lobbyId')
    if (!SNOWFLAKE.test(lobbyId)) return invalid(c)
    const lobby = getLobby(db, lobbyId)
    if (!lobby) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (lobby.owner_id !== botUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    const payload = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    return c.json(updateLobby(db, lobbyId, {
      metadata: payload.metadata as Record<string, string> | null | undefined,
      flags: typeof payload.flags === 'number' ? payload.flags : undefined,
      overrideEventWebhooksUrl: payload.override_event_webhooks_url as string | null | undefined,
      members: mapMembers(payload.members),
    }))
  })

  app.patch('/lobbies/:lobbyId/channel-linking', async (c) => {
    const lobbyId = c.req.param('lobbyId')
    if (!SNOWFLAKE.test(lobbyId)) return invalid(c)
    const lobby = getLobby(db, lobbyId)
    if (!lobby) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (lobby.owner_id !== currentUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    const payload = await c.req.json<{ channel_id?: string | null }>().catch(() => ({} as { channel_id?: string | null }))
    if (payload.channel_id !== null && payload.channel_id !== undefined && !SNOWFLAKE.test(payload.channel_id)) return invalid(c)
    const updated = updateLobbyChannel(db, lobbyId, payload.channel_id ?? null)
    if (!updated) return unknown(c, DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel')
    return c.json(updated)
  })

  app.delete('/lobbies/:lobbyId/members/@me', (c) => {
    const lobbyId = c.req.param('lobbyId')
    if (!SNOWFLAKE.test(lobbyId)) return invalid(c)
    const userId = currentUser(c)
    if (!userId || !isLobbyMember(db, lobbyId, userId)) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    deleteLobbyMember(db, lobbyId, userId)
    return c.body(null, 204)
  })

  app.post('/lobbies/:lobbyId/members/@me/invites', (c) => {
    const lobby = getLobby(db, c.req.param('lobbyId'))
    const userId = currentUser(c)
    if (!lobby || !userId || !isLobbyMember(db, lobby.id, userId)) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    return c.json({ code: `lobby-${lobby.id}` })
  })

  app.post('/lobbies/:lobbyId/members/bulk', async (c) => {
    const lobbyId = c.req.param('lobbyId')
    const lobby = getLobby(db, lobbyId)
    if (!lobby) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (lobby.owner_id !== botUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    const members = await c.req.json<unknown>().catch(() => [])
    if (!Array.isArray(members) || members.length === 0) return c.json(validationError({ members: { _errors: [{ code: 'BASE_TYPE_REQUIRED', message: 'This field is required.' }] } }).body, 400)
    const added = mapMembers(members).flatMap((member) => {
      const item = addOrUpdateMember(db, lobbyId, member.userId, member)
      return item ? [item] : []
    })
    return c.json(added)
  })

  app.put('/lobbies/:lobbyId/members/:userId', async (c) => {
    const { lobbyId, userId } = c.req.param()
    if (!SNOWFLAKE.test(lobbyId) || !SNOWFLAKE.test(userId)) return invalid(c)
    const lobby = getLobby(db, lobbyId)
    if (!lobby) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (lobby.owner_id !== botUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    const payload = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const member = addOrUpdateMember(db, lobbyId, userId, {
      metadata: payload.metadata as Record<string, string> | null | undefined,
      flags: typeof payload.flags === 'number' ? payload.flags : undefined,
      additionalName: payload.additional_name as string | null | undefined,
    })
    if (!member) return unknown(c, DiscordErrorCode.UNKNOWN_USER, 'Unknown User')
    return c.json(member)
  })

  app.delete('/lobbies/:lobbyId/members/:userId', (c) => {
    const { lobbyId, userId } = c.req.param()
    const lobby = getLobby(db, lobbyId)
    if (!lobby) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (lobby.owner_id !== botUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    if (!deleteLobbyMember(db, lobbyId, userId)) return unknown(c, DiscordErrorCode.UNKNOWN_USER, 'Unknown User')
    return c.body(null, 204)
  })

  app.post('/lobbies/:lobbyId/members/:userId/invites', (c) => {
    const { lobbyId, userId } = c.req.param()
    const lobby = getLobby(db, lobbyId)
    if (!lobby || !isLobbyMember(db, lobbyId, userId)) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (lobby.owner_id !== botUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    return c.json({ code: `lobby-${lobbyId}-${userId}` })
  })

  app.get('/lobbies/:lobbyId/messages', (c) => {
    const lobbyId = c.req.param('lobbyId')
    const lobby = getLobby(db, lobbyId)
    const userId = currentUser(c)
    if (!lobby || !userId || !isLobbyMember(db, lobbyId, userId)) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    const limit = Number(c.req.query('limit') ?? '50')
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return invalid(c)
    return c.json(listLobbyMessages(db, lobbyId, limit))
  })

  app.post('/lobbies/:lobbyId/messages', async (c) => {
    const lobbyId = c.req.param('lobbyId')
    const userId = currentUser(c)
    if (!userId) return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    const payload = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const message = createLobbyMessage(db, {
      lobbyId,
      authorId: userId,
      content: payload.content as string | null | undefined,
      flags: typeof payload.flags === 'number' ? payload.flags : undefined,
    })
    if (!message) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    return c.json(message, 201)
  })

  app.put('/lobbies/:lobbyId/messages/:messageId/moderation-metadata', async (c) => {
    const { lobbyId, messageId } = c.req.param()
    const lobby = getLobby(db, lobbyId)
    if (!lobby) return unknown(c, UNKNOWN_LOBBY, 'Unknown Lobby')
    if (lobby.owner_id !== botUser(c)) return c.json(discordError(50_001, 'Missing Access', 403).body, 403)
    const metadata = await c.req.json<Record<string, string>>().catch(() => ({}))
    if (!updateLobbyMessageModeration(db, lobbyId, messageId, metadata)) return unknown(c, DiscordErrorCode.UNKNOWN_MESSAGE, 'Unknown Message')
    return c.body(null, 204)
  })

  return app
}
