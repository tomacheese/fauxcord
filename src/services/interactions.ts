/**
 * Interaction operations service
 *
 * Persists interactions, converts them into Discord-shaped response
 * objects, dispatches INTERACTION_CREATE, resolves followup-message
 * targets, and handles the callback (initial response) endpoint.
 */

import type { Database } from '../db'
import { generateSnowflake } from '../snowflake'
import { gatewayBus } from '../gateway/bus'
import { getGuildMember } from './guild-members'
import { getUser } from './users'
import { createMessage, type MessageObject } from './messages'

/** Interaction object for API responses and Gateway dispatch */
export interface InteractionObject {
  id: string
  application_id: string
  type: number
  data?: Record<string, unknown>
  guild_id?: string
  channel_id?: string
  member?: Record<string, unknown>
  user?: Record<string, unknown>
  token: string
  version: number
}

/** Interaction record type retrieved from the DB */
interface InteractionRow {
  id: string
  application_id: string
  token: string
  type: number
  guild_id: string | null
  channel_id: string | null
  command_id: string | null
  data: string
  user_id: string
  member_json: string | null
  responded: number
  initial_response_message_id: string | null
  created_at: string
}

/**
 * Converts a DB interaction record into the API response / Gateway payload
 * format. Re-fetches the command's name/type from `application_commands`
 * (when `command_id` is set) so `data` always reflects the current command
 * registration rather than a stale snapshot.
 * @param db - Database
 * @param row - DB record
 * @returns Interaction object
 */
function toInteractionObject(
  db: Database,
  row: InteractionRow
): InteractionObject {
  const storedData = JSON.parse(row.data) as Record<string, unknown>
  let data: Record<string, unknown> | undefined

  if (row.command_id) {
    const cmd = db
      .prepare('SELECT name, type FROM application_commands WHERE id = ?')
      .get(row.command_id) as { name: string; type: number } | undefined
    data = {
      id: row.command_id,
      name: cmd?.name ?? '',
      type: cmd?.type ?? 1,
      ...storedData,
    }
  } else if (Object.keys(storedData).length > 0) {
    data = storedData
  }

  const result: InteractionObject = {
    id: row.id,
    application_id: row.application_id,
    type: row.type,
    token: row.token,
    version: 1,
  }
  if (data) result.data = data
  if (row.channel_id) result.channel_id = row.channel_id

  if (row.guild_id) {
    result.guild_id = row.guild_id
    const member = getGuildMember(db, row.guild_id, row.user_id)
    if (member) result.member = member as unknown as Record<string, unknown>
  } else {
    const user = getUser(db, row.user_id)
    if (user) result.user = user as unknown as Record<string, unknown>
  }

  return result
}

/** Parameters used to create a new interaction */
export interface CreateInteractionParams {
  interactionId: string
  applicationId: string
  token: string
  type: number
  guildId?: string
  channelId?: string
  commandId?: string
  data?: Record<string, unknown>
  userId: string
}

/**
 * Inserts a new interaction row and emits `interaction.create` for Gateway
 * dispatch.
 * @param db - Database
 * @param params - Interaction creation parameters
 * @returns The created interaction object
 */
export function createInteraction(
  db: Database,
  params: CreateInteractionParams
): InteractionObject {
  db.prepare(
    `INSERT INTO interactions
       (id, application_id, token, type, guild_id, channel_id, command_id, data, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.interactionId,
    params.applicationId,
    params.token,
    params.type,
    params.guildId ?? null,
    params.channelId ?? null,
    params.commandId ?? null,
    JSON.stringify(params.data ?? {}),
    params.userId
  )

  const row = db
    .prepare('SELECT * FROM interactions WHERE id = ?')
    .get(params.interactionId) as InteractionRow
  const interaction = toInteractionObject(db, row)

  gatewayBus.emit('interaction.create', {
    applicationId: params.applicationId,
    interaction: interaction as unknown as Record<string, unknown>,
  })

  return interaction
}

/**
 * Resolves the channel an interaction's followup messages should target,
 * treating `(application_id, token)` as `(webhook_id, webhook_token)` per
 * Discord's own followup-message convention.
 * @param db - Database
 * @param applicationId - Application ID (used as the pseudo-webhook ID)
 * @param token - Interaction token (used as the pseudo-webhook token)
 * @returns The target channel and the initial response's message ID, or
 * null when no interaction matches
 */
export function getInteractionFollowupTarget(
  db: Database,
  applicationId: string,
  token: string
): { channelId: string; initialResponseMessageId: string | null } | null {
  const row = db
    .prepare(
      'SELECT channel_id, initial_response_message_id FROM interactions WHERE application_id = ? AND token = ?'
    )
    .get(applicationId, token) as
    | { channel_id: string | null; initial_response_message_id: string | null }
    | undefined
  if (!row?.channel_id) return null
  return {
    channelId: row.channel_id,
    initialResponseMessageId: row.initial_response_message_id,
  }
}

/** Callback (initial response) payload for POST .../callback */
export interface InteractionCallbackPayload {
  type: number
  data?: {
    content?: string
    embeds?: unknown[]
    tts?: boolean
    flags?: number
  }
}

/** Result of an interaction callback attempt */
export interface InteractionCallbackResponse {
  interaction: {
    id: string
    type: number
    response_message_id?: string
    channel_id?: string
    guild_id?: string
  }
  resource?: {
    type: number
    message: MessageObject
  }
}

/** Result of an interaction callback attempt. */
export type InteractionCallbackResult =
  | { ok: true; response: InteractionCallbackResponse }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_responded' }

/**
 * Handles POST /interactions/:id/:token/callback. Type 4 (CHANNEL_MESSAGE_
 * WITH_SOURCE) creates a message in the interaction's channel and records
 * it as the initial response; types 5/6/7/9 (deferred/component-ack/modal)
 * only mark the interaction as responded, matching this mock's documented
 * simplification (no placeholder "thinking..." message is modeled).
 * @param db - Database
 * @param interactionId - `:interactionId` route param
 * @param token - `:interactionToken` route param
 * @param payload - Callback request body
 * @param baseUrl - Base URL (for message attachment URLs)
 * @returns Result of the callback attempt
 */
export function handleInteractionCallback(
  db: Database,
  interactionId: string,
  token: string,
  payload: InteractionCallbackPayload,
  baseUrl: string
): InteractionCallbackResult {
  const row = db
    .prepare('SELECT * FROM interactions WHERE id = ? AND token = ?')
    .get(interactionId, token) as InteractionRow | undefined
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.responded === 1) return { ok: false, reason: 'already_responded' }

  const interaction: InteractionCallbackResponse['interaction'] = {
    id: row.id,
    type: row.type,
  }
  if (row.channel_id) interaction.channel_id = row.channel_id
  if (row.guild_id) interaction.guild_id = row.guild_id

  let resource: InteractionCallbackResponse['resource']
  if (payload.type === 4 && row.channel_id) {
    const messageId = generateSnowflake()
    const message = createMessage(
      db,
      {
        messageId,
        channelId: row.channel_id,
        authorId: row.application_id,
        authorToken: 'interaction',
        content: payload.data?.content,
        tts: payload.data?.tts,
        embeds: payload.data?.embeds,
        flags: payload.data?.flags,
      },
      baseUrl
    )
    db.prepare(
      'UPDATE interactions SET responded = 1, initial_response_message_id = ? WHERE id = ?'
    ).run(messageId, row.id)
    interaction.response_message_id = messageId
    resource = { type: 4, message }
  } else {
    db.prepare('UPDATE interactions SET responded = 1 WHERE id = ?').run(row.id)
  }

  return {
    ok: true,
    response: resource ? { interaction, resource } : { interaction },
  }
}
