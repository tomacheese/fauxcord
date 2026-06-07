import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createWebhookRoutes } from './webhooks.js'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild, seedChannel } from '../test-helpers.js'
import type { Database } from '../db.js'

const BASE_URL = 'http://localhost:3000'
const WEBHOOK_ID = '666666666666666666'
const WEBHOOK_TOKEN = 'test-webhook-token'

describe('Webhooks API (トークン付き)', () => {
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
    it('Webhook名を更新できること（tokenは返さない）', async () => {
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

    it('avatarを更新できること', async () => {
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

    it('avatar: null でavatarをクリアできること', async () => {
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

    it('不正なtokenは404 (10015) を返すこと', async () => {
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
    it('Webhookを削除できること', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
        { method: 'DELETE' }
      )
      expect(res.status).toBe(204)

      // 削除後は取得できないこと
      const getRes = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`
      )
      expect(getRes.status).toBe(404)
    })

    it('不正なtokenは404 (10015) を返すこと', async () => {
      const res = await app.request(`/webhooks/${WEBHOOK_ID}/invalid-token`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(10_015)
    })
  })
})
