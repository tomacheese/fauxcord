import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createWebhookRoutes } from './webhooks'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'
import type { Database } from '../db'

const BASE_URL = 'http://localhost:3000'
const WEBHOOK_ID = '666666666666666666'
const WEBHOOK_TOKEN = 'test-webhook-token'

describe('Webhooks API (with token)', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createWebhookRoutes(db, BASE_URL))

    const token = seedBot(db)
    const guildId = seedGuild(db, token)
    const channelId = seedChannel(db, guildId)

    db.prepare(
      'INSERT INTO webhooks (id, guild_id, channel_id, name, token) VALUES (?, ?, ?, ?, ?)'
    ).run(WEBHOOK_ID, guildId, channelId, 'Test Webhook', WEBHOOK_TOKEN)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('PATCH /webhooks/:webhookId/:token', () => {
    it('updates the Webhook name (token is not returned)', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Webhook' }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(WEBHOOK_ID)
      expect(body.name).toBe('Updated Webhook')
      expect(body.token).toBeUndefined()
    })

    it('updates the avatar', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: 'abc123' }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.avatar).toBe('abc123')
    })

    it('clears the avatar when avatar is set to null', async () => {
      db.prepare("UPDATE webhooks SET avatar = 'old' WHERE id = ?").run(
        WEBHOOK_ID
      )
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: null }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.avatar).toBeNull()
    })

    it('returns 404 (10015) for an invalid token', async () => {
      const res = await app.request(`/webhooks/${WEBHOOK_ID}/invalid-token`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_015)
    })
  })

  describe('DELETE /webhooks/:webhookId/:token', () => {
    it('deletes a Webhook', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        { method: 'DELETE' }
      )
      expect(res.status).toBe(204)

      // The deleted Webhook should not be retrievable
      const getRes = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`
      )
      expect(getRes.status).toBe(404)
    })

    it('returns 404 (10015) for an invalid token', async () => {
      const res = await app.request(`/webhooks/${WEBHOOK_ID}/invalid-token`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_015)
    })
  })

  describe('GET /webhooks/:webhookId', () => {
    it('retrieves a webhook by id', async () => {
      const res = await app.request(`/webhooks/${WEBHOOK_ID}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string }
      expect(body.id).toBe(WEBHOOK_ID)
    })

    it('returns 404 (10015) for an unknown webhook', async () => {
      const res = await app.request('/webhooks/111111111111111111')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_015)
    })
  })

  describe('GET /webhooks/:webhookId/:token', () => {
    it('retrieves a webhook by id and token', async () => {
      const res = await app.request(`/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string }
      expect(body.id).toBe(WEBHOOK_ID)
    })
  })

  describe('POST /webhooks/:webhookId/:token (execute)', () => {
    it('executes with wait=true and returns the message', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'hi' }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { content: string }
      expect(body.content).toBe('hi')
    })

    it('executes with wait=1 (discord.py style)', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=1`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'py' }),
        }
      )
      expect(res.status).toBe(200)
    })

    it('returns 204 when wait is not set', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'async' }),
        }
      )
      expect(res.status).toBe(204)
    })

    it('returns 404 for an invalid token', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/wrong-token?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        }
      )
      expect(res.status).toBe(404)
    })
  })

  describe('webhook message GET/PATCH/DELETE', () => {
    it('gets, edits, and deletes a webhook message', async () => {
      // Execute with wait=true to create a message
      const execRes = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'original' }),
        }
      )
      expect(execRes.status).toBe(200)
      const { id: messageId } = (await execRes.json()) as { id: string }

      const getRes = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/messages/${messageId}`
      )
      expect(getRes.status).toBe(200)

      const patchRes = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'edited' }),
        }
      )
      expect(patchRes.status).toBe(200)
      const patchBody = (await patchRes.json()) as { content: string }
      expect(patchBody.content).toBe('edited')

      const delRes = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/messages/${messageId}`,
        { method: 'DELETE' }
      )
      expect(delRes.status).toBe(204)
    })
  })
})
