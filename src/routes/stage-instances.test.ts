import { beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import { createAuthMiddleware, type AppEnv } from '../middleware/auth'
import {
  seedBot,
  seedGuild,
  seedScheduledEvent,
  seedStageChannel,
} from '../test-helpers'
import { createStageInstanceRoutes } from './stage-instances'

describe('stage instance routes', () => {
  let app: Hono<AppEnv>
  let db: Database
  let token: string
  let channelId: string
  beforeEach(() => {
    db = initializeDatabase(':memory:')
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
    const get = await app.request(`/stage-instances/${channelId}`, {
      headers: { Authorization: token },
    })
    await expect(get.json()).resolves.toMatchObject({
      channel_id: channelId,
      topic: 'Route stage',
    })
  })

  it('rejects a different Bot from creating, changing, or deleting a stage instance', async () => {
    const otherToken = seedBot(db, 'Bot other-stage-routes')
    const deniedHeaders = {
      Authorization: otherToken,
      'Content-Type': 'application/json',
    }
    const createDenied = await app.request('/stage-instances', {
      method: 'POST',
      headers: deniedHeaders,
      body: JSON.stringify({ channel_id: channelId, topic: 'Denied' }),
    })
    expect(createDenied.status).toBe(403)

    const create = await app.request('/stage-instances', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, topic: 'Owned' }),
    })
    expect(create.status).toBe(200)
    const getDenied = await app.request(`/stage-instances/${channelId}`, {
      headers: { Authorization: otherToken },
    })
    expect(getDenied.status).toBe(403)
    const patchDenied = await app.request(`/stage-instances/${channelId}`, {
      method: 'PATCH',
      headers: deniedHeaders,
      body: JSON.stringify({ topic: 'Stolen' }),
    })
    expect(patchDenied.status).toBe(403)
    const deleteDenied = await app.request(`/stage-instances/${channelId}`, {
      method: 'DELETE',
      headers: { Authorization: otherToken },
    })
    expect(deleteDenied.status).toBe(403)
  })

  it('rejects invalid runtime fields and a scheduled event from another guild', async () => {
    const otherToken = seedBot(db, 'Bot other-stage-event')
    const otherGuildId = seedGuild(db, otherToken, '922222222222222222')
    const otherChannelId = seedStageChannel(db, otherGuildId).stageChannelId
    const otherEventId = seedScheduledEvent(
      db,
      otherGuildId,
      db
        .prepare('SELECT user_id FROM bots WHERE token = ?')
        .pluck()
        .get(otherToken) as string,
      otherChannelId
    ).eventId
    const headers = { Authorization: token, 'Content-Type': 'application/json' }
    for (const body of [
      { channel_id: channelId, topic: 123, privacy_level: 2 },
      { channel_id: channelId, topic: 'Valid', privacy_level: 999 },
      {
        channel_id: channelId,
        topic: 'Valid',
        guild_scheduled_event_id: otherEventId,
      },
    ]) {
      const response = await app.request('/stage-instances', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 50_035 })
    }
    const create = await app.request('/stage-instances', {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel_id: channelId, topic: 'Valid' }),
    })
    expect(create.status).toBe(200)
    for (const body of [{ topic: 123 }, { privacy_level: 999 }]) {
      const response = await app.request(`/stage-instances/${channelId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 50_035 })
    }
  })
})
