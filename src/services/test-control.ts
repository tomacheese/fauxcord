/**
 * Test control service
 *
 * Handles test environment setup and reset.
 */

import type { Database } from '../db'
import { generateSnowflake } from '../snowflake'
import { gatewayBus } from '../gateway/bus'
import { buildGuildCreatePayload } from './guilds'
import { getGuildMember } from './guild-members'

/** Test setup request type */
export interface SetupRequest {
  token: string
  user?: {
    id?: string
    username?: string
    discriminator?: string
  }
  guilds?: SetupGuildRequest[]
}

/** Guild information type for test setup */
export interface SetupGuildRequest {
  id?: string
  name: string
  channels?: SetupChannelRequest[]
}

/** Channel information type for test setup */
export interface SetupChannelRequest {
  id?: string
  name: string
  type?: number
}

/** Test setup response type */
export interface SetupResponse {
  token: string
  user: { id: string; username: string }
  guilds: {
    id: string
    name: string
    channels: { id: string; name: string; type: number }[]
  }[]
}

/**
 * Sets up the test environment.
 * @param db - Database
 * @param request - Setup request
 * @returns Setup result
 * @throws Error if the token is already registered
 */
export function setupTestEnvironment(
  db: Database,
  request: SetupRequest
): SetupResponse {
  // Duplicate token check
  const existing = db
    .prepare('SELECT token FROM bots WHERE token = ?')
    .get(request.token)
  if (existing) {
    throw new Error('CONFLICT')
  }

  const userId = request.user?.id ?? generateSnowflake()
  const username = request.user?.username ?? 'MockBot'
  const discriminator = request.user?.discriminator ?? '0'

  // Gateway events to broadcast once the transaction below commits. Collecting
  // them here (instead of emitting inline) avoids broadcasting state that a
  // later statement in the same transaction could still roll back.
  const pendingEvents: (() => void)[] = []

  // Run inside a transaction so that a partial setup state
  // (e.g. only the Bot registered) is not left behind if an error occurs midway
  const setup = db.transaction((): SetupResponse => {
    // Create the user
    db.prepare(
      'INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, ?, ?, 1)'
    ).run(userId, username, discriminator)

    // Create the bot
    db.prepare(
      'INSERT INTO bots (token, user_id, username, discriminator) VALUES (?, ?, ?, ?)'
    ).run(request.token, userId, username, discriminator)

    const guildsResponse: SetupResponse['guilds'] = []

    for (const guildReq of request.guilds ?? []) {
      const guildId = guildReq.id ?? generateSnowflake()

      // Create the guild (if the same ID still exists, overwrite its contents and reuse it = idempotent)
      db.prepare(
        `INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           owner_id = excluded.owner_id,
           bot_token = excluded.bot_token`
      ).run(guildId, guildReq.name, userId, request.token)

      pendingEvents.push(() => {
        // The guild row was just inserted/updated above within this same
        // transaction, so `buildGuildCreatePayload` should never actually
        // return null here -- but it's still guarded explicitly (rather than
        // cast past the type checker) so a future refactor that breaks that
        // invariant fails loudly instead of broadcasting a null payload.
        const guild = buildGuildCreatePayload(db, guildId)
        if (!guild) return
        gatewayBus.emit('guild.create', {
          guild: guild as unknown as Record<string, unknown>,
        })
      })

      // Auto-create the @everyone role (Discord API spec: every guild always has @everyone)
      // The @everyone role ID is identical to the guild ID
      db.prepare(
        `INSERT OR IGNORE INTO roles (id, guild_id, name, permissions, position, color, hoist, mentionable)
         VALUES (?, ?, '@everyone', '1071698660929', 0, 0, 0, 0)`
      ).run(guildId, guildId)

      // Register the bot as a member of the guild it owns. On real Discord, a
      // bot present in a guild always shows up in that guild's member list;
      // without this row, GET/PATCH/PUT/DELETE /guilds/{id}/members/{bot_id}*
      // 404 for the bot itself, breaking any client library flow that
      // manages the bot's own guild member (e.g. self role assignment).
      db.prepare(
        'INSERT OR IGNORE INTO guild_members (guild_id, user_id) VALUES (?, ?)'
      ).run(guildId, userId)

      pendingEvents.push(() => {
        gatewayBus.emit('guild.member.add', {
          guildId,
          member: getGuildMember(db, guildId, userId) as unknown as Record<
            string,
            unknown
          >,
        })
      })

      const channelsResponse: { id: string; name: string; type: number }[] = []

      for (const channelReq of guildReq.channels ?? []) {
        const channelId = channelReq.id ?? generateSnowflake()
        const channelType = channelReq.type ?? 0

        // Create the channel (if the same ID still exists, overwrite its contents and reuse it = idempotent)
        db.prepare(
          `INSERT INTO channels (id, guild_id, name, type) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             guild_id = excluded.guild_id,
             name = excluded.name,
             type = excluded.type`
        ).run(channelId, guildId, channelReq.name, channelType)

        channelsResponse.push({
          id: channelId,
          name: channelReq.name,
          type: channelType,
        })
      }

      guildsResponse.push({
        id: guildId,
        name: guildReq.name,
        channels: channelsResponse,
      })
    }

    return {
      token: request.token,
      user: { id: userId, username },
      guilds: guildsResponse,
    }
  })

  const result = setup()
  // Emit only after the transaction has committed successfully.
  for (const emit of pendingEvents) emit()
  return result
}

/**
 * Deletes a bot token and all of its related data.
 * @param db - Database
 * @param token - Bot token to delete
 * @returns true on successful deletion
 */
export function deleteTestSetup(db: Database, token: string): boolean {
  const bot = db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token)
  if (!bot) return false

  // Related Guilds/Channels/Messages are also deleted via cascade delete
  db.prepare('DELETE FROM bots WHERE token = ?').run(token)
  return true
}

/**
 * Resets test data (tokens, guilds, and channels are kept).
 * @param db - Database
 * @param token - Bot token to reset (all tokens if omitted)
 */
export function resetTestData(db: Database, token?: string): void {
  if (token) {
    // Reset only the messages and webhooks of the specified token
    db.prepare('DELETE FROM messages WHERE author_token = ?').run(token)
    db.prepare(
      `DELETE FROM webhooks WHERE channel_id IN (
         SELECT c.id FROM channels c
         JOIN guilds g ON g.id = c.guild_id
         WHERE g.bot_token = ?
       )`
    ).run(token)
    db.prepare(
      `DELETE FROM invites WHERE channel_id IN (
         SELECT c.id FROM channels c
         JOIN guilds g ON g.id = c.guild_id
         WHERE g.bot_token = ?
       )`
    ).run(token)
  } else {
    // Reset all data (the tables themselves are kept)
    db.exec('DELETE FROM messages')
    db.exec('DELETE FROM webhooks')
    db.exec('DELETE FROM invites')
    db.exec('DELETE FROM reactions')
    db.exec('DELETE FROM pins')
    db.exec('DELETE FROM embeds')
    db.exec('DELETE FROM attachments')
  }
}

/**
 * Retrieves all messages in a channel in the test format.
 * @param db - Database
 * @param channelId - Channel ID
 * @returns List of messages
 */
export function getTestMessages(
  db: Database,
  channelId: string
): {
  id: string
  content: string
  author_token: string | null
  created_at: string
}[] {
  return db
    .prepare(
      'SELECT id, content, author_token, created_at FROM messages WHERE channel_id = ? ORDER BY id'
    )
    .all(channelId) as {
    id: string
    content: string
    author_token: string | null
    created_at: string
  }[]
}

/** Request payload for registering a non-bot test user */
export interface CreateTestUserRequest {
  id?: string
  username: string
  discriminator?: string
}

/** Response for a newly registered non-bot test user */
export interface CreateTestUserResponse {
  id: string
  username: string
  discriminator: string
}

/**
 * Registers a non-bot user for testing (e.g. to later author an injected
 * message via injectTestMessage). Unlike POST /_test/setup, an explicit ID
 * collision is a hard error -- this endpoint never silently reuses an
 * existing row, since callers are expected to track the users they create.
 * @param db - Database
 * @param request - User creation request
 * @returns Created user info
 * @throws Error with message 'CONFLICT' if the explicit ID already exists
 */
export function createTestUser(
  db: Database,
  request: CreateTestUserRequest
): CreateTestUserResponse {
  const id = request.id ?? generateSnowflake()
  const discriminator = request.discriminator ?? '0'

  if (request.id) {
    const existing = db
      .prepare('SELECT id FROM users WHERE id = ?')
      .get(request.id)
    if (existing) {
      throw new Error('CONFLICT')
    }
  }

  db.prepare(
    'INSERT INTO users (id, username, discriminator, bot) VALUES (?, ?, ?, 0)'
  ).run(id, request.username, discriminator)

  return { id, username: request.username, discriminator }
}
