import { Hono } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError } from '../errors'
import type { AppEnv } from '../middleware/auth'
import { getCatalogSticker, listStickerPacks, listVoiceRegions } from '../services/catalog'

/** Public catalog routes that Discord permits without a credential. */
export function createCatalogPublicRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/sticker-packs', (c) => c.json({ sticker_packs: listStickerPacks(db) }))
  return app
}

/** Authenticated catalog routes. */
export function createCatalogRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/sticker-packs', (c) => c.json({ sticker_packs: listStickerPacks(db) }))
  app.get('/sticker-packs/:packId', (c) => {
    const pack = listStickerPacks(db).find(({ id }) => id === c.req.param('packId'))
    return pack ? c.json(pack) : c.json(discordError(10_060, 'Unknown Sticker', 404).body, 404)
  })
  app.get('/stickers/:stickerId', (c) => {
    const sticker = getCatalogSticker(db, c.req.param('stickerId'))
    return sticker ? c.json(sticker) : c.json(discordError(10_060, 'Unknown Sticker', 404).body, 404)
  })
  app.get('/voice/regions', (c) => c.json(listVoiceRegions()))
  return app
}
