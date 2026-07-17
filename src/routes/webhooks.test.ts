import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createWebhookRoutes } from './webhooks'
import { initializeDatabase, closeDatabase } from '../db'
import { createChannelWebhookRoutes } from './channel-webhooks'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'
import {
  createInteraction,
  handleInteractionCallback,
} from '../services/interactions'
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

  describe('PATCH /webhooks/:webhookId (validation and channel checks)', () => {
    it('rejects an empty name with 400', async () => {
      const res = await app.request(`/webhooks/${WEBHOOK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })

    it('returns 404 Unknown Channel when repointing to a nonexistent channel', async () => {
      const res = await app.request(`/webhooks/${WEBHOOK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: '999999999999999999' }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
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
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=1`,
        { method: 'POST', body: form }
      )
      expect(res.status).not.toBe(400)
    })
  })

  describe('POST /webhooks/:webhookId/:token/github', () => {
    it('creates a message from a GitHub push payload', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/github`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            head_commit: { message: 'fix: bug', id: 'abc' },
            repository: { full_name: 'owner/repo' },
            sender: { login: 'octocat' },
          }),
        }
      )

      expect(res.status).toBe(204)
    })

    it('returns 404 for an unknown webhook token', async () => {
      const res = await app.request(
        '/webhooks/999999999999999999/badtoken/github',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )

      expect(res.status).toBe(404)
    })

    it('creates a message from a form-urlencoded payload field', async () => {
      const form = new URLSearchParams()
      form.set(
        'payload',
        JSON.stringify({
          head_commit: { message: 'fix: bug', id: 'abc' },
          repository: { full_name: 'owner/repo' },
          sender: { login: 'octocat' },
        })
      )

      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/github`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        }
      )

      expect(res.status).toBe(204)
    })
  })

  describe('POST /webhooks/:webhookId/:token/slack', () => {
    it('creates a message from a Slack-compatible JSON payload', async () => {
      const res = await app.request(
        `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/slack`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'hello from slack' }),
        }
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toBeNull()
    })

    it('returns 404 for an unknown webhook token', async () => {
      const res = await app.request(
        '/webhooks/999999999999999999/badtoken/slack',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'x' }),
        }
      )

      expect(res.status).toBe(404)
    })
  })
})

describe('Channel Webhooks API', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelWebhookRoutes(db))
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('returns 404 for GET webhooks of a nonexistent channel', async () => {
    const res = await app.request('/channels/999999999999999999/webhooks')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe(10_003)
  })

  it('generates an opaque (non-Snowflake) webhook token', async () => {
    const token = seedBot(db)
    const guildId = seedGuild(db, token)
    const channelId = seedChannel(db, guildId)
    const res = await app.request(`/channels/${channelId}/webhooks`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Webhook' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string }
    // A CSPRNG base64url token is not a pure digit string like a Snowflake.
    expect(/^\d+$/.test(body.token)).toBe(false)
    expect(body.token.length).toBeGreaterThan(40)
  })
})

describe('Webhook routes — interaction followup fallback', () => {
  let db: Database
  let app: Hono
  const applicationId = '999999999999999999'
  const channelId = '888888888888888888'
  const userId = '777777777777777777'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createWebhookRoutes(db, BASE_URL))

    db.prepare(
      "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'App', '0', 1)"
    ).run(applicationId)
    db.prepare(
      "INSERT INTO channels (id, guild_id, type, name) VALUES (?, NULL, 0, 'general')"
    ).run(channelId)
    db.prepare(
      "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'Caller', '0', 0)"
    ).run(userId)

    createInteraction(db, {
      interactionId: 'int1',
      applicationId,
      token: 'itoken1',
      type: 2,
      channelId,
      userId,
    })
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('sends a followup message via POST /webhooks/:applicationId/:interactionToken', async () => {
    const res = await app.request(
      `/webhooks/${applicationId}/itoken1?wait=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'followup!' }),
      }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { content: string }
    expect(body.content).toBe('followup!')
  })

  it('GET/PATCH/DELETE .../messages/:messageId work against a followup message', async () => {
    const create = await app.request(
      `/webhooks/${applicationId}/itoken1?wait=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'followup!' }),
      }
    )
    const message = (await create.json()) as { id: string }

    const get = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/${message.id}`
    )
    expect(get.status).toBe(200)

    const patch = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/${message.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'edited' }),
      }
    )
    expect(patch.status).toBe(200)

    const del = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/${message.id}`,
      { method: 'DELETE' }
    )
    expect(del.status).toBe(204)
  })

  it('404s .../messages/@original before any type-4 callback has run', async () => {
    const res = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/@original`
    )
    expect(res.status).toBe(404)
  })

  it('resolves .../messages/@original after a type-4 callback', async () => {
    handleInteractionCallback(
      db,
      'int1',
      'itoken1',
      { type: 4, data: { content: 'initial response' } },
      BASE_URL
    )

    const res = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/@original`
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { content: string }
    expect(body.content).toBe('initial response')
  })

  it('404s PATCH .../messages/@original before any type-4 callback has run', async () => {
    const res = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/@original`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'edited' }),
      }
    )
    expect(res.status).toBe(404)
  })

  it('edits the initial response via PATCH .../messages/@original', async () => {
    handleInteractionCallback(
      db,
      'int1',
      'itoken1',
      { type: 4, data: { content: 'initial response' } },
      BASE_URL
    )

    const res = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/@original`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'edited' }),
      }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { content: string }
    expect(body.content).toBe('edited')
  })

  it('404s DELETE .../messages/@original before any type-4 callback has run', async () => {
    const res = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/@original`,
      { method: 'DELETE' }
    )
    expect(res.status).toBe(404)
  })

  it('deletes the initial response via DELETE .../messages/@original', async () => {
    handleInteractionCallback(
      db,
      'int1',
      'itoken1',
      { type: 4, data: { content: 'initial response' } },
      BASE_URL
    )

    const del = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/@original`,
      { method: 'DELETE' }
    )
    expect(del.status).toBe(204)

    const get = await app.request(
      `/webhooks/${applicationId}/itoken1/messages/@original`
    )
    expect(get.status).toBe(404)
  })
})
