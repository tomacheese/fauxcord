import { runInTransaction, type Database } from '../db'
import { generateSnowflake } from '../snowflake'
import { getChannel } from './channels'
import { getUser } from './users'

type StringMap = Record<string, string>

export interface LobbyMemberObject {
  id: string
  metadata: StringMap | null
  flags: number
  additional_name?: string
}

export interface LobbyObject {
  id: string
  application_id: string
  metadata: StringMap | null
  members: LobbyMemberObject[]
  linked_channel?: ReturnType<typeof getChannel>
  flags: number
  override_event_webhooks_url: string | null
  owner_id: string
  channel_id: string | null
}

interface LobbyRow {
  id: string
  application_id: string
  owner_id: string
  linked_channel_id: string | null
  metadata: string | null
  flags: number
  override_event_webhooks_url: string | null
}

interface LobbyMemberRow {
  user_id: string
  metadata: string | null
  flags: number
  additional_name: string | null
}

function parseMap(value: string | null): StringMap | null {
  return value === null ? null : (JSON.parse(value) as StringMap)
}

function listMembers(db: Database, lobbyId: string): LobbyMemberObject[] {
  return (
    db
      .prepare(
        `SELECT user_id, metadata, flags, additional_name
         FROM lobby_members WHERE lobby_id = ? ORDER BY joined_at, user_id`
      )
      .all(lobbyId) as LobbyMemberRow[]
  ).map((member) => ({
    id: member.user_id,
    metadata: parseMap(member.metadata),
    flags: member.flags,
    additional_name: member.additional_name ?? '',
  }))
}

function toLobby(db: Database, row: LobbyRow): LobbyObject {
  const linkedChannel = row.linked_channel_id
    ? getChannel(db, row.linked_channel_id)
    : null
  return {
    id: row.id,
    application_id: row.application_id,
    metadata: parseMap(row.metadata),
    members: listMembers(db, row.id),
    ...(linkedChannel !== null && { linked_channel: linkedChannel }),
    flags: row.flags,
    override_event_webhooks_url: row.override_event_webhooks_url,
    owner_id: row.owner_id,
    channel_id: row.linked_channel_id,
  }
}

export function getLobby(db: Database, lobbyId: string): LobbyObject | null {
  const row = db.prepare('SELECT * FROM lobbies WHERE id = ?').get(lobbyId) as
    LobbyRow | undefined
  return row ? toLobby(db, row) : null
}

export function createLobby(
  db: Database,
  input: {
    applicationId: string
    ownerId: string
    channelId?: string | null
    metadata?: StringMap | null
    flags?: number
    overrideEventWebhooksUrl?: string | null
    members?: {
      userId: string
      metadata?: StringMap | null
      flags?: number
      additionalName?: string | null
    }[]
  }
): LobbyObject {
  return runInTransaction(db, () => {
    const id = generateSnowflake()
    db.prepare(
      `INSERT INTO lobbies
         (id, application_id, owner_id, linked_channel_id, metadata, flags,
          override_event_webhooks_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.applicationId,
      input.ownerId,
      input.channelId ?? null,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
      input.flags ?? 0,
      input.overrideEventWebhooksUrl ?? null
    )
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- The exported mutation helper is declared below with the rest of member operations.
    addOrUpdateMember(db, id, input.ownerId, {})
    const members = input.members ?? []
    for (const member of members) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define -- The exported mutation helper is declared below with the rest of member operations.
      addOrUpdateMember(db, id, member.userId, member)
    }
    const lobby = getLobby(db, id)
    if (!lobby) throw new Error('created lobby is missing')
    return lobby
  })
}

export function updateLobby(
  db: Database,
  lobbyId: string,
  input: {
    metadata?: StringMap | null
    flags?: number
    overrideEventWebhooksUrl?: string | null
    members?: {
      userId: string
      metadata?: StringMap | null
      flags?: number
      additionalName?: string | null
    }[]
  }
): LobbyObject | null {
  return runInTransaction(db, () => {
    const current = getLobby(db, lobbyId)
    if (!current) return null
    db.prepare(
      `UPDATE lobbies SET metadata = ?, flags = ?, override_event_webhooks_url = ?,
       updated_at = datetime('now') WHERE id = ?`
    ).run(
      input.metadata === undefined
        ? current.metadata
        : JSON.stringify(input.metadata),
      input.flags ?? current.flags,
      input.overrideEventWebhooksUrl === undefined
        ? current.override_event_webhooks_url
        : input.overrideEventWebhooksUrl,
      lobbyId
    )
    const members = input.members ?? []
    for (const member of members) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define -- The exported mutation helper is declared below with the rest of member operations.
      addOrUpdateMember(db, lobbyId, member.userId, member)
    }
    return getLobby(db, lobbyId)
  })
}

export function updateLobbyChannel(
  db: Database,
  lobbyId: string,
  channelId: string | null
): LobbyObject | null {
  if (channelId !== null && !getChannel(db, channelId)) return null
  return runInTransaction(db, () => {
    if (!getLobby(db, lobbyId)) return null
    db.prepare(
      `UPDATE lobbies SET linked_channel_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(channelId, lobbyId)
    return getLobby(db, lobbyId)
  })
}

export function deleteLobby(db: Database, lobbyId: string): boolean {
  return runInTransaction(
    db,
    () =>
      db.prepare('DELETE FROM lobbies WHERE id = ?').run(lobbyId).changes > 0
  )
}

export function isLobbyMember(
  db: Database,
  lobbyId: string,
  userId: string
): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM lobby_members WHERE lobby_id = ? AND user_id = ?')
      .get(lobbyId, userId)
  )
}

export function addOrUpdateMember(
  db: Database,
  lobbyId: string,
  userId: string,
  input: {
    metadata?: StringMap | null
    flags?: number
    additionalName?: string | null
  }
): LobbyMemberObject | null {
  if (!getUser(db, userId)) return null
  const existing = db
    .prepare('SELECT * FROM lobby_members WHERE lobby_id = ? AND user_id = ?')
    .get(lobbyId, userId) as LobbyMemberRow | undefined
  db.prepare(
    `INSERT INTO lobby_members (lobby_id, user_id, metadata, flags, additional_name)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lobby_id, user_id) DO UPDATE SET metadata = excluded.metadata,
       flags = excluded.flags, additional_name = excluded.additional_name`
  ).run(
    lobbyId,
    userId,
    input.metadata === undefined
      ? (existing?.metadata ?? null)
      : JSON.stringify(input.metadata),
    input.flags ?? existing?.flags ?? 0,
    input.additionalName === undefined
      ? (existing?.additional_name ?? null)
      : input.additionalName
  )
  return listMembers(db, lobbyId).find((member) => member.id === userId) ?? null
}

export function deleteLobbyMember(
  db: Database,
  lobbyId: string,
  userId: string
): boolean {
  return runInTransaction(
    db,
    () =>
      db
        .prepare('DELETE FROM lobby_members WHERE lobby_id = ? AND user_id = ?')
        .run(lobbyId, userId).changes > 0
  )
}

export interface LobbyMessageObject {
  id: string
  type: number
  content: string
  lobby_id: string
  channel_id: string
  author: NonNullable<ReturnType<typeof getUser>>
  lobby_member?: LobbyMemberObject
  metadata?: StringMap
  moderation_metadata?: StringMap
  flags: number
  application_id: string
}

interface LobbyMessageRow {
  id: string
  type: number
  content: string
  lobby_id: string
  channel_id: string
  author_id: string
  application_id: string
  metadata: string | null
  moderation_metadata: string | null
  flags: number
}

function toLobbyMessage(
  db: Database,
  row: LobbyMessageRow
): LobbyMessageObject | null {
  const author = getUser(db, row.author_id)
  if (!author) return null
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    lobby_id: row.lobby_id,
    channel_id: row.channel_id,
    author,
    ...(listMembers(db, row.lobby_id).find(
      (member) => member.id === row.author_id
    ) && {
      lobby_member: listMembers(db, row.lobby_id).find(
        (member) => member.id === row.author_id
      ),
    }),
    ...(row.metadata !== null && { metadata: parseMap(row.metadata) ?? {} }),
    ...(row.moderation_metadata !== null && {
      moderation_metadata: parseMap(row.moderation_metadata) ?? {},
    }),
    flags: row.flags,
    application_id: row.application_id,
  }
}

export function listLobbyMessages(
  db: Database,
  lobbyId: string,
  limit = 50
): LobbyMessageObject[] {
  return (
    db
      .prepare(
        'SELECT * FROM lobby_messages WHERE lobby_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(lobbyId, limit) as LobbyMessageRow[]
  ).flatMap((row) => {
    const message = toLobbyMessage(db, row)
    return message ? [message] : []
  })
}

export function createLobbyMessage(
  db: Database,
  input: {
    lobbyId: string
    authorId: string
    content?: string | null
    metadata?: StringMap
    flags?: number
  }
): LobbyMessageObject | null {
  const lobby = getLobby(db, input.lobbyId)
  if (!lobby?.channel_id || !isLobbyMember(db, input.lobbyId, input.authorId))
    return null
  const id = generateSnowflake()
  db.prepare(
    `INSERT INTO lobby_messages (id, lobby_id, channel_id, author_id, application_id, content, metadata, flags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.lobbyId,
    lobby.channel_id,
    input.authorId,
    lobby.application_id,
    input.content ?? '',
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.flags ?? 0
  )
  const row = db
    .prepare('SELECT * FROM lobby_messages WHERE id = ?')
    .get(id) as LobbyMessageRow
  return toLobbyMessage(db, row)
}

export function updateLobbyMessageModeration(
  db: Database,
  lobbyId: string,
  messageId: string,
  metadata: StringMap
): boolean {
  return runInTransaction(
    db,
    () =>
      db
        .prepare(
          'UPDATE lobby_messages SET moderation_metadata = ? WHERE id = ? AND lobby_id = ?'
        )
        .run(JSON.stringify(metadata), messageId, lobbyId).changes > 0
  )
}
