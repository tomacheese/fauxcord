import { describe, expect, it } from 'vitest'
import { initializeDatabase } from '../db'
import { seedApplicationOwner, seedSkuSubscription } from '../test-helpers'
import {
  getCatalogSticker,
  listStickerPacks,
  listVoiceRegions,
} from './catalog'

describe('voice region catalog', () => {
  it('returns stable Discord response objects without sharing mutable instances', () => {
    const first = listVoiceRegions()
    const second = listVoiceRegions()

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.length).toBeGreaterThan(0)
    expect(new Set(first.map(({ id }) => id)).size).toBe(first.length)
    for (const region of first) {
      expect(region).toEqual({
        id: expect.any(String),
        name: expect.any(String),
        custom: expect.any(Boolean),
        deprecated: expect.any(Boolean),
        optimal: expect.any(Boolean),
      })
    }

    const mutableRegion = first.at(0)
    if (!mutableRegion) throw new Error('Voice region catalog is empty')
    mutableRegion.name = 'mutated by caller'
    expect(listVoiceRegions()).toEqual(second)
  })
})

describe('sticker pack catalog', () => {
  it('maps pack, SKU, and sticker identities from persistent seeded resources', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, ownerId } = seedApplicationOwner(db)
    const { skuId } = seedSkuSubscription(db, applicationId, ownerId)
    const packId = 'catalog-pack'
    const stickerId = 'catalog-sticker'
    db.prepare(
      `INSERT INTO sticker_packs
         (id, sku_id, name, description, banner_asset_id)
       VALUES (?, ?, 'Fixture Pack', 'Fixture description', 'banner-asset')`
    ).run(packId, skuId)
    db.prepare(
      `INSERT INTO stickers
         (id, application_id, name, description, tags, type, format_type,
          pack_id, sort_value)
       VALUES (?, ?, 'Fixture Sticker', 'Sticker description', 'fixture',
               1, 1, ?, 7)`
    ).run(stickerId, applicationId, packId)
    db.prepare(
      'UPDATE sticker_packs SET cover_sticker_id = ? WHERE id = ?'
    ).run(stickerId, packId)

    const packs = listStickerPacks(db)

    expect(packs).toEqual([
      {
        id: packId,
        sku_id: skuId,
        name: 'Fixture Pack',
        description: 'Fixture description',
        stickers: [
          {
            id: stickerId,
            name: 'Fixture Sticker',
            description: 'Sticker description',
            tags: 'fixture',
            type: 1,
            format_type: 1,
            pack_id: packId,
            sort_value: 7,
          },
        ],
        cover_sticker_id: stickerId,
        banner_asset_id: 'banner-asset',
      },
    ])
    const pack = packs.at(0)
    if (!pack) throw new Error('Sticker pack catalog is empty')
    const sticker = pack.stickers.at(0)
    if (!sticker) throw new Error('Sticker pack has no stickers')
    expect(getCatalogSticker(db, stickerId)).toEqual(sticker)
    expect(
      db.prepare('SELECT id FROM skus WHERE id = ?').pluck().get(skuId)
    ).toBe(skuId)
    db.close()
  })

  it('does not return a dangling pack after its seeded SKU is deleted', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, ownerId } = seedApplicationOwner(db)
    const { skuId } = seedSkuSubscription(db, applicationId, ownerId)
    db.prepare(
      `INSERT INTO sticker_packs (id, sku_id, name)
       VALUES ('deletable-pack', ?, 'Deletable Pack')`
    ).run(skuId)

    db.prepare('DELETE FROM skus WHERE id = ?').run(skuId)

    expect(listStickerPacks(db)).toEqual([])
    db.close()
  })

  it('clears a pack cover when its sticker is deleted', () => {
    const db = initializeDatabase(':memory:')
    const { applicationId, ownerId } = seedApplicationOwner(db)
    const { skuId } = seedSkuSubscription(db, applicationId, ownerId)
    db.prepare(
      `INSERT INTO sticker_packs (id, sku_id, name)
       VALUES ('pack-with-deleted-cover', ?, 'Deleted Cover')`
    ).run(skuId)
    db.prepare(
      `INSERT INTO stickers
         (id, application_id, name, tags, type, format_type, pack_id, sort_value)
       VALUES ('deleted-cover', ?, 'Cover', 'cover', 1, 1,
               'pack-with-deleted-cover', 0)`
    ).run(applicationId)
    db.prepare(
      `UPDATE sticker_packs SET cover_sticker_id = 'deleted-cover'
       WHERE id = 'pack-with-deleted-cover'`
    ).run()

    db.prepare("DELETE FROM stickers WHERE id = 'deleted-cover'").run()

    expect(
      db
        .prepare(
          "SELECT cover_sticker_id FROM sticker_packs WHERE id = 'pack-with-deleted-cover'"
        )
        .pluck()
        .get()
    ).toBeNull()
    expect(listStickerPacks(db)).toEqual([
      {
        id: 'pack-with-deleted-cover',
        sku_id: skuId,
        name: 'Deleted Cover',
        description: null,
        stickers: [],
      },
    ])
    db.close()
  })
})
