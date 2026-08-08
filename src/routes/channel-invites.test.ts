import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createChannelRoutes } from './channels'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'
import type { Database } from '../db'

const BASE_URL = 'http://localhost:3000'

describe('Channel Invites API', () => {
  let db: Database
  let app: Hono
  let channelId: string
  let guildId: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createChannelRoutes(db, BASE_URL))

    token = seedBot(db)
    guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('POST /channels/:channelId/invites', () => {
    it('creates an invite', async () => {
      const res = await app.request(`/channels/${channelId}/invites`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_age: 3600 }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        code: string
        type: number
        channel: { id: string }
        guild: { id: string }
        inviter?: { id: string }
      }
      expect(typeof body.code).toBe('string')
      expect(body.type).toBe(0)
      expect(body.channel.id).toBe(channelId)
      expect(body.guild.id).toBe(guildId)
      expect(body.inviter?.id).toBeTruthy()
    })

    it('creates an invite with target users and returns 204', async () => {
      const form = new FormData()
      form.set('payload_json', JSON.stringify({ max_age: 3600 }))
      form.set(
        'target_users_file',
        new File(['user_id\n555555555555555555\n'], 'targets.csv', {
          type: 'text/csv',
        })
      )

      const res = await app.request(`/channels/${channelId}/invites`, {
        method: 'POST',
        headers: { Authorization: token },
        body: form,
      })

      expect(res.status).toBe(204)
      expect(db.prepare('SELECT COUNT(*) AS count FROM invites').get()).toEqual(
        { count: 1 }
      )
      expect(
        db
          .prepare(
            'SELECT total_users, processed_users FROM invite_target_users'
          )
          .get()
      ).toEqual({ total_users: 1, processed_users: 1 })
    })

    it('returns 404 for a non-existent channel', async () => {
      const res = await app.request('/channels/999999999999999999/invites', {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_003)
    })

    it('rejects an out-of-range max_age', async () => {
      const res = await app.request(`/channels/${channelId}/invites`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_age: 9_999_999 }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('rejects a non-numeric max_age', async () => {
      const res = await app.request(`/channels/${channelId}/invites`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_age: 'forever' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })
  })

  describe('GET /channels/:channelId/invites', () => {
    it('returns an empty array when there are no invites', async () => {
      const res = await app.request(`/channels/${channelId}/invites`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(body.length).toBe(0)
    })

    it('lists created invites', async () => {
      await app.request(`/channels/${channelId}/invites`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const res = await app.request(`/channels/${channelId}/invites`, {
        headers: { Authorization: token },
      })
      const body = (await res.json()) as unknown[]
      expect(body.length).toBe(1)
    })
  })
})
