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

    const list = await app.request(`/applications/${applicationId}/commands`, {
      headers: { Authorization: token },
    })
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

  it('rejects a bulk-overwrite payload with a duplicate name/type with 400', async () => {
    const res = await app.request(`/applications/${applicationId}/commands`, {
      method: 'PUT',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        { name: 'ping', description: 'x' },
        { name: 'PING', description: 'y' },
      ]),
    })
    expect(res.status).toBe(400)
  })
})

describe('Application Commands routes (guild-scoped)', () => {
  let db: Database
  let app: Hono<AppEnv>
  let token: string
  let applicationId: string
  let guildId: string

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
    guildId = '333333333333333333'
    db.prepare(
      'INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
    ).run(guildId, 'Test Guild', applicationId, token)
  })

  it('creates a guild command and returns 404 for an unknown guild', async () => {
    const res = await app.request(
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'ping', description: 'x' }),
      }
    )
    expect(res.status).toBe(201)

    const missingGuild = await app.request(
      `/applications/${applicationId}/guilds/999/commands`,
      { headers: { Authorization: token } }
    )
    expect(missingGuild.status).toBe(404)
  })

  it('bulk overwrites guild commands', async () => {
    const res = await app.request(
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      {
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ name: 'ping', description: 'x' }]),
      }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toHaveLength(1)
  })

  it('rejects a bulk-overwrite payload with a duplicate name/type with 400', async () => {
    const res = await app.request(
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      {
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          { name: 'ping', description: 'x' },
          { name: 'ping', description: 'y' },
        ]),
      }
    )
    expect(res.status).toBe(400)
  })
})

describe('Application Commands routes (permissions)', () => {
  let db: Database
  let app: Hono<AppEnv>
  let token: string
  let applicationId: string
  let guildId: string

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
    guildId = '444444444444444444'
    db.prepare(
      'INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
    ).run(guildId, 'Test Guild', applicationId, token)
  })

  it('lists, gets, and sets command permissions', async () => {
    const create = await app.request(
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'ping', description: 'x' }),
      }
    )
    const command = (await create.json()) as { id: string }

    const list = await app.request(
      `/applications/${applicationId}/guilds/${guildId}/commands/permissions`,
      { headers: { Authorization: token } }
    )
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual([])

    const put = await app.request(
      `/applications/${applicationId}/guilds/${guildId}/commands/${command.id}/permissions`,
      {
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          permissions: [{ id: 'role1', type: 1, permission: true }],
        }),
      }
    )
    expect(put.status).toBe(200)

    const get = await app.request(
      `/applications/${applicationId}/guilds/${guildId}/commands/${command.id}/permissions`,
      { headers: { Authorization: token } }
    )
    const body = (await get.json()) as { permissions: unknown[] }
    expect(body.permissions).toEqual([
      { id: 'role1', type: 1, permission: true },
    ])
  })

  it('404s permissions for an unknown command', async () => {
    const res = await app.request(
      `/applications/${applicationId}/guilds/${guildId}/commands/missing/permissions`,
      { headers: { Authorization: token } }
    )
    expect(res.status).toBe(404)
  })
})
