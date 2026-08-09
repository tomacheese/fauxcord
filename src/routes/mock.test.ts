import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMockRoutes } from './mock'
import { saveAttachment } from '../services/attachments'
import { initializeDatabase, closeDatabase } from '../db'
import type { Database } from '../db'

const BASE_URL = 'http://localhost:3000'

describe('Mock infrastructure API', () => {
  let db: Database
  let app: Hono
  let uploadPath: string

  beforeEach(async () => {
    db = initializeDatabase(':memory:')
    uploadPath = await mkdtemp(path.join(tmpdir(), 'fauxcord-mock-'))
    app = new Hono()
    app.route('/', createMockRoutes(db, uploadPath))
  })

  afterEach(async () => {
    closeDatabase(db)
    await rm(uploadPath, { recursive: true, force: true })
  })

  describe('GET /_mock/health', () => {
    it('returns ok status', async () => {
      const res = await app.request('/_mock/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe('ok')
      expect(body.db).toBe('ok')
      expect(typeof body.uptime).toBe('number')
    })
  })

  describe('GET /_mock/attachments/:channelId/:messageId/:filename', () => {
    it('serves a saved attachment with the right content type', async () => {
      db.prepare(
        "INSERT INTO channels (id, name, type) VALUES ('c1', 'general', 0)"
      ).run()
      db.prepare(
        "INSERT INTO messages (id, channel_id, author_id, author_token, content) VALUES ('m1', 'c1', 'u1', 'Bot t', 'hi')"
      ).run()
      await saveAttachment(
        db,
        uploadPath,
        BASE_URL,
        'c1',
        'm1',
        'a1',
        'hello.txt',
        'image/png',
        new TextEncoder().encode('served')
      )

      const res = await app.request('/_mock/attachments/c1/m1/hello.txt')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(await res.text()).toBe('served')
    })

    it('returns 404 for a missing attachment', async () => {
      const res = await app.request('/_mock/attachments/c1/m1/missing.txt')
      expect(res.status).toBe(404)
    })
  })
})
