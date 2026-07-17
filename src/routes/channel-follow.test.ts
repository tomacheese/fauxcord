import { Hono } from 'hono'
import { describe, it, expect, beforeEach } from 'vitest'
import { createChannelFollowRoutes } from './channel-follow'
import { initializeDatabase, type Database } from '../db'
import {
  seedBot,
  seedGuild,
  seedChannel,
  seedAnnouncementChannel,
} from '../test-helpers'

let db: Database
let app: Hono

beforeEach(() => {
  db = initializeDatabase(':memory:')
  app = new Hono()
  app.route('/', createChannelFollowRoutes(db))
})

describe('POST /channels/:channelId/followers', () => {
  it('creates a webhook in the target channel and returns its IDs', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const source = seedAnnouncementChannel(db, guild)
    const target = seedChannel(db, guild, '888888888888888888')

    const res = await app.request(`/channels/${source}/followers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_channel_id: target }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.channel_id).toBe(source)
    expect(typeof body.webhook_id).toBe('string')
  })

  it('returns 400 CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE for a non-announcement channel', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const source = seedChannel(db, guild)
    const target = seedChannel(db, guild, '888888888888888888')

    const res = await app.request(`/channels/${source}/followers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_channel_id: target }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe(50_024)
  })

  it('returns 404 when webhook_channel_id does not exist', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const source = seedAnnouncementChannel(db, guild)

    const res = await app.request(`/channels/${source}/followers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_channel_id: '999999999999999999' }),
    })

    expect(res.status).toBe(404)
  })

  it('returns 400 INVALID_FORM_BODY when webhook_channel_id is missing', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const source = seedAnnouncementChannel(db, guild)

    const res = await app.request(`/channels/${source}/followers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })
})
