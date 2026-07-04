import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { saveAttachment, getAttachment, guessContentType } from './attachments'
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
