import { Hono, type Context } from 'hono'
import type { Database } from '../db'
import { discordError } from '../errors'
import type { AppEnv } from '../middleware/auth'
import {
  getCatalogSticker,
  listStickerPacks,
  listVoiceRegions,
} from '../services/catalog'

const SUBSCRIPTION_OAUTH2_SCOPES = new Set([
  'activities.invites.write',
  'activities.read',
  'activities.write',
  'applications.builds.read',
  'applications.builds.upload',
  'applications.commands',
  'applications.commands.permissions.update',
  'applications.commands.update',
  'applications.entitlements',
  'applications.store.update',
  'bot',
  'connections',
  'dm_channels.read',
  'email',
  'gdm.join',
  'guilds',
  'guilds.join',
  'guilds.members.read',
  'identify',
  'messages.read',
  'openid',
  'relationships.read',
  'role_connections.write',
  'rpc',
  'rpc.activities.write',
  'rpc.notifications.read',
  'rpc.screenshare.read',
  'rpc.screenshare.write',
  'rpc.video.read',
  'rpc.video.write',
  'rpc.voice.read',
  'rpc.voice.write',
  'voice',
  'webhook.incoming',
])

function authorizeSubscription(c: Context<AppEnv>) {
  const accessToken = c.get('accessToken')
  if (
    accessToken?.scope
      .split(' ')
      .every((scope) => !SUBSCRIPTION_OAUTH2_SCOPES.has(scope))
  ) {
    return c.json({ message: '403: Forbidden', code: 50_001 }, 403)
  }
  return null
}

/** Public catalog routes that Discord permits without a credential. */
export function createCatalogPublicRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/sticker-packs', (c) =>
    c.json({ sticker_packs: listStickerPacks(db) })
  )
  return app
}

/** Authenticated catalog routes. */
export function createCatalogRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/sticker-packs', (c) =>
    c.json({ sticker_packs: listStickerPacks(db) })
  )
  app.get('/sticker-packs/:packId', (c) => {
    const pack = listStickerPacks(db).find(
      ({ id }) => id === c.req.param('packId')
    )
    return pack
      ? c.json(pack)
      : c.json(discordError(10_060, 'Unknown Sticker', 404).body, 404)
  })
  app.get('/stickers/:stickerId', (c) => {
    const sticker = getCatalogSticker(db, c.req.param('stickerId'))
    return sticker
      ? c.json(sticker)
      : c.json(discordError(10_060, 'Unknown Sticker', 404).body, 404)
  })
  app.get('/voice/regions', (c) => c.json(listVoiceRegions()))
  app.get('/skus/:skuId/subscriptions', (c) => {
    const denied = authorizeSubscription(c)
    if (denied) return denied
    const rows = db
      .prepare(
        `SELECT id, user_id, sku_ids, renewal_sku_ids, entitlement_ids, current_period_start, current_period_end, status, canceled_at, country FROM subscriptions WHERE sku_id = ? ORDER BY id LIMIT ?`
      )
      .all(c.req.param('skuId'), Number(c.req.query('limit') ?? '100')) as {
      id: string
      user_id: string
      sku_ids: string
      renewal_sku_ids: string | null
      entitlement_ids: string
      current_period_start: string
      current_period_end: string
      status: number
      canceled_at: string | null
      country: string | null
    }[]
    return c.json(
      rows.map((row) => ({
        ...row,
        sku_ids: JSON.parse(row.sku_ids),
        renewal_sku_ids: row.renewal_sku_ids
          ? JSON.parse(row.renewal_sku_ids)
          : null,
        entitlement_ids: JSON.parse(row.entitlement_ids),
      }))
    )
  })
  app.get('/skus/:skuId/subscriptions/:subscriptionId', (c) => {
    const denied = authorizeSubscription(c)
    if (denied) return denied
    const row = db
      .prepare(
        `SELECT id, user_id, sku_ids, renewal_sku_ids, entitlement_ids, current_period_start, current_period_end, status, canceled_at, country FROM subscriptions WHERE sku_id = ? AND id = ?`
      )
      .get(c.req.param('skuId'), c.req.param('subscriptionId')) as
      | {
          id: string
          user_id: string
          sku_ids: string
          renewal_sku_ids: string | null
          entitlement_ids: string
          current_period_start: string
          current_period_end: string
          status: number
          canceled_at: string | null
          country: string | null
        }
      | undefined
    return row
      ? c.json({
          ...row,
          sku_ids: JSON.parse(row.sku_ids),
          renewal_sku_ids: row.renewal_sku_ids
            ? JSON.parse(row.renewal_sku_ids)
            : null,
          entitlement_ids: JSON.parse(row.entitlement_ids),
        })
      : c.json(discordError(10_007, 'Unknown Subscription', 404).body, 404)
  })
  return app
}
