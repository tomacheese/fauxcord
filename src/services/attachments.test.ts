import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  saveAttachment,
  getAttachment,
  guessContentType,
  resolveAttachmentPath,
} from './attachments'
import { initializeDatabase, closeDatabase } from '../db'
import type { Database } from '../db'

const BASE_URL = 'http://localhost:3000'

describe('attachments service', () => {
  let db: Database
  let uploadPath: string

  beforeEach(async () => {
    db = initializeDatabase(':memory:')
    uploadPath = await mkdtemp(path.join(tmpdir(), 'fauxcord-att-'))
    // saveAttachment inserts into attachments(message_id); satisfy the schema
    // by inserting a channel + message row first.
    db.prepare(
      "INSERT INTO channels (id, name, type) VALUES ('c1', 'general', 0)"
    ).run()
    db.prepare(
      "INSERT INTO messages (id, channel_id, author_id, author_token, content) VALUES ('m1', 'c1', 'u1', 'Bot t', 'hi')"
    ).run()
  })

  afterEach(async () => {
    closeDatabase(db)
    await rm(uploadPath, { recursive: true, force: true })
  })

  it('saves a Uint8Array and records it in the DB', async () => {
    const data = new TextEncoder().encode('hello world')
    const info = await saveAttachment(
      db,
      uploadPath,
      BASE_URL,
      'c1',
      'm1',
      'a1',
      'note.txt',
      'text/plain',
      data
    )
    expect(info.id).toBe('a1')
    expect(info.filename).toBe('note.txt')
    expect(info.size).toBe(data.byteLength)
    expect(info.url).toBe(`${BASE_URL}/_mock/attachments/c1/m1/note.txt`)

    const row = db
      .prepare('SELECT filename, size FROM attachments WHERE id = ?')
      .get('a1') as { filename: string; size: number }
    expect(row.filename).toBe('note.txt')
    expect(row.size).toBe(data.byteLength)
  })

  it('saves an ArrayBuffer', async () => {
    const buf = new TextEncoder().encode('abc').buffer
    const info = await saveAttachment(
      db,
      uploadPath,
      BASE_URL,
      'c1',
      'm1',
      'a2',
      'x.bin',
      'application/octet-stream',
      buf
    )
    expect(info.size).toBe(3)
  })

  it('URL-encodes attachment filenames', async () => {
    const info = await saveAttachment(
      db,
      uploadPath,
      BASE_URL,
      'c1',
      'm1',
      'a-special',
      'proof#?.txt',
      'text/plain',
      new TextEncoder().encode('encoded')
    )

    expect(info.url).toBe(`${BASE_URL}/_mock/attachments/c1/m1/proof%23%3F.txt`)
  })

  it('reads back a saved attachment', async () => {
    const data = new TextEncoder().encode('roundtrip')
    await saveAttachment(
      db,
      uploadPath,
      BASE_URL,
      'c1',
      'm1',
      'a3',
      'r.txt',
      'text/plain',
      data
    )
    const read = await getAttachment(uploadPath, 'c1', 'm1', 'r.txt')
    expect(read).not.toBeNull()
    expect(read?.toString('utf8')).toBe('roundtrip')
  })

  it('returns null for a missing attachment', async () => {
    const read = await getAttachment(uploadPath, 'c1', 'm1', 'missing.txt')
    expect(read).toBeNull()
  })

  describe('path traversal protection', () => {
    const invalidValues: [string, string][] = [
      ['parent directory', '..'],
      ['current directory', '.'],
      ['empty string', ''],
      ['forward slash', 'a/b'],
      ['backslash', 'a\\b'],
      ['NUL character', 'a\0b'],
    ]
    const positions = ['channelId', 'messageId', 'filename'] as const

    // The upload root is nested inside the per-test temp directory, so any
    // file an unchecked join could reach stays inside a directory that is
    // removed in afterEach.
    let root: string

    beforeEach(async () => {
      root = path.join(uploadPath, 'uploads')
      await mkdir(root)
    })

    for (const position of positions) {
      for (const [label, value] of invalidValues) {
        it(`returns null for ${label} in ${position}`, async () => {
          const parts = {
            channelId: 'c1',
            messageId: 'm1',
            filename: 'f.txt',
            [position]: value,
          }
          const joined = path.join(
            root,
            parts.channelId,
            parts.messageId,
            parts.filename
          )
          // NUL and empty values cannot name a writable file.
          if (value !== '' && !value.includes('\0')) {
            await mkdir(path.dirname(joined), { recursive: true })
            await writeFile(joined, 'reachable')
          }

          const read = await getAttachment(
            root,
            parts.channelId,
            parts.messageId,
            parts.filename
          )
          expect(read).toBeNull()
        })
      }
    }

    it('returns null when the target exists outside the upload directory', async () => {
      const name = `outside-${randomUUID()}.txt`
      await writeFile(path.join(uploadPath, name), 'secret')

      const read = await getAttachment(root, 'c1', 'm1', `../../../${name}`)
      expect(read).toBeNull()
    })

    it('resolves normal IDs and file names inside the upload directory', () => {
      const resolved = resolveAttachmentPath(root, 'c1', 'm1', 'a b.tar.gz')
      expect(resolved).toBe(path.join(root, 'c1', 'm1', 'a b.tar.gz'))
    })

    it('still serves an application attachment that has no DB row', async () => {
      const dir = path.join(root, 'app1', 'att1')
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, 'name.txt'), 'app-file')

      const read = await getAttachment(root, 'app1', 'att1', 'name.txt')
      expect(read?.toString('utf8')).toBe('app-file')
    })
  })

  it('guesses content types by extension', () => {
    expect(guessContentType('a.png')).toBe('image/png')
    expect(guessContentType('a.JPG')).toBe('image/jpeg')
    expect(guessContentType('a.gif')).toBe('image/gif')
    expect(guessContentType('a.mp4')).toBe('video/mp4')
    expect(guessContentType('a.pdf')).toBe('application/pdf')
    expect(guessContentType('a.json')).toBe('application/json')
    expect(guessContentType('a.zip')).toBe('application/zip')
  })

  it('falls back to octet-stream for unknown or missing extensions', () => {
    expect(guessContentType('a.unknownext')).toBe('application/octet-stream')
    expect(guessContentType('noext')).toBe('application/octet-stream')
  })
})
