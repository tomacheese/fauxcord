import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createInviteRoutes } from './invites'
import { initializeDatabase, closeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel, seedInvite } from '../test-helpers'
import type { Database } from '../db'

describe('Invites API', () => {
  let db: Database
  let app: Hono
  let code: string
  let token: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    app = new Hono()
    app.route('/', createInviteRoutes(db))

    token = seedBot(db)
    const guildId = seedGuild(db, token)
    const channelId = seedChannel(db, guildId)
    code = seedInvite(db, channelId, guildId, '111111111111111111')
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('GET /invites/:code', () => {
    it('retrieves an invite by code', async () => {
      const res = await app.request(`/invites/${code}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { code: string; type: number }
      expect(body.code).toBe(code)
      expect(body.type).toBe(0)
    })

    it('returns 404 for an unknown code', async () => {
      const res = await app.request('/invites/nonexistent', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_006)
    })
  })

  describe('DELETE /invites/:code', () => {
    it('deletes an invite', async () => {
      const del = await app.request(`/invites/${code}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(del.status).toBe(200)
      const body = (await del.json()) as { code: string }
      expect(body.code).toBe(code)

      const res = await app.request(`/invites/${code}`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
    })

    it('returns 404 when deleting an unknown code', async () => {
      const res = await app.request('/invites/nonexistent', {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_006)
    })
  })

  describe('GET /invites/:code/target-users', () => {
    it('returns a header-only CSV when no target users have been set', async () => {
      const res = await app.request(`/invites/${code}/target-users`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/csv')
      expect(await res.text()).toBe('user_id\n')
    })

    it('returns the stored CSV after PUT', async () => {
      const formData = new FormData()
      formData.set(
        'target_users_file',
        new File(['user_id\n111111111111111111\n'], 'target_users.csv', {
          type: 'text/csv',
        })
      )
      await app.request(`/invites/${code}/target-users`, {
        method: 'PUT',
        headers: { Authorization: token },
        body: formData,
      })

      const res = await app.request(`/invites/${code}/target-users`, {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('user_id\n111111111111111111\n')
    })

    it('returns 404 for an unknown code', async () => {
      const res = await app.request('/invites/nonexistent/target-users', {
        headers: { Authorization: token },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_006)
    })
  })

  describe('PUT /invites/:code/target-users', () => {
    it('accepts a valid CSV and returns 204', async () => {
      const formData = new FormData()
      formData.set(
        'target_users_file',
        new File(
          ['user_id\n111111111111111111\n222222222222222222\n'],
          'target_users.csv',
          { type: 'text/csv' }
        )
      )
      const res = await app.request(`/invites/${code}/target-users`, {
        method: 'PUT',
        headers: { Authorization: token },
        body: formData,
      })
      expect(res.status).toBe(204)
    })

    it('rejects a malformed CSV with 400', async () => {
      const formData = new FormData()
      formData.set(
        'target_users_file',
        new File(['not-the-right-header\n'], 'target_users.csv', {
          type: 'text/csv',
        })
      )
      const res = await app.request(`/invites/${code}/target-users`, {
        method: 'PUT',
        headers: { Authorization: token },
        body: formData,
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_035)
    })

    it('rejects a request with no file attached', async () => {
      const formData = new FormData()
      const res = await app.request(`/invites/${code}/target-users`, {
        method: 'PUT',
        headers: { Authorization: token },
        body: formData,
      })
      expect(res.status).toBe(400)
    })

    it('rejects a file exceeding the 25 MB size limit', async () => {
      const oversized = new Uint8Array(25 * 1024 * 1024 + 1)
      const formData = new FormData()
      formData.set(
        'target_users_file',
        new File([oversized], 'target_users.csv', { type: 'text/csv' })
      )
      const res = await app.request(`/invites/${code}/target-users`, {
        method: 'PUT',
        headers: { Authorization: token },
        body: formData,
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(50_045)
    })

    it('rejects a non-multipart request', async () => {
      const res = await app.request(`/invites/${code}/target-users`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 for an unknown code', async () => {
      const formData = new FormData()
      formData.set(
        'target_users_file',
        new File(['user_id\n111111111111111111\n'], 'target_users.csv', {
          type: 'text/csv',
        })
      )
      const res = await app.request('/invites/nonexistent/target-users', {
        method: 'PUT',
        headers: { Authorization: token },
        body: formData,
      })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /invites/:code/target-users/job-status', () => {
    it('returns an UNSPECIFIED default status when never set', async () => {
      const res = await app.request(
        `/invites/${code}/target-users/job-status`,
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        status: number
        total_users: number
        processed_users: number
        created_at: string | null
      }
      expect(body.status).toBe(0)
      expect(body.total_users).toBe(0)
      expect(body.processed_users).toBe(0)
      expect(body.created_at).toBeNull()
    })

    it('returns COMPLETED after PUT', async () => {
      const formData = new FormData()
      formData.set(
        'target_users_file',
        new File(
          ['user_id\n111111111111111111\n222222222222222222\n'],
          'target_users.csv',
          { type: 'text/csv' }
        )
      )
      await app.request(`/invites/${code}/target-users`, {
        method: 'PUT',
        headers: { Authorization: token },
        body: formData,
      })

      const res = await app.request(
        `/invites/${code}/target-users/job-status`,
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        status: number
        total_users: number
        processed_users: number
      }
      expect(body.status).toBe(2)
      expect(body.total_users).toBe(2)
      expect(body.processed_users).toBe(2)
    })

    it('returns 404 for an unknown code', async () => {
      const res = await app.request(
        '/invites/nonexistent/target-users/job-status',
        { headers: { Authorization: token } }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: number }
      expect(body.code).toBe(10_006)
    })
  })
})
