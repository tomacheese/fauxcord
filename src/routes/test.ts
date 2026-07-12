/**
 * Test control API routing
 *
 * Implements the /_test/* test-only endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../database'
import {
  setupTestEnvironment,
  didDeleteTestSetup,
  resetTestData,
  getTestMessages,
} from '../services/test-control'
import { getChannelWebhooks } from '../services/webhooks'

/**
 * Creates the test control API routes.
 * @param database - Database
 * @returns Hono router instance
 */
export function createTestRoutes(database: Database): Hono {
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
      const result = setupTestEnvironment(database, payload)
      return c.json(result, 201)
    } catch (error) {
      if (error instanceof Error && error.message === 'CONFLICT') {
        return c.json({ message: '409: Conflict', code: 0 }, 409)
      }
      throw error
    }
  })

  // DELETE /_test/setup/:token (:token is in "Bot xxx" format)
  app.delete('/_test/setup/*', (c) => {
    // Decode the path parameter manually (Bot tokens may contain spaces)
    const token = decodeURIComponent(c.req.path.replace('/_test/setup/', ''))
    const isDeleted = didDeleteTestSetup(database, token)
    if (!isDeleted) {
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

    resetTestData(database, token)
    return c.body(null, 204)
  })

  // GET /_test/messages/:channelId — List a channel's messages for testing
  app.get('/_test/messages/:channelId', (c) => {
    const { channelId } = c.req.param()
    const messages = getTestMessages(database, channelId)
    return c.json({ messages })
  })

  // GET /_test/webhooks/:channelId — List a channel's webhooks for testing
  app.get('/_test/webhooks/:channelId', (c) => {
    const { channelId } = c.req.param()
    const webhooks = getChannelWebhooks(database, channelId)
    return c.json(webhooks)
  })

  return app
}
