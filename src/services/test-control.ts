/**
 * Test control service
 *
 * Handles test environment setup and reset.
 */

import type { Database } from '../database'
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
 * @param database - Database
 * @param request - Setup request
 * @returns Setup result
 * @throws Error if the token is already registered
 */
export function setupTestEnvironment(
  database: Database,
  request: SetupRequest
): SetupResponse {
  // Duplicate token check
  const existing = database
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
  const setup = database.transaction((): SetupResponse => {
    // Create the user
    database
      .prepare(
        'INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, ?, ?, 1)'
      )
      .run(userId, username, discriminator)

    // Create the bot
    database
      .prepare(
        'INSERT INTO bots (token, user_id, username, discriminator) VALUES (?, ?, ?, ?)'
      )
      .run(request.token, userId, username, discriminator)

    const guildsResponse: SetupResponse['guilds'] = []

    const guildRequests = request.guilds ?? []
    for (const guildRequest of guildRequests) {
      const guildId = guildRequest.id ?? generateSnowflake()

      // Create the guild (if the same ID still exists, overwrite its contents and reuse it = idempotent)
      database
        .prepare(
          `INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           owner_id = excluded.owner_id,
           bot_token = excluded.bot_token`
        )
        .run(guildId, guildRequest.name, userId, request.token)

      pendingEvents.push(() => {
        // The guild row was just inserted/updated above within this same
        // transaction, so `buildGuildCreatePayload` should never actually
        // return null here -- but it's still guarded explicitly (rather than
        // cast past the type checker) so a future refactor that breaks that
        // invariant fails loudly instead of broadcasting a null payload.
        const guild = buildGuildCreatePayload(database, guildId)
        if (!guild) return
        gatewayBus.emit('guild.create', {
          guild: guild as unknown as Record<string, unknown>,
        })
      })

      // Auto-create the @everyone role (Discord API spec: every guild always has @everyone)
      // The @everyone role ID is identical to the guild ID
      database
        .prepare(
          `INSERT OR IGNORE INTO roles (id, guild_id, name, permissions, position, color, hoist, mentionable)
         VALUES (?, ?, '@everyone', '1071698660929', 0, 0, 0, 0)`
        )
        .run(guildId, guildId)

      // Register the bot as a member of the guild it owns. On real Discord, a
      // bot present in a guild always shows up in that guild's member list;
      // without this row, GET/PATCH/PUT/DELETE /guilds/{id}/members/{bot_id}*
      // 404 for the bot itself, breaking any client library flow that
      // manages the bot's own guild member (e.g. self role assignment).
      database
        .prepare(
          'INSERT OR IGNORE INTO guild_members (guild_id, user_id) VALUES (?, ?)'
        )
        .run(guildId, userId)

      pendingEvents.push(() => {
        gatewayBus.emit('guild.member.add', {
          guildId,
          member: getGuildMember(
            database,
            guildId,
            userId
          ) as unknown as Record<string, unknown>,
        })
      })

      const channelsResponse: { id: string; name: string; type: number }[] = []

      const channelRequests = guildRequest.channels ?? []
      for (const channelRequest of channelRequests) {
        const channelId = channelRequest.id ?? generateSnowflake()
        const channelType = channelRequest.type ?? 0

        // Create the channel (if the same ID still exists, overwrite its contents and reuse it = idempotent)
        database
          .prepare(
            `INSERT INTO channels (id, guild_id, name, type) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             guild_id = excluded.guild_id,
             name = excluded.name,
             type = excluded.type`
          )
          .run(channelId, guildId, channelRequest.name, channelType)

        channelsResponse.push({
          id: channelId,
          name: channelRequest.name,
          type: channelType,
        })
      }

      guildsResponse.push({
        id: guildId,
        name: guildRequest.name,
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
 * @param database - Database
 * @param token - Bot token to delete
 * @returns true on successful deletion
 */
export function didDeleteTestSetup(database: Database, token: string): boolean {
  const bot = database
    .prepare('SELECT user_id FROM bots WHERE token = ?')
    .get(token)
  if (!bot) return false

  // Related Guilds/Channels/Messages are also deleted via cascade delete
  database.prepare('DELETE FROM bots WHERE token = ?').run(token)
  return true
}

/**
 * Resets test data (tokens, guilds, and channels are kept).
 * @param database - Database
 * @param token - Bot token to reset (all tokens if omitted)
 */
export function resetTestData(database: Database, token?: string): void {
  if (token) {
    // Reset only the messages and webhooks of the specified token
    database.prepare('DELETE FROM messages WHERE author_token = ?').run(token)
    database
      .prepare(
        `DELETE FROM webhooks WHERE channel_id IN (
         SELECT c.id FROM channels c
         JOIN guilds g ON g.id = c.guild_id
         WHERE g.bot_token = ?
       )`
      )
      .run(token)
    database
      .prepare(
        `DELETE FROM invites WHERE channel_id IN (
         SELECT c.id FROM channels c
         JOIN guilds g ON g.id = c.guild_id
         WHERE g.bot_token = ?
       )`
      )
      .run(token)
  } else {
    // Reset all data (the tables themselves are kept)
    database.exec('DELETE FROM messages')
    database.exec('DELETE FROM webhooks')
    database.exec('DELETE FROM invites')
    database.exec('DELETE FROM reactions')
    database.exec('DELETE FROM pins')
    database.exec('DELETE FROM embeds')
    database.exec('DELETE FROM attachments')
  }
}

/**
 * Retrieves all messages in a channel in the test format.
 * @param database - Database
 * @param channelId - Channel ID
 * @returns List of messages
 */
export function getTestMessages(
  database: Database,
  channelId: string
): {
  id: string
  content: string
  author_token: string | null
  created_at: string
}[] {
  return database
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
