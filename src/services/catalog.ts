/**
 * Deterministic catalog objects backed by local fixture identities where the
 * Discord response exposes resource relationships.
 */

import type { Database } from '../db'

/** Voice region response exposed by Discord's region catalog endpoints. */
export interface VoiceRegionObject {
  id: string
  name: string
  custom: boolean
  deprecated: boolean
  optimal: boolean
}

/** Standard sticker response embedded in a sticker pack. */
export interface CatalogStickerObject {
  id: string
  name: string
  description: string | null
  tags: string
  type: number
  format_type: number
  pack_id: string
  sort_value: number
}

/** Sticker pack response whose IDs resolve to local persistent resources. */
export interface StickerPackObject {
  id: string
  sku_id: string
  name: string
  description: string | null
  stickers: CatalogStickerObject[]
  cover_sticker_id?: string
  banner_asset_id?: string
}

const VOICE_REGIONS: VoiceRegionObject[] = [
  {
    id: 'us-west',
    name: 'US West',
    custom: false,
    deprecated: false,
    optimal: true,
  },
  {
    id: 'us-east',
    name: 'US East',
    custom: false,
    deprecated: false,
    optimal: false,
  },
  {
    id: 'eu-central',
    name: 'Europe Central',
    custom: false,
    deprecated: false,
    optimal: false,
  },
]

interface StickerPackRow {
  id: string
  sku_id: string
  name: string
  description: string | null
  cover_sticker_id: string | null
  banner_asset_id: string | null
}

interface CatalogStickerRow {
  id: string
  name: string
  description: string | null
  tags: string
  type: number
  format_type: number
  pack_id: string
  sort_value: number
}

function mapCatalogSticker(row: CatalogStickerRow): CatalogStickerObject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: row.tags,
    type: row.type,
    format_type: row.format_type,
    pack_id: row.pack_id,
    sort_value: row.sort_value,
  }
}

function mapStickerPack(db: Database, row: StickerPackRow): StickerPackObject {
  const stickerRows = db
    .prepare(
      `SELECT id, name, description, tags, type, format_type, pack_id,
              sort_value
       FROM stickers
       WHERE pack_id = ?
       ORDER BY sort_value, id`
    )
    .all(row.id) as CatalogStickerRow[]
  const pack: StickerPackObject = {
    id: row.id,
    sku_id: row.sku_id,
    name: row.name,
    description: row.description,
    stickers: stickerRows.map((sticker) => mapCatalogSticker(sticker)),
  }
  if (
    row.cover_sticker_id !== null &&
    stickerRows.some(({ id }) => id === row.cover_sticker_id)
  ) {
    pack.cover_sticker_id = row.cover_sticker_id
  }
  if (row.banner_asset_id !== null) {
    pack.banner_asset_id = row.banner_asset_id
  }
  return pack
}

/**
 * Lists deterministic voice regions as fresh response objects.
 * @returns Voice region response list
 */
export function listVoiceRegions(): VoiceRegionObject[] {
  return VOICE_REGIONS.map((region) => ({ ...region }))
}

/**
 * Lists sticker packs and their standard stickers from persistent identities.
 * @param db - Database
 * @returns Sticker pack response list
 */
export function listStickerPacks(db: Database): StickerPackObject[] {
  const packs = db
    .prepare(
      `SELECT id, sku_id, name, description, cover_sticker_id, banner_asset_id
       FROM sticker_packs
       ORDER BY id`
    )
    .all() as StickerPackRow[]
  return packs.map((pack) => mapStickerPack(db, pack))
}

/**
 * Gets a standard catalog sticker by ID.
 * @param db - Database
 * @param stickerId - Sticker ID
 * @returns Sticker response, or undefined when it is not in a pack
 */
export function getCatalogSticker(
  db: Database,
  stickerId: string
): CatalogStickerObject | undefined {
  const row = db
    .prepare(
      `SELECT id, name, description, tags, type, format_type, pack_id,
              sort_value
       FROM stickers
       WHERE id = ? AND pack_id IS NOT NULL`
    )
    .get(stickerId) as CatalogStickerRow | undefined
  return row ? mapCatalogSticker(row) : undefined
}
