import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelPermissionRoutes } from './channel-permissions.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild, seedChannel } from '../test-helpers.js'
import { getChannel } from '../services/channels.js'
import type { Database } from '../db.js'

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
