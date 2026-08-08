import { describe, expect, it } from 'vitest'
import { initializeDatabase } from '../db'
import {
  seedApplicationOwner,
  seedBot,
  seedChannel,
  seedGuild,
} from '../test-helpers'
import { createLobby, getLobby } from './lobbies'

describe('lobby service', () => {
  it('creates an owner member and persists a linked channel', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, ownerId } = seedApplicationOwner(db)
    const token = seedBot(db, 'Bot lobby-service', ownerId)
    const guildId = seedGuild(db, token)
    const channelId = seedChannel(db, guildId)

    const lobby = createLobby(db, {
      applicationId,
      ownerId,
      channelId,
      metadata: { mode: 'ranked' },
    })

    expect(getLobby(db, lobby.id)).toMatchObject({
      id: lobby.id,
      application_id: applicationId,
      owner_id: ownerId,
      channel_id: channelId,
      metadata: { mode: 'ranked' },
      members: [expect.objectContaining({ id: ownerId })],
    })
  })
})
