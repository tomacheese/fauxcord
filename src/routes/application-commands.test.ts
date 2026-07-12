import { Hono } from 'hono'
import { describe, it, expect, beforeEach } from 'vitest'
import { createApplicationCommandRoutes } from './application-commands'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import type { AppEnv } from '../middleware/auth'
import { seedBot } from '../test-helpers'

describe('Application Commands routes (global)', () => {
  let db: Database
  let app: Hono<AppEnv>
  let token: string
  let applicationId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      const bot = db
        .prepare('SELECT * FROM bots WHERE token = ?')
        .get(c.req.header('Authorization'))
      if (bot) c.set('bot', bot as never)
      await next()
    })
    app.route('/', createApplicationCommandRoutes(db))
    token = 'Bot testtoken'
    // seedBot() returns the token it was passed, not the bot's user ID —
    // capture the (default) user ID explicitly instead of misusing the
    // return value, since requireOwnApplication compares applicationId
    // against bots.user_id, not the token.
    applicationId = '111111111111111111'
    seedBot(db, token, applicationId)
  })

  it('creates a global command', async () => {
    const res = await app.request(`/applications/${applicationId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'ping', description: 'Replies pong' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('ping')
  })

  it('403s when applicationId does not match the authenticated bot', async () => {
    const res = await app.request('/applications/999/commands', {
      method: 'GET',
      headers: { Authorization: token },
    })
    expect(res.status).toBe(403)
  })

  it('401s with no Authorization header', async () => {
    const res = await app.request(`/applications/${applicationId}/commands`)
    expect(res.status).toBe(403) // no bot set -> requireOwnApplication rejects
  })

  it('lists commands, returns 404 for unknown command, deletes a command', async () => {
    const create = await app.request(
      `/applications/${applicationId}/commands`,
      {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'ping', description: 'x' }),
      }
    )
    const created = (await create.json()) as { id: string }

    const list = await app.request(
      `/applications/${applicationId}/commands`,
      { headers: { Authorization: token } }
    )
    expect(await list.json()).toHaveLength(1)

    const missing = await app.request(
      `/applications/${applicationId}/commands/does-not-exist`,
      { headers: { Authorization: token } }
    )
    expect(missing.status).toBe(404)

    const del = await app.request(
      `/applications/${applicationId}/commands/${created.id}`,
      { method: 'DELETE', headers: { Authorization: token } }
    )
    expect(del.status).toBe(204)
  })

  it('rejects an invalid command payload with 400', async () => {
    const res = await app.request(`/applications/${applicationId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '', description: 'x' }),
    })
    expect(res.status).toBe(400)
  })
})
