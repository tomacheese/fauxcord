/**
 * Test control API routing
 *
 * Implements the /_test/* test-only endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../db'
import {
  setupTestEnvironment,
  deleteTestSetup,
  resetTestData,
  getTestMessages,
} from '../services/test-control'
import { getChannelWebhooks } from '../services/webhooks'

/**
 * Creates the test control API routes.
 * @param db - Database
 * @returns Hono router instance
 */
export function createTestRoutes(db: Database): Hono {
  const app = new Hono()

  // POST /_test/setup — Set up Bot, Guild, and Channel
  app.post('/_test/setup', async (c) => {
    const payload = await c.req.json<{
      token: string
      user?: {
        id?: string
        username?: string
        discriminator?: string
      }
      guilds?: {
        id?: string
        name: string
        channels?: { id?: string; name: string; type?: number }[]
      }[]
    }>()

    try {
      const result = setupTestEnvironment(db, payload)
      return c.json(result, 201)
    } catch (err) {
      if (err instanceof Error && err.message === 'CONFLICT') {
        return c.json({ message: '409: Conflict', code: 0 }, 409)
      }
      throw err
    }
  })

  // DELETE /_test/setup/:token (:token is in "Bot xxx" format)
  app.delete('/_test/setup/*', (c) => {
    // Decode the path parameter manually (Bot tokens may contain spaces)
    const token = decodeURIComponent(c.req.path.replace('/_test/setup/', ''))
    const deleted = deleteTestSetup(db, token)
    if (!deleted) {
      return c.json({ message: '404: Not Found', code: 0 }, 404)
    }
    return c.body(null, 204)
  })

  // POST /_test/reset — Reset test data (messages, etc.)
  app.post('/_test/reset', async (c) => {
    let token: string | undefined
    try {
      const body = await c.req.json<{ token?: string }>()
      token = body.token
    } catch {
      // Reset everything when no body is provided
    }

    resetTestData(db, token)
    return c.body(null, 204)
  })

  // GET /_test/messages/:channelId — List a channel's messages for testing
  app.get('/_test/messages/:channelId', (c) => {
    const { channelId } = c.req.param()
    const messages = getTestMessages(db, channelId)
    return c.json({ messages })
  })

  // GET /_test/webhooks/:channelId — List a channel's webhooks for testing
  app.get('/_test/webhooks/:channelId', (c) => {
    const { channelId } = c.req.param()
    const webhooks = getChannelWebhooks(db, channelId)
    return c.json(webhooks)
  })

  return app
}
