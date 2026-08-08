import { beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../db'
import { createAuthMiddleware, type AppEnv } from '../middleware/auth'
import { seedApplicationOwner, seedBot } from '../test-helpers'
import { createPartnerSdkRoutes } from './partner-sdk'

describe('partner SDK routes', () => {
  let app: Hono<AppEnv>
  let token: string
  let clientId: string
  beforeEach(() => {
    const db = initializeDatabase(':memory:')
    const application = seedApplicationOwner(db)
    clientId = application.applicationId
    token = seedBot(db, 'Bot partner-sdk', application.ownerId)
    db.prepare(
      'INSERT INTO oauth2_clients (client_id, client_secret, bot_token) VALUES (?, ?, ?)'
    ).run(clientId, 'partner-secret', token)
    app = new Hono<AppEnv>()
    app.route('/', createPartnerSdkRoutes(db))
    app.use('*', createAuthMiddleware(db, false))
  })
  it('issues a deterministic provisional token from a client credential', async () => {
    const response = await app.request('/partner-sdk/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: 'partner-secret',
        external_auth_token: 'external',
        external_auth_type: 1,
      }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      token_type: 'Bearer',
      scope: 'identify',
    })
  })
})
