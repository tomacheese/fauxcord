/**
 * Webhook operations service
 *
 * Provides webhook CRUD operations and execution.
 */

import type { Database } from '../database'
import type { MessageObject } from './messages'
import { createMessage } from './messages'
// Used for compile-time type drift detection.
import type { APIWebhook } from 'discord-api-types/v10'

/**
 * Compile-time guard: ensures the safe-field subset of WebhookObject is
 * structurally compatible with APIWebhook.
 * Fails to compile when discord-api-types renames or retypes these fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _WebhookCompatGuard =
  Pick<
    APIWebhook,
    'id' | 'channel_id' | 'guild_id' | 'name' | 'avatar'
  > extends Pick<
    WebhookObject,
    'id' | 'channel_id' | 'guild_id' | 'name' | 'avatar'
  >
    ? true
    : never

/** Webhook record type retrieved from the DB */
interface WebhookRow {
  id: string
  type: number
  guild_id: string | null
  channel_id: string
  name: string
  avatar: string | null
  token: string
}

/** Webhook object for API responses */
export interface WebhookObject {
  id: string
  type: number
  /** Application ID that created the webhook (always null in the mock) */
  application_id: string | null
  guild_id: string | null
  channel_id: string
  name: string
  avatar: string | null
  token: string
}

/**
 * Converts a DB webhook record into the API response format.
 * @param row - DB record
 * @returns Object for API responses
 */
function toWebhookObject(row: WebhookRow): WebhookObject {
  return {
    id: row.id,
    type: row.type,
    application_id: null,
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    name: row.name,
    avatar: row.avatar,
    token: row.token,
  }
}

/**
 * Retrieves a webhook by ID.
 * @param database - Database
 * @param webhookId - Webhook ID
 * @returns Webhook object, or null
 */
export function getWebhook(
  database: Database,
  webhookId: string
): WebhookObject | null {
  const row = database
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow | undefined
  return row ? toWebhookObject(row) : null
}

/**
 * Retrieves a webhook by ID and token.
 * @param database - Database
 * @param webhookId - Webhook ID
 * @param token - Webhook token
 * @returns Webhook object, or null
 */
export function getWebhookByToken(
  database: Database,
  webhookId: string,
  token: string
): WebhookObject | null {
  const row = database
    .prepare('SELECT * FROM webhooks WHERE id = ? AND token = ?')
    .get(webhookId, token) as WebhookRow | undefined
  return row ? toWebhookObject(row) : null
}

/**
 * Retrieves the list of webhooks for a channel.
 * @param database - Database
 * @param channelId - Channel ID
 * @returns Array of webhook objects
 */
export function getChannelWebhooks(
  database: Database,
  channelId: string
): WebhookObject[] {
  const rows = database
    .prepare('SELECT * FROM webhooks WHERE channel_id = ?')
    .all(channelId) as WebhookRow[]
  return rows.map((row) => toWebhookObject(row))
}

/**
 * Retrieves the list of webhooks for a guild.
 * @param database - Database
 * @param guildId - Guild ID
 * @returns Array of webhook objects
 */
export function getGuildWebhooks(
  database: Database,
  guildId: string
): WebhookObject[] {
  const rows = database
    .prepare('SELECT * FROM webhooks WHERE guild_id = ?')
    .all(guildId) as WebhookRow[]
  return rows.map((row) => toWebhookObject(row))
}

/** Webhook creation parameters */
export interface WebhookCreateParameters {
  webhookId: string
  channelId: string
  guildId: string | null
  name: string
  avatar?: string | null
  token: string
}

/**
 * Creates a webhook.
 * @param database - Database
 * @param parameters - Webhook creation parameters
 * @returns Created webhook object
 */
export function createWebhook(
  database: Database,
  parameters: WebhookCreateParameters
): WebhookObject {
  database
    .prepare(
      'INSERT INTO webhooks (id, guild_id, channel_id, name, avatar, token) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      parameters.webhookId,
      parameters.guildId,
      parameters.channelId,
      parameters.name,
      parameters.avatar ?? null,
      parameters.token
    )

  const row = database
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(parameters.webhookId) as WebhookRow
  return toWebhookObject(row)
}

/**
 * Updates a webhook.
 * @param database - Database
 * @param webhookId - Webhook ID
 * @param payload - Update payload (avatar is cleared with null)
 * @returns Updated webhook object, or null
 */
export function updateWebhook(
  database: Database,
  webhookId: string,
  payload: { name?: string; avatar?: string | null; channel_id?: string }
): WebhookObject | null {
  const current = database
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow | undefined
  if (!current) return null

  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) updates.name = payload.name
  if (payload.avatar !== undefined) updates.avatar = payload.avatar
  if (payload.channel_id !== undefined) {
    // Only move the webhook when the target channel exists. Writing an
    // unknown channel_id would violate the webhooks.channel_id foreign key
    // and surface as an HTTP 500; callers are expected to validate the
    // channel first (see the PATCH /webhooks/:id route), and this guard keeps
    // the constraint from ever being hit regardless of the entry point.
    const channel = database
      .prepare('SELECT guild_id FROM channels WHERE id = ?')
      .get(payload.channel_id) as { guild_id: string | null } | undefined
    if (channel) {
      updates.channel_id = payload.channel_id
      updates.guild_id = channel.guild_id
    }
  }

  if (Object.keys(updates).length > 0) {
    const assignmentClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(', ')
    database
      .prepare(`UPDATE webhooks SET ${assignmentClauses} WHERE id = ?`)
      .run(...Object.values(updates), webhookId)
  }

  const row = database
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow
  return toWebhookObject(row)
}

/**
 * Deletes a webhook.
 * @param database - Database
 * @param webhookId - Webhook ID
 * @returns true on successful deletion
 */
export function didDeleteWebhook(
  database: Database,
  webhookId: string
): boolean {
  const result = database
    .prepare('DELETE FROM webhooks WHERE id = ?')
    .run(webhookId)
  return result.changes > 0
}

/** Webhook execution parameters */
export interface WebhookExecuteParameters {
  messageId: string
  channelId: string
  /** Webhook ID (used as the message's author.id / webhook_id) */
  webhookId: string
  /** Webhook name (default display name when there is no username override) */
  webhookName?: string
  content?: string
  username?: string
  tts?: boolean
  embeds?: unknown[]
}

/**
 * Executes a webhook and sends a message.
 * @param database - Database
 * @param parameters - Webhook execution parameters
 * @param baseUrl - Base URL
 * @returns Created message object
 */
export function executeWebhook(
  database: Database,
  parameters: WebhookExecuteParameters,
  baseUrl: string
): MessageObject {
  // Like real Discord, use the webhook ID as author.id
  const webhookUserId = parameters.webhookId
  const username = parameters.username ?? parameters.webhookName ?? 'Webhook'

  // Create the user if it does not exist (webhook users have a discriminator of '0000')
  const existingUser = database
    .prepare('SELECT id FROM users WHERE id = ?')
    .get(webhookUserId)
  if (existingUser) {
    database
      .prepare('UPDATE users SET username = ? WHERE id = ?')
      .run(username, webhookUserId)
  } else {
    database
      .prepare(
        "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, ?, '0000', 1)"
      )
      .run(webhookUserId, username)
  }

  return createMessage(
    database,
    {
      messageId: parameters.messageId,
      channelId: parameters.channelId,
      authorId: webhookUserId,
      authorToken: 'webhook',
      content: parameters.content,
      tts: parameters.tts,
      embeds: parameters.embeds,
    },
    baseUrl
  )
}
