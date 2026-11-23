import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, readFile, symlink, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gatewayBus } from '../gateway/bus'
import { createChannelMessageRoutes } from './channel-messages'
import { initializeDatabase, closeDatabase } from '../db'
import {
  seedBot,
  seedGuild,
  seedChannel,
  seedMessage,
  seedAnnouncementChannel,
} from '../test-helpers'
import type { Database } from '../db'
import type { AppEnv } from '../middleware/auth'

const BASE_URL = 'http://localhost:3000'

describe('Channel Messages API', () => {
  let db: Database
  let app: Hono<AppEnv>
  let channelId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono<AppEnv>()
    app.route('/', createChannelMessageRoutes(db, BASE_URL))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('POST /channels/:channelId/messages', () => {
    it('sends a message', async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Hello, World!' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.content).toBe('Hello, World!')
      expect(body.channel_id).toBe(channelId)
    })

    it('returns and dispatches the persisted multipart attachments', async () => {
      const uploadPath = await mkdtemp(
        path.join(os.tmpdir(), 'fauxcord-upload-')
      )
      const events: Record<string, unknown>[] = []
      const onCreate = (event: { message: Record<string, unknown> }) => {
        events.push(event.message)
      }
      gatewayBus.on('message.create', onCreate)
      try {
        const uploadApp = new Hono<AppEnv>()
        uploadApp.route(
          '/',
          createChannelMessageRoutes(db, BASE_URL, uploadPath)
        )
        const form = new FormData()
        form.set('payload_json', JSON.stringify({ content: 'files' }))
        form.set(
          'files[0]',
          new File(['first'], 'first.txt', { type: 'text/plain' })
        )
        form.set(
          'files[1]',
          new File(['second'], 'second.txt', { type: 'text/plain' })
        )
        const response = await uploadApp.request(
          `/channels/${channelId}/messages`,
          {
            method: 'POST',
            headers: { Authorization: token },
            body: form,
          }
        )
        expect(response.status).toBe(200)
        const message = (await response.json()) as {
          id: string
          attachments: { id: string; filename: string }[]
        }
        expect(message.attachments).toHaveLength(2)
        expect(
          new Set(message.attachments.map((attachment) => attachment.id)).size
        ).toBe(2)
        const read = await uploadApp.request(
          `/channels/${channelId}/messages/${message.id}`
        )
        expect(read.status).toBe(200)
        expect(await read.json()).toEqual(message)
        expect(events).toEqual([message])
        expect(
          await readFile(
            path.join(uploadPath, channelId, message.id, 'first.txt'),
            'utf8'
          )
        ).toBe('first')
      } finally {
        gatewayBus.off('message.create', onCreate)
        await rm(uploadPath, { recursive: true, force: true })
      }
    })

    it('fails without creating or dispatching a message when upload storage is missing', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'fauxcord-upload-'))
      const events: unknown[] = []
      const onCreate = (event: unknown) => {
        events.push(event)
      }
      gatewayBus.on('message.create', onCreate)
      try {
        const uploadPath = path.join(root, 'missing-link')
        await symlink(path.join(root, 'missing', 'target'), uploadPath)
        const uploadApp = new Hono<AppEnv>()
        uploadApp.onError(() => new Response('Upload failed', { status: 500 }))
        uploadApp.route(
          '/',
          createChannelMessageRoutes(db, BASE_URL, uploadPath)
        )
        const form = new FormData()
        form.set('files[0]', new File(['test'], 'test.txt'))
        const response = await uploadApp.request(
          `/channels/${channelId}/messages`,
          {
            method: 'POST',
            headers: { Authorization: token },
            body: form,
          }
        )
        expect(response.status).toBe(500)
        expect(events).toEqual([])
        expect(db.prepare('SELECT * FROM messages').all()).toEqual([])
        expect(db.prepare('SELECT * FROM attachments').all()).toEqual([])
      } finally {
        gatewayBus.off('message.create', onCreate)
        await rm(root, { recursive: true, force: true })
      }
    })

    it('rolls back the message and removes files when attachment persistence fails', async () => {
      const uploadPath = await mkdtemp(
        path.join(os.tmpdir(), 'fauxcord-upload-')
      )
      const events: unknown[] = []
      const onCreate = (event: unknown) => {
        events.push(event)
      }
      gatewayBus.on('message.create', onCreate)
      try {
        db.exec(
          "CREATE TRIGGER reject_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'attachment failed'); END"
        )
        const uploadApp = new Hono<AppEnv>()
        uploadApp.onError(() => new Response('Upload failed', { status: 500 }))
        uploadApp.route(
          '/',
          createChannelMessageRoutes(db, BASE_URL, uploadPath)
        )
        const form = new FormData()
        form.set('files[0]', new File(['test'], 'test.txt'))
        const response = await uploadApp.request(
          `/channels/${channelId}/messages`,
          {
            method: 'POST',
            headers: { Authorization: token },
            body: form,
          }
        )
        expect(response.status).toBe(500)
        expect(events).toEqual([])
        expect(db.prepare('SELECT * FROM messages').all()).toEqual([])
        expect(db.prepare('SELECT * FROM attachments').all()).toEqual([])
        expect(await readdir(path.join(uploadPath, channelId))).toEqual([])
      } finally {
        gatewayBus.off('message.create', onCreate)
        await rm(uploadPath, { recursive: true, force: true })
      }
    })

    it('returns 400 for an empty message', async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_006)
    })

    it('returns 400 when content exceeds 2000 characters', async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'a'.repeat(2001) }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_035)
    })
  })

  describe('GET /channels/:channelId/messages', () => {
    it('retrieves a list of messages', async () => {
      // Post a message first
      await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Test message' }),
      })

      const res = await app.request(`/channels/${channelId}/messages`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThan(0)
    })

    it('limit parameter works correctly', async () => {
      // Post 5 messages
      for (let i = 0; i < 5; i++) {
        await app.request(`/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: `Message ${i}` }),
        })
      }

      const res = await app.request(`/channels/${channelId}/messages?limit=3`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(body.length).toBe(3)
    })
  })

  describe('DELETE /channels/:channelId/messages/:messageId', () => {
    it('deletes a message', async () => {
      // Post a message
      const postRes = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'To delete' }),
      })
      const { id: messageId } = await postRes.json()

      const deleteRes = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: token },
        }
      )
      expect(deleteRes.status).toBe(204)
    })
  })

  describe('GET /channels/:channelId/messages/:messageId', () => {
    it('retrieves a single message', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'single')

      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string; content: string }
      expect(body.id).toBe(messageId)
      expect(body.content).toBe('single')
    })

    it('returns 404 for a non-existent message', async () => {
      const res = await app.request(
        `/channels/${channelId}/messages/999999999999999999`,
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_008)
    })

    it('does not return a message through a different channel path', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'scoped')
      const otherChannelId = seedChannel(
        db,
        seedGuild(db, token),
        '888888888888888888'
      )

      const response = await app.request(
        `/channels/${otherChannelId}/messages/${messageId}`,
        { headers: { Authorization: token } }
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ code: 10_008 })
    })
  })

  describe('PATCH /channels/:channelId/messages/:messageId', () => {
    it('edits an existing message', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'before')

      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'after' }),
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { content: string }
      expect(body.content).toBe('after')
    })

    it('returns 404 when editing a non-existent message', async () => {
      const res = await app.request(
        `/channels/${channelId}/messages/999999999999999999`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'x' }),
        }
      )
      expect(res.status).toBe(404)
    })

    it('does not edit a message through a different channel path', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'before')
      const otherChannelId = seedChannel(
        db,
        seedGuild(db, token),
        '888888888888888888'
      )

      const response = await app.request(
        `/channels/${otherChannelId}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'wrong channel edit' }),
        }
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ code: 10_008 })
      const row = db
        .prepare('SELECT content FROM messages WHERE id = ?')
        .get(messageId) as { content: string }
      expect(row.content).toBe('before')
    })

    it('returns 400 when the edited content exceeds the limit', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const messageId = seedMessage(db, channelId, botUserId, token, 'before')

      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'a'.repeat(2001) }),
        }
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })
  })

  describe('POST /channels/:channelId/messages/bulk-delete', () => {
    it('bulk-deletes messages', async () => {
      const botUserId = (
        db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
          user_id: string
        }
      ).user_id
      const id1 = seedMessage(db, channelId, botUserId, token, 'a')
      const id2 = seedMessage(db, channelId, botUserId, token, 'b')

      const res = await app.request(
        `/channels/${channelId}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: [id1, id2] }),
        }
      )
      expect(res.status).toBe(204)
    })

    it('returns 400 when fewer than 2 messages are provided', async () => {
      const res = await app.request(
        `/channels/${channelId}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: ['123456789012345678'] }),
        }
      )
      expect(res.status).toBe(400)
    })

    it('does not delete messages that belong to a different channel', async () => {
      const otherChannelId = seedChannel(db, seedGuild(db, token), 'other')

      // Post one message in each channel.
      const postTo = async (cid: string, content: string): Promise<string> => {
        const res = await app.request(`/channels/${cid}/messages`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        const { id } = (await res.json()) as { id: string }
        return id
      }
      const msgA = await postTo(channelId, 'in target channel')
      const msgB = await postTo(otherChannelId, 'in other channel')

      // Bulk-delete both IDs via the target channel; msgB must survive.
      const res = await app.request(
        `/channels/${channelId}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [msgA, msgB] }),
        }
      )
      expect(res.status).toBe(204)

      const survivor = await app.request(
        `/channels/${otherChannelId}/messages/${msgB}`,
        { headers: { Authorization: token } }
      )
      expect(survivor.status).toBe(200)
    })
  })

  describe('POST /channels/:channelId/messages/:messageId/crosspost', () => {
    it('sets the CROSSPOSTED flag on an announcement channel message', async () => {
      const bot = seedBot(db, 'Bot testtoken')
      const guild = seedGuild(db, bot)
      const channel = seedAnnouncementChannel(db, guild)
      const message = seedMessage(db, channel, '111111111111111111', bot)

      const res = await app.request(
        `/channels/${channel}/messages/${message}/crosspost`,
        { method: 'POST', headers: { Authorization: 'Bot testtoken' } }
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, number>
      expect(body.flags & 2).toBe(2)
    })

    it('returns 400 CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE for a text channel', async () => {
      const bot = seedBot(db, 'Bot testtoken')
      const guild = seedGuild(db, bot)
      const channel = seedChannel(db, guild)
      const message = seedMessage(db, channel, '111111111111111111', bot)

      const res = await app.request(
        `/channels/${channel}/messages/${message}/crosspost`,
        { method: 'POST', headers: { Authorization: 'Bot testtoken' } }
      )

      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_024)
    })

    it('returns 404 for an unknown message', async () => {
      const bot = seedBot(db, 'Bot testtoken')
      const guild = seedGuild(db, bot)
      const channel = seedAnnouncementChannel(db, guild)

      const res = await app.request(
        `/channels/${channel}/messages/999999999999999999/crosspost`,
        { method: 'POST', headers: { Authorization: 'Bot testtoken' } }
      )

      expect(res.status).toBe(404)
    })
  })
})

describe('POST /channels/:channelId/messages with poll', () => {
  let db: Database
  let app: Hono<AppEnv>

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono<AppEnv>()
    app.route('/', createChannelMessageRoutes(db, BASE_URL))
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('creates a message with an attached poll', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)

    const res = await app.request(`/channels/${channel}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bot testtoken',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        poll: {
          question: { text: 'Best pizza?' },
          answers: [
            { poll_media: { text: 'Margherita' } },
            { poll_media: { text: 'Pepperoni' } },
          ],
        },
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      poll: { question: { text: string }; answers: unknown[] }
    }
    expect(body.poll.question.text).toBe('Best pizza?')
    expect(body.poll.answers).toHaveLength(2)
  })

  it('returns 400 for an invalid poll payload', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedChannel(db, guild)

    const res = await app.request(`/channels/${channel}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bot testtoken',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        poll: { question: { text: '' }, answers: [] },
      }),
    })

    expect(res.status).toBe(400)
  })

  it('returns the same poll on GET single and GET list after POST', async () => {
    const bot = seedBot(db, 'Bot testtoken')
    const channel = seedChannel(db, seedGuild(db, bot))
    const headers = {
      Authorization: 'Bot testtoken',
      'Content-Type': 'application/json',
    }
    const postRes = await app.request(`/channels/${channel}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        poll: {
          question: { text: 'Best pizza?' },
          answers: [
            { poll_media: { text: 'Margherita' } },
            { poll_media: { text: 'Pepperoni' } },
          ],
        },
      }),
    })
    const posted = (await postRes.json()) as { id: string; poll: unknown }
    const plainRes = await app.request(`/channels/${channel}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'plain' }),
    })
    const plain = (await plainRes.json()) as { id: string }

    const getRes = await app.request(
      `/channels/${channel}/messages/${posted.id}`,
      { headers }
    )
    const fetched = (await getRes.json()) as { poll: unknown }
    expect(fetched.poll).toEqual(posted.poll)

    const listRes = await app.request(`/channels/${channel}/messages`, {
      headers,
    })
    const list = (await listRes.json()) as { id: string; poll?: unknown }[]
    expect(list.find((m) => m.id === posted.id)?.poll).toEqual(posted.poll)
    expect('poll' in (list.find((m) => m.id === plain.id) ?? {})).toBe(false)
  })
})
