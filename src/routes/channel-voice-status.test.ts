import { Hono } from 'hono'
import { describe, it, expect, beforeEach } from 'vitest'
import { createChannelVoiceStatusRoutes } from './channel-voice-status'
import { initializeDatabase, type Database } from '../db'
import {
  seedBot,
  seedGuild,
  seedChannel,
  seedVoiceChannel,
} from '../test-helpers'

let db: Database
let app: Hono

beforeEach(() => {
  db = initializeDatabase(':memory:')
  app = new Hono()
  app.route('/', createChannelVoiceStatusRoutes(db))
})

describe('PUT /channels/:channelId/voice-status', () => {
  it('sets the voice status and returns 204', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedVoiceChannel(db, guild)

    const res = await app.request(`/channels/${channel}/voice-status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'live now' }),
    })

    expect(res.status).toBe(204)
  })

  it('returns 400 CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE for a text channel', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)

    const res = await app.request(`/channels/${channel}/voice-status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'live now' }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe(50_024)
  })

  it('returns 404 for an unknown channel', async () => {
    const res = await app.request('/channels/999999999999999999/voice-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'x' }),
    })

    expect(res.status).toBe(404)
  })

  it('returns 400 INVALID_FORM_BODY for a too-long status', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedVoiceChannel(db, guild)

    const res = await app.request(`/channels/${channel}/voice-status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'a'.repeat(501) }),
    })

    expect(res.status).toBe(400)
  })
})
