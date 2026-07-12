import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createWebhookRoutes } from './webhooks'
import { initializeDatabase, closeDatabase } from '../database'
import { createChannelWebhookRoutes } from './channel-webhooks'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'
import type { Database } from '../database'

const BASE_URL = 'http://localhost:3000'
const WEBHOOK_ID = '666666666666666666'
const WEBHOOK_TOKEN = 'test-webhook-token'

describe('Webhooks API (with token)', () => {
  let database: Database
  let app: Hono

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createWebhookRoutes(database, BASE_URL))

    const token = seedBot(database)
    const guildId = seedGuild(database, token)
    const channelId = seedChannel(database, guildId)

    database
      .prepare(
        'INSERT INTO webhooks (id, guild_id, channel_id, name, token) VALUES (?, ?, ?, ?, ?)'
      )
      .run(WEBHOOK_ID, guildId, channelId, 'Test Webhook', WEBHOOK_TOKEN)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('PATCH /webhooks/:webhookId/:token', () => {
    it('updates the Webhook name (token is not returned)', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Webhook' }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.id).toBe(WEBHOOK_ID)
      expect(body.name).toBe('Updated Webhook')
      expect(body.token).toBeUndefined()
    })

    it('updates the avatar', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: 'abc123' }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.avatar).toBe('abc123')
    })

    it('clears the avatar when avatar is set to null', async () => {
      database
        .prepare("UPDATE webhooks SET avatar = 'old' WHERE id = ?")
        .run(WEBHOOK_ID)
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: null }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.avatar).toBeNull()
    })

    it('returns 404 (10015) for an invalid token', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/invalid-token`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'X' }),
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_015)
    })
  })

  describe('DELETE /webhooks/:webhookId/:token', () => {
    it('deletes a Webhook', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        { method: 'DELETE' }
      )
      expect(resource.status).toBe(204)

      // The deleted Webhook should not be retrievable
      const fetchedResponse = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`
      )
      expect(fetchedResponse.status).toBe(404)
    })

    it('returns 404 (10015) for an invalid token', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/invalid-token`,
        {
          method: 'DELETE',
        }
      )
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_015)
    })
  })

  describe('GET /webhooks/:webhookId', () => {
    it('retrieves a webhook by id', async () => {
      const resource = await app.request(`/webhooks/${WEBHOOK_ID}`)
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { id: string }
      expect(body.id).toBe(WEBHOOK_ID)
    })

    it('returns 404 (10015) for an unknown webhook', async () => {
      const resource = await app.request('/webhooks/111111111111111111')
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as { code: number }
      expect(body.code).toBe(10_015)
    })
  })

  describe('GET /webhooks/:webhookId/:token', () => {
    it('retrieves a webhook by id and token', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { id: string }
      expect(body.id).toBe(WEBHOOK_ID)
    })
  })

  describe('POST /webhooks/:webhookId/:token (execute)', () => {
    it('executes with wait=true and returns the message', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'hi' }),
        }
      )
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { content: string }
      expect(body.content).toBe('hi')
    })

    it('executes with wait=1 (discord.py style)', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=1`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'py' }),
        }
      )
      expect(resource.status).toBe(200)
    })

    it('returns 204 when wait is not set', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'async' }),
        }
      )
      expect(resource.status).toBe(204)
    })

    it('returns 404 for an invalid token', async () => {
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/wrong-token?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        }
      )
      expect(resource.status).toBe(404)
    })
  })

  describe('webhook message GET/PATCH/DELETE', () => {
    it('gets, edits, and deletes a webhook message', async () => {
      // Execute with wait=true to create a message
      const execResource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'original' }),
        }
      )
      expect(execResource.status).toBe(200)
      const { id: messageId } = (await execResource.json()) as { id: string }

      const fetchedResponse = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/messages/${messageId}`
      )
      expect(fetchedResponse.status).toBe(200)

      const patchResource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'edited' }),
        }
      )
      expect(patchResource.status).toBe(200)
      const patchBody = (await patchResource.json()) as { content: string }
      expect(patchBody.content).toBe('edited')

      const delResource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/messages/${messageId}`,
        { method: 'DELETE' }
      )
      expect(delResource.status).toBe(204)
    })
  })

  describe('PATCH /webhooks/:webhookId (validation and channel checks)', () => {
    it('rejects an empty name with 400', async () => {
      const resource = await app.request(`/webhooks/${WEBHOOK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })

    it('returns 404 Unknown Channel when repointing to a nonexistent channel', async () => {
      const resource = await app.request(`/webhooks/${WEBHOOK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: '999999999999999999' }),
      })
      expect(resource.status).toBe(404)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(10_003)
    })
  })

  describe('POST /webhooks/:webhookId/:token (execute, file-only)', () => {
    it('accepts a file-only message (not treated as empty)', async () => {
      const form = new FormData()
      form.append(
        'files[0]',
        new File([new Uint8Array([1, 2, 3])], 'a.bin', {
          type: 'application/octet-stream',
        })
      )
      const resource = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=1`,
        { method: 'POST', body: form }
      )
      expect(resource.status).not.toBe(400)
    })
  })
})

describe('Channel Webhooks API', () => {
  let database: Database
  let app: Hono

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelWebhookRoutes(database))
  })

  afterEach(() => {
    closeDatabase(database)
  })

  it('returns 404 for GET webhooks of a nonexistent channel', async () => {
    const resource = await app.request('/channels/999999999999999999/webhooks')
    expect(resource.status).toBe(404)
    const body = (await resource.json()) as Record<string, unknown>
    expect(body.code).toBe(10_003)
  })

  it('generates an opaque (non-Snowflake) webhook token', async () => {
    const token = seedBot(database)
    const guildId = seedGuild(database, token)
    const channelId = seedChannel(database, guildId)
    const resource = await app.request(`/channels/${channelId}/webhooks`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Webhook' }),
    })
    expect(resource.status).toBe(200)
    const body = (await resource.json()) as { token: string }
    // A CSPRNG base64url token is not a pure digit string like a Snowflake.
    expect(/^\d+$/.test(body.token)).toBe(false)
    expect(body.token.length).toBeGreaterThan(40)
  })
})
