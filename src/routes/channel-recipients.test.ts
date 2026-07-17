import { Hono } from 'hono'
import { describe, it, expect, beforeEach } from 'vitest'
import { createChannelRecipientRoutes } from './channel-recipients'
import { initializeDatabase, type Database } from '../db'
import {
  seedGroupDmChannel,
  seedBot,
  seedGuild,
  seedChannel,
} from '../test-helpers'
import { createTestUser } from '../services/test-control'

let db: Database
let app: Hono

beforeEach(() => {
  db = initializeDatabase(':memory:')
  app = new Hono()
  app.route('/', createChannelRecipientRoutes(db))
})

describe('PUT /channels/:channelId/recipients/:userId', () => {
  it('adds a recipient and returns 204', async () => {
    const channel = seedGroupDmChannel(db)
    const user = createTestUser(db, { username: 'Dave' })

    const res = await app.request(
      `/channels/${channel}/recipients/${user.id}`,
      { method: 'PUT' }
    )

    expect(res.status).toBe(204)
  })

  it('returns 400 for a non-group-DM channel', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)
    const user = createTestUser(db, { username: 'Eve' })

    const res = await app.request(
      `/channels/${channel}/recipients/${user.id}`,
      { method: 'PUT' }
    )

    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown user', async () => {
    const channel = seedGroupDmChannel(db)

    const res = await app.request(
      `/channels/${channel}/recipients/999999999999999999`,
      { method: 'PUT' }
    )

    expect(res.status).toBe(404)
  })
})

describe('DELETE /channels/:channelId/recipients/:userId', () => {
  it('removes a recipient and returns 204', async () => {
    const channel = seedGroupDmChannel(db)
    const user = createTestUser(db, { username: 'Frank' })

    await app.request(`/channels/${channel}/recipients/${user.id}`, {
      method: 'PUT',
    })
    const res = await app.request(
      `/channels/${channel}/recipients/${user.id}`,
      { method: 'DELETE' }
    )

    expect(res.status).toBe(204)
  })

  it('returns 400 for a non-group-DM channel', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)

    const res = await app.request(
      `/channels/${channel}/recipients/999999999999999999`,
      { method: 'DELETE' }
    )

    expect(res.status).toBe(400)
  })
})
