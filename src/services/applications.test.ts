import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import {
  seedApplicationOwner,
  seedGuild,
  seedSecondUser,
  seedBot,
} from '../test-helpers'
import {
  consumeEntitlement,
  createApplicationEmoji,
  createEntitlement,
  deleteApplicationEmoji,
  deleteEntitlement,
  getApplication,
  getApplicationEmoji,
  getActivityInstance,
  getEntitlement,
  getRoleConnectionMetadata,
  listApplicationEmojis,
  listEntitlements,
  replaceRoleConnectionMetadata,
  saveApplicationAttachment,
  updateApplication,
  updateApplicationEmoji,
} from './applications'

describe('applications service', () => {
  let db: Database
  let applicationId: string
  let ownerId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    ;({ applicationId, ownerId } = seedApplicationOwner(db))
  })

  it('updates and retrieves a private application profile', () => {
    const updated = updateApplication(db, applicationId, {
      description: { default: 'Updated application' },
      flags: 4,
      max_participants: 8,
      tags: ['games', 'social'],
    })

    expect(updated).toMatchObject({
      id: applicationId,
      description: 'Updated application',
      flags: 4,
      max_participants: 8,
      tags: ['games', 'social'],
    })
    expect(getApplication(db, applicationId)?.owner.id).toBe(ownerId)
  })

  it('returns null for an unknown application and activity instance', () => {
    expect(getApplication(db, '0')).toBeNull()
    expect(getActivityInstance(db, '0', 'instance')).toBeNull()
  })

  it('returns a deterministic activity instance for an existing application', () => {
    expect(getActivityInstance(db, applicationId, 'instance-1')).toEqual({
      application_id: applicationId,
      instance_id: 'instance-1',
      launch_id: `launch-instance-1`,
      location: {
        id: `location-instance-1`,
        kind: 'pc',
        channel_id: applicationId,
      },
      users: [ownerId],
    })
  })
})

describe('application emoji service', () => {
  let db: Database
  let applicationId: string
  let ownerId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    ;({ applicationId, ownerId } = seedApplicationOwner(db))
  })

  it('creates, lists, gets, and updates an emoji in its application scope', () => {
    const created = createApplicationEmoji(db, applicationId, ownerId, 'wave')
    expect(created).toMatchObject({ name: 'wave', roles: [], managed: false })
    expect(listApplicationEmojis(db, applicationId)).toEqual([created])
    expect(getApplicationEmoji(db, applicationId, created.id)).toEqual(created)

    const updated = updateApplicationEmoji(
      db,
      applicationId,
      created.id,
      'hello'
    )
    expect(updated?.name).toBe('hello')
  })

  it('does not expose or delete an emoji through another application scope', () => {
    const other = seedApplicationOwner(db)
    const created = createApplicationEmoji(db, applicationId, ownerId, 'wave')

    expect(getApplicationEmoji(db, other.applicationId, created.id)).toBeNull()
    expect(deleteApplicationEmoji(db, other.applicationId, created.id)).toBe(
      false
    )
    expect(deleteApplicationEmoji(db, applicationId, created.id)).toBe(true)
    expect(listApplicationEmojis(db, applicationId)).toEqual([])
  })
})

describe('application entitlement service', () => {
  let db: Database
  let applicationId: string
  let userId: string
  let skuId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    ;({ applicationId } = seedApplicationOwner(db))
    ;({ userId } = seedSecondUser(db))
    skuId = '900000000000000001'
    db.prepare(
      `INSERT INTO skus (id, application_id, name, slug)
       VALUES (?, ?, 'Test SKU', 'test-sku')`
    ).run(skuId, applicationId)
  })

  it('creates and filters a user entitlement', () => {
    const created = createEntitlement(db, applicationId, {
      sku_id: skuId,
      owner_id: userId,
      owner_type: 2,
    })
    if (!created) throw new Error('setup failed')
    expect(created).toMatchObject({
      sku_id: skuId,
      application_id: applicationId,
      user_id: userId,
      guild_id: null,
      deleted: false,
      consumed: false,
      type: 8,
    })
    expect(
      listEntitlements(db, applicationId, { userId, skuIds: [skuId] })
    ).toEqual([created])
    expect(getEntitlement(db, applicationId, created.id)).toEqual(created)
  })

  it('creates a guild entitlement and validates the referenced owner and SKU', () => {
    const token = 'Bot entitlement-owner'
    seedBot(db, token)
    const guildId = seedGuild(db, token)
    expect(
      createEntitlement(db, applicationId, {
        sku_id: skuId,
        owner_id: guildId,
        owner_type: 1,
      })
    ).toMatchObject({ guild_id: guildId, user_id: null })
    expect(
      createEntitlement(db, applicationId, {
        sku_id: '0',
        owner_id: userId,
        owner_type: 2,
      })
    ).toBeNull()
  })

  it('consumes and deletes an entitlement transactionally', () => {
    const consumed = createEntitlement(db, applicationId, {
      sku_id: skuId,
      owner_id: userId,
      owner_type: 2,
    })
    const deleted = createEntitlement(db, applicationId, {
      sku_id: skuId,
      owner_id: userId,
      owner_type: 2,
    })
    if (!consumed || !deleted) throw new Error('setup failed')
    expect(consumeEntitlement(db, applicationId, consumed.id)).toBe(true)
    expect(getEntitlement(db, applicationId, consumed.id)?.consumed).toBe(true)
    expect(deleteEntitlement(db, applicationId, deleted.id)).toBe(true)
    expect(getEntitlement(db, applicationId, deleted.id)).toBeNull()
  })
})

describe('application role connection metadata service', () => {
  let db: Database
  let applicationId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    ;({ applicationId } = seedApplicationOwner(db))
  })

  it('atomically replaces metadata and preserves localization fields', () => {
    const metadata = [
      {
        type: 2,
        key: 'score',
        name: 'Score',
        name_localizations: { ja: 'スコア' },
        description: 'Player score',
        description_localizations: { ja: 'プレイヤースコア' },
      },
    ]
    expect(replaceRoleConnectionMetadata(db, applicationId, metadata)).toEqual(
      metadata
    )
    expect(getRoleConnectionMetadata(db, applicationId)).toEqual(metadata)
    expect(replaceRoleConnectionMetadata(db, applicationId, [])).toEqual([])
    expect(getRoleConnectionMetadata(db, applicationId)).toEqual([])
  })
})

describe('application attachment service', () => {
  let uploadPath: string | undefined

  afterEach(async () => {
    if (uploadPath) await rm(uploadPath, { recursive: true, force: true })
  })

  it('stores an uploaded attachment at the URL-backed path', async () => {
    uploadPath = await mkdtemp(path.join(tmpdir(), 'fauxcord-app-test-'))
    const attachment = await saveApplicationAttachment(
      uploadPath,
      'http://localhost:3000',
      '100000000000000001',
      'notes.txt',
      'text/plain',
      new TextEncoder().encode('stored attachment')
    )

    expect(attachment).toMatchObject({
      filename: 'notes.txt',
      size: 17,
      content_type: 'text/plain',
    })
    const url = new URL(attachment.url)
    const segments = url.pathname.split('/', 6)
    const applicationId = segments[3]
    const attachmentId = segments[4]
    const filename = segments[5]
    expect(
      await readFile(
        path.join(uploadPath, applicationId, attachmentId, filename),
        'utf8'
      )
    ).toBe('stored attachment')
  })
})
