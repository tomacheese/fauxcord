import { beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../db'
import { createAuthMiddleware, type AppEnv } from '../middleware/auth'
import {
  seedApplicationOwner,
  seedBot,
  seedChannel,
  seedGuild,
} from '../test-helpers'
import { createLobbyRoutes } from './lobbies'

describe('lobby routes', () => {
  let app: Hono<AppEnv>
  let token: string
  let channelId: string

  beforeEach(() => {
    const db = initializeDatabase(':memory:')
    const application = seedApplicationOwner(db)
    token = seedBot(db, 'Bot lobby-routes', application.ownerId)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
    app = new Hono<AppEnv>()
    app.use('*', createAuthMiddleware(db, false))
    app.route('/', createLobbyRoutes(db))
  })

  it('creates a lobby and later observes its linked channel', async () => {
    const created = await app.request('/lobbies', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: { mode: 'ranked' },
        channel_id: channelId,
      }),
    })
    expect(created.status).toBe(201)
    const lobby = (await created.json()) as {
      id: string
      linked_channel: { id: string }
    }
    expect(lobby.linked_channel.id).toBe(channelId)

    const retrieved = await app.request(`/lobbies/${lobby.id}`, {
      headers: { Authorization: token },
    })
    expect(retrieved.status).toBe(200)
    await expect(retrieved.json()).resolves.toMatchObject({ id: lobby.id })
  })
})
