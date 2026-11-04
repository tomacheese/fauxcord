import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelPermissionRoutes } from './channel-permissions'
import { initializeDatabase, closeDatabase } from '../db'
import {
  seedBot,
  seedGuild,
  seedChannel,
  seedMember,
  seedRole,
  createFullTestApp,
} from '../test-helpers'
import { getChannel, putChannelOverwrite } from '../services/channels'
import type { Database } from '../db'

describe('Channel Permissions API', () => {
  let db: Database
  let app: Hono
  let channelId: string
  const OVERWRITE_ID = '444444444444444444'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelPermissionRoutes(db))
    const token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('PUT creates an overwrite and returns 204, reflected in the channel', async () => {
    const res = await app.request(
      `/channels/${channelId}/permissions/${OVERWRITE_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 0, allow: '1024', deny: '2048' }),
      }
    )
    expect(res.status).toBe(204)
    expect(getChannel(db, channelId)?.permission_overwrites).toEqual([
      { id: OVERWRITE_ID, type: 0, allow: '1024', deny: '2048' },
    ])
  })

  it('PUT upserts without duplicating', async () => {
    const put = (allow: string) =>
      app.request(`/channels/${channelId}/permissions/${OVERWRITE_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 0, allow, deny: '0' }),
      })
    await put('1024')
    await put('8')
    const overwrites = getChannel(db, channelId)?.permission_overwrites
    expect(overwrites).toHaveLength(1)
    expect(overwrites?.[0].allow).toBe('8')
  })

  it('PUT returns 400 (50035) when type is missing', async () => {
    const res = await app.request(
      `/channels/${channelId}/permissions/${OVERWRITE_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow: '1024' }),
      }
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: number }).code).toBe(50_035)
  })

  it('PUT returns 400 when allow is not numeric', async () => {
    const res = await app.request(
      `/channels/${channelId}/permissions/${OVERWRITE_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 0, allow: 'nope' }),
      }
    )
    expect(res.status).toBe(400)
  })

  it('PUT returns 404 (10003) for an unknown channel', async () => {
    const res = await app.request(
      `/channels/999999999999999999/permissions/${OVERWRITE_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 0 }),
      }
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: number }).code).toBe(10_003)
  })

  it('DELETE removes an overwrite and returns 204', async () => {
    await app.request(`/channels/${channelId}/permissions/${OVERWRITE_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 0, allow: '1024' }),
    })
    const res = await app.request(
      `/channels/${channelId}/permissions/${OVERWRITE_ID}`,
      { method: 'DELETE' }
    )
    expect(res.status).toBe(204)
    expect(getChannel(db, channelId)?.permission_overwrites).toEqual([])
  })

  it('DELETE is idempotent (204 for a non-existent overwrite)', async () => {
    const res = await app.request(
      `/channels/${channelId}/permissions/${OVERWRITE_ID}`,
      { method: 'DELETE' }
    )
    expect(res.status).toBe(204)
  })

  it('DELETE returns 404 (10003) for an unknown channel', async () => {
    const res = await app.request(
      `/channels/999999999999999999/permissions/${OVERWRITE_ID}`,
      { method: 'DELETE' }
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: number }).code).toBe(10_003)
  })
})

describe('Channel computed permissions API', () => {
  const VIEW = 1n << 10n
  const SEND = 1n << 11n
  let db: Database
  let app: Hono
  let guildId: string
  let channelId: string
  let memberId: string
  let roleId: string

  /**
   * Requests a computed-permissions endpoint.
   * @param path - Request path
   * @returns The response
   */
  const get = (path: string) => app.request(path)

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelPermissionRoutes(db))
    guildId = seedGuild(db, seedBot(db))
    db.prepare(
      `INSERT INTO roles (id, guild_id, name, permissions, position)
       VALUES (?, ?, '@everyone', ?, 0)`
    ).run(guildId, guildId, (VIEW | SEND).toString())
    channelId = seedChannel(db, guildId)
    memberId = seedMember(db, guildId)
    roleId = seedRole(db, guildId)
    putChannelOverwrite(db, channelId, guildId, {
      type: 0,
      allow: '0',
      deny: SEND.toString(),
    })
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('GET member returns the cascaded permissions as a decimal string', async () => {
    const res = await get(
      `/channels/${channelId}/permissions/member/${memberId}`
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ permissions: VIEW.toString() })
  })

  it('GET role returns the cascaded permissions as a decimal string', async () => {
    const res = await get(`/channels/${channelId}/permissions/role/${roleId}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ permissions: VIEW.toString() })
  })

  it('accepts the implicit query parameter without changing the result', async () => {
    const res = await get(
      `/channels/${channelId}/permissions/member/${memberId}?implicit=true`
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ permissions: VIEW.toString() })
  })

  it.each(['member', 'role'])(
    'GET %s returns 404 (10003) for an unknown channel',
    async (kind) => {
      const res = await get(`/channels/999/permissions/${kind}/${memberId}`)
      expect(res.status).toBe(404)
      expect(((await res.json()) as { code: number }).code).toBe(10_003)
    }
  )

  it('GET member returns 404 (10007) for an unknown member', async () => {
    const res = await get(`/channels/${channelId}/permissions/member/999`)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: number }).code).toBe(10_007)
  })

  it('GET role returns 404 (10011) for an unknown role', async () => {
    const res = await get(`/channels/${channelId}/permissions/role/999`)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: number }).code).toBe(10_011)
  })

  it.each(['member', 'role'])(
    'GET %s returns 404 (10003) for a channel without a guild',
    async (kind) => {
      db.prepare('UPDATE channels SET guild_id = NULL WHERE id = ?').run(
        channelId
      )
      const res = await get(
        `/channels/${channelId}/permissions/${kind}/${memberId}`
      )
      expect(res.status).toBe(404)
      expect(((await res.json()) as { code: number }).code).toBe(10_003)
    }
  )

  it('returns 401 without authentication on the full app', async () => {
    const { app: fullApp } = createFullTestApp()
    const res = await fullApp.request(
      `/api/v10/channels/${channelId}/permissions/member/${memberId}`
    )
    expect(res.status).toBe(401)
  })
})
