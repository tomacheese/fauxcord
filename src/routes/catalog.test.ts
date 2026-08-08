import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../db'
import { seedApplicationOwner, seedBot, seedSkuSubscription } from '../test-helpers'
import { createCatalogRoutes } from './catalog'

describe('catalog routes', () => {
  it('lists persisted sticker packs and voice regions', async () => {
    const db = initializeDatabase(':memory:')
    const application = seedApplicationOwner(db)
    const token = seedBot(db, 'Bot catalog-routes', application.ownerId)
    const subscription = seedSkuSubscription(db, application.applicationId, application.ownerId)
    const packId = '981111111111111111'
    const stickerId = '981111111111111112'
    db.prepare("INSERT INTO sticker_packs (id, sku_id, name) VALUES (?, ?, 'Fixture Pack')").run(packId, subscription.skuId)
    db.prepare("INSERT INTO stickers (id, name, tags, type, format_type, pack_id, sort_value) VALUES (?, 'Fixture Sticker', 'tag', 1, 1, ?, 0)").run(stickerId, packId)
    const app = new Hono()
    app.route('/', createCatalogRoutes(db))
    const packs = await app.request('/sticker-packs', { headers: { Authorization: token } })
    await expect(packs.json()).resolves.toMatchObject({ sticker_packs: [expect.objectContaining({ id: packId })] })
    const regions = await app.request('/voice/regions', { headers: { Authorization: token } })
    await expect(regions.json()).resolves.toContainEqual(expect.objectContaining({ id: 'us-west' }))
    const subscriptions = await app.request(`/skus/${subscription.skuId}/subscriptions`, { headers: { Authorization: token } })
    expect(subscriptions.status).toBe(200)
    await expect(subscriptions.json()).resolves.toContainEqual(expect.objectContaining({ id: subscription.subscriptionId }))
  })
})
