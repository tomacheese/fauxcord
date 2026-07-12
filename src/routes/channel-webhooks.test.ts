import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelWebhookRoutes } from './channel-webhooks'
import { initializeDatabase, closeDatabase } from '../database'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'
import { generateSnowflake } from '../snowflake'
import { WEBHOOK_LIMITS } from '../validators/webhook'
import type { Database } from '../database'

describe('Channel Webhooks API', () => {
  let database: Database
  let app: Hono
  let channelId: string
  let guildId: string
  let token: string

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelWebhookRoutes(database))

    token = seedBot(database)
    guildId = seedGuild(database, token)
    channelId = seedChannel(database, guildId)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  it('lists channel webhooks', async () => {
    const resource = await app.request(`/channels/${channelId}/webhooks`, {
      headers: { Authorization: token },
    })
    expect(resource.status).toBe(200)
    expect(Array.isArray(await resource.json())).toBe(true)
  })

  it('creates a webhook', async () => {
    const resource = await app.request(`/channels/${channelId}/webhooks`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Webhook' }),
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.name).toBe('My Webhook')
    expect(body.channel_id).toBe(channelId)
  })

  it('returns 404 for an unknown channel', async () => {
    const resource = await app.request(
      '/channels/999999999999999999/webhooks',
      {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }
    )
    expect(resource.status).toBe(404)
    const body = (await resource.json()) as { code: number }
    expect(body.code).toBe(10_003)
  })

  it('returns 400 for an empty name', async () => {
    const resource = await app.request(`/channels/${channelId}/webhooks`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(resource.status).toBe(400)
    const body = (await resource.json()) as { code: number }
    expect(body.code).toBe(50_035)
  })

  it('returns 400 (30007) when the channel webhook limit is reached', async () => {
    // Fill the channel up to its webhook limit directly so the next create is
    // rejected.
    for (let index = 0; index < WEBHOOK_LIMITS.CHANNEL_WEBHOOKS_MAX; index++) {
      database
        .prepare(
          'INSERT INTO webhooks (id, guild_id, channel_id, name, token) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          generateSnowflake(),
          guildId,
          channelId,
          `wh${index}`,
          `tok${index}`
        )
    }
    const resource = await app.request(`/channels/${channelId}/webhooks`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Overflow' }),
    })
    expect(resource.status).toBe(400)
    const body = (await resource.json()) as { code: number }
    expect(body.code).toBe(30_007)
  })
})
