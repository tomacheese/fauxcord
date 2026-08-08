import { beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../db'
import { createAuthMiddleware, type AppEnv } from '../middleware/auth'
import { seedBot, seedGuild, seedStageChannel } from '../test-helpers'
import { createStageInstanceRoutes } from './stage-instances'

describe('stage instance routes', () => {
  let app: Hono<AppEnv>
  let token: string
  let channelId: string
  beforeEach(() => {
    const db = initializeDatabase(':memory:')
    token = seedBot(db, 'Bot stage-routes')
    const guildId = seedGuild(db, token)
    channelId = seedStageChannel(db, guildId).stageChannelId
    app = new Hono<AppEnv>()
    app.use('*', createAuthMiddleware(db, false))
    app.route('/', createStageInstanceRoutes(db))
  })
  it('creates and retrieves a stage instance', async () => {
    const create = await app.request('/stage-instances', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, topic: 'Route stage' }),
    })
    expect(create.status).toBe(200)
    const get = await app.request(`/stage-instances/${channelId}`, { headers: { Authorization: token } })
    await expect(get.json()).resolves.toMatchObject({ channel_id: channelId, topic: 'Route stage' })
  })
})
