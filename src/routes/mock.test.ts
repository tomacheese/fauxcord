import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMockRoutes } from './mock'
import { saveAttachment } from '../services/attachments'
import { initializeDatabase, closeDatabase } from '../database'
import type { Database } from '../database'

const BASE_URL = 'http://localhost:3000'

describe('Mock infrastructure API', () => {
  let database: Database
  let app: Hono
  let uploadPath: string

  beforeEach(async () => {
    database = initializeDatabase(':memory:')
    uploadPath = await mkdtemp(path.join(tmpdir(), 'fauxcord-mock-'))
    app = new Hono()
    app.route('/', createMockRoutes(database, uploadPath))
  })

  afterEach(async () => {
    closeDatabase(database)
    await rm(uploadPath, { recursive: true, force: true })
  })

  describe('GET /_mock/health', () => {
    it('returns ok status', async () => {
      const resource = await app.request('/_mock/health')
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.status).toBe('ok')
      expect(body.db).toBe('ok')
      expect(typeof body.uptime).toBe('number')
    })
  })

  describe('GET /_mock/attachments/:channelId/:messageId/:filename', () => {
    it('serves a saved attachment with the right content type', async () => {
      database
        .prepare(
          "INSERT INTO channels (id, name, type) VALUES ('c1', 'general', 0)"
        )
        .run()
      database
        .prepare(
          "INSERT INTO messages (id, channel_id, author_id, author_token, content) VALUES ('m1', 'c1', 'u1', 'Bot t', 'hi')"
        )
        .run()
      await saveAttachment(
        database,
        uploadPath,
        BASE_URL,
        'c1',
        'm1',
        'a1',
        'hello.txt',
        'text/plain',
        new TextEncoder().encode('served')
      )

      const resource = await app.request('/_mock/attachments/c1/m1/hello.txt')
      expect(resource.status).toBe(200)
      expect(resource.headers.get('content-type')).toBe('text/plain')
      expect(await resource.text()).toBe('served')
    })

    it('returns 404 for a missing attachment', async () => {
      const resource = await app.request('/_mock/attachments/c1/m1/missing.txt')
      expect(resource.status).toBe(404)
    })
  })
})
