/**
 * Webhook operations service
 *
 * Provides webhook CRUD operations and execution.
 */

import type { Database } from '../db.js'
import type { MessageObject } from './messages.js'
import { createMessage } from './messages.js'

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
    guild_id: row.guild_id,
    channel_id: row.channel_id,
    name: row.name,
    avatar: row.avatar,
    token: row.token,
  }
}

/**
 * Retrieves a webhook by ID.
 * @param db - Database
 * @param webhookId - Webhook ID
 * @returns Webhook object, or null
 */
export function getWebhook(
  db: Database,
  webhookId: string
): WebhookObject | null {
  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow | undefined
  return row ? toWebhookObject(row) : null
}

/**
 * Retrieves a webhook by ID and token.
 * @param db - Database
 * @param webhookId - Webhook ID
 * @param token - Webhook token
 * @returns Webhook object, or null
 */
export function getWebhookByToken(
  db: Database,
  webhookId: string,
  token: string
): WebhookObject | null {
  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ? AND token = ?')
    .get(webhookId, token) as WebhookRow | undefined
  return row ? toWebhookObject(row) : null
}

/**
 * Retrieves the list of webhooks for a channel.
 * @param db - Database
 * @param channelId - Channel ID
 * @returns Array of webhook objects
 */
export function getChannelWebhooks(
  db: Database,
  channelId: string
): WebhookObject[] {
  const rows = db
    .prepare('SELECT * FROM webhooks WHERE channel_id = ?')
    .all(channelId) as WebhookRow[]
  return rows.map((row) => toWebhookObject(row))
}

/**
 * Retrieves the list of webhooks for a guild.
 * @param db - Database
 * @param guildId - Guild ID
 * @returns Array of webhook objects
 */
export function getGuildWebhooks(
  db: Database,
  guildId: string
): WebhookObject[] {
  const rows = db
    .prepare('SELECT * FROM webhooks WHERE guild_id = ?')
    .all(guildId) as WebhookRow[]
  return rows.map((row) => toWebhookObject(row))
}

/** Webhook creation parameters */
export interface WebhookCreateParams {
  webhookId: string
  channelId: string
  guildId: string | null
  name: string
  avatar?: string | null
  token: string
}

/**
 * Creates a webhook.
 * @param db - Database
 * @param params - Webhook creation parameters
 * @returns Created webhook object
 */
export function createWebhook(
  db: Database,
  params: WebhookCreateParams
): WebhookObject {
  db.prepare(
    'INSERT INTO webhooks (id, guild_id, channel_id, name, avatar, token) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    params.webhookId,
    params.guildId,
    params.channelId,
    params.name,
    params.avatar ?? null,
    params.token
  )

  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(params.webhookId) as WebhookRow
  return toWebhookObject(row)
}

/**
 * Updates a webhook.
 * @param db - Database
 * @param webhookId - Webhook ID
 * @param payload - Update payload (avatar is cleared with null)
 * @returns Updated webhook object, or null
 */
export function updateWebhook(
  db: Database,
  webhookId: string,
  payload: { name?: string; avatar?: string | null; channel_id?: string }
): WebhookObject | null {
  const current = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow | undefined
  if (!current) return null

  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) updates.name = payload.name
  if (payload.avatar !== undefined) updates.avatar = payload.avatar
  if (payload.channel_id !== undefined) {
    updates.channel_id = payload.channel_id
    // Update the guild ID as well
    const channel = db
      .prepare('SELECT guild_id FROM channels WHERE id = ?')
      .get(payload.channel_id) as { guild_id: string | null } | undefined
    if (channel) updates.guild_id = channel.guild_id
  }

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(', ')
    db.prepare(`UPDATE webhooks SET ${setClauses} WHERE id = ?`).run(
      ...Object.values(updates),
      webhookId
    )
  }

  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(webhookId) as WebhookRow
  return toWebhookObject(row)
}

/**
 * Deletes a webhook.
 * @param db - Database
 * @param webhookId - Webhook ID
 * @returns true on successful deletion
 */
export function deleteWebhook(db: Database, webhookId: string): boolean {
  const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(webhookId)
  return result.changes > 0
}

/** Webhook execution parameters */
export interface WebhookExecuteParams {
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
 * @param db - Database
 * @param params - Webhook execution parameters
 * @param baseUrl - Base URL
 * @returns Created message object
 */
export function executeWebhook(
  db: Database,
  params: WebhookExecuteParams,
  baseUrl: string
): MessageObject {
  // Like real Discord, use the webhook ID as author.id
  const webhookUserId = params.webhookId
  const username = params.username ?? params.webhookName ?? 'Webhook'

  // Create the user if it does not exist (webhook users have a discriminator of '0000')
  const existingUser = db
    .prepare('SELECT id FROM users WHERE id = ?')
    .get(webhookUserId)
  if (existingUser) {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(
      username,
      webhookUserId
    )
  } else {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, ?, '0000', 1)"
    ).run(webhookUserId, username)
  }

  return createMessage(
    db,
    {
      messageId: params.messageId,
      channelId: params.channelId,
      authorId: webhookUserId,
      authorToken: 'webhook',
      content: params.content,
      tts: params.tts,
      embeds: params.embeds,
    },
    baseUrl
  )
}
