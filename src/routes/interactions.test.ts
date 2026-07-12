import { Hono } from 'hono'
import { describe, it, expect, beforeEach } from 'vitest'
import { createInteractionRoutes } from './interactions'
import { createInteraction } from '../services/interactions'
import { initializeDatabase } from '../db'
import type { Database } from '../db'

const BASE_URL = 'http://localhost:3000'

describe('Interactions routes', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createInteractionRoutes(db, BASE_URL))

    db.prepare(
      "INSERT INTO users (id, username, discriminator, bot) VALUES ('app1', 'App', '0', 1)"
    ).run()
    db.prepare(
      "INSERT INTO channels (id, guild_id, type, name) VALUES ('chan1', NULL, 0, 'general')"
    ).run()
    db.prepare(
      "INSERT INTO users (id, username, discriminator, bot) VALUES ('user1', 'Caller', '0', 0)"
    ).run()
  })

  it('responds 204 to a valid type-4 callback', async () => {
    createInteraction(db, {
      interactionId: 'int1',
      applicationId: 'app1',
      token: 'tok1',
      type: 2,
      channelId: 'chan1',
      userId: 'user1',
    })

    const res = await app.request('/interactions/int1/tok1/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 4, data: { content: 'pong' } }),
    })
    expect(res.status).toBe(204)
  })

  it('404s for an unknown interaction', async () => {
    const res = await app.request('/interactions/missing/missing/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 5 }),
    })
    expect(res.status).toBe(404)
  })

  it('400s when the interaction has already been acknowledged', async () => {
    createInteraction(db, {
      interactionId: 'int2',
      applicationId: 'app1',
      token: 'tok2',
      type: 2,
      channelId: 'chan1',
      userId: 'user1',
    })
    await app.request('/interactions/int2/tok2/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 5 }),
    })
    const res = await app.request('/interactions/int2/tok2/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 5 }),
    })
    expect(res.status).toBe(400)
  })
})
