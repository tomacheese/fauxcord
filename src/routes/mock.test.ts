import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

    describe('path traversal protection', () => {
      // The served root is nested inside the per-test temp directory, so files
      // an unchecked join could reach stay inside a directory removed in
      // afterEach.
      let root: string
      let traversalApp: Hono

      beforeEach(async () => {
        root = path.join(uploadPath, 'uploads')
        await mkdir(root)
        traversalApp = new Hono()
        traversalApp.route('/', createMockRoutes(db, root))
      })

      it('returns 404 for an encoded parent traversal to a file beside the upload directory', async () => {
        const marker = `marker-${randomUUID()}.txt`
        await writeFile(path.join(uploadPath, marker), 'secret')

        const res = await traversalApp.request(
          `/_mock/attachments/a/b/..%2F..%2F..%2F${marker}`
        )
        expect(res.status).toBe(404)
      })

      const cases: [string, string[], string[]][] = [
        [
          'channelId with encoded parent traversal',
          ['..%2Fx', 'm1', 'f.txt'],
          ['../x', 'm1', 'f.txt'],
        ],
        [
          'messageId with encoded parent traversal',
          ['c1', '..%2Fx', 'f.txt'],
          ['c1', '../x', 'f.txt'],
        ],
        [
          'filename with encoded parent traversal',
          ['c1', 'm1', '..%2Fx'],
          ['c1', 'm1', '../x'],
        ],
        [
          'channelId with encoded backslash',
          ['a%5Cb', 'm1', 'f.txt'],
          ['a\\b', 'm1', 'f.txt'],
        ],
        [
          'messageId with encoded backslash',
          ['c1', 'a%5Cb', 'f.txt'],
          ['c1', 'a\\b', 'f.txt'],
        ],
        [
          'filename with encoded backslash',
          ['c1', 'm1', 'a%5Cb'],
          ['c1', 'm1', 'a\\b'],
        ],
      ]

      for (const [label, encoded, decoded] of cases) {
        it(`returns 404 for ${label}`, async () => {
          const target = path.join(root, ...decoded)
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, 'reachable')

          const res = await traversalApp.request(
            `/_mock/attachments/${encoded.join('/')}`
          )
          expect(res.status).toBe(404)
        })
      }
    })
  })
})
