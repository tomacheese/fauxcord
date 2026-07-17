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
  createTestUser,
  injectTestMessage,
  createTestInteraction,
} from '../services/test-control'
import type { TestInteractionRequest } from '../services/test-control'
import { getChannelWebhooks } from '../services/webhooks'
import { injectPollVote } from '../services/polls'

/**
 * Creates the test control API routes.
 * @param db - Database
 * @param baseUrl - Base URL (used for injected message attachment URL generation)
 * @returns Hono router instance
 */
export function createTestRoutes(db: Database, baseUrl: string): Hono {
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

  // POST /_test/users — Register a non-bot user for testing
  app.post('/_test/users', async (c) => {
    const payload = await c.req.json<{
      id?: string
      username?: string
      discriminator?: string
    }>()

    if (!payload.username) {
      return c.json({ message: '400: Bad Request', code: 0 }, 400)
    }

    try {
      const result = createTestUser(db, {
        id: payload.id,
        username: payload.username,
        discriminator: payload.discriminator,
      })
      return c.json(result, 201)
    } catch (err) {
      if (err instanceof Error && err.message === 'CONFLICT') {
        return c.json({ message: '409: Conflict', code: 0 }, 409)
      }
      throw err
    }
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

  // POST /_test/channels/:channelId/messages — Inject a message authored by
  // a pre-registered user (see POST /_test/users)
  app.post('/_test/channels/:channelId/messages', async (c) => {
    const { channelId } = c.req.param()
    const payload = await c.req.json<{
      content?: string
      author?: { id?: string }
    }>()

    if (!payload.content || !payload.author?.id) {
      return c.json({ message: '400: Bad Request', code: 0 }, 400)
    }

    const result = injectTestMessage(
      db,
      channelId,
      { content: payload.content, author: { id: payload.author.id } },
      baseUrl
    )

    if (result === 'UNKNOWN_CHANNEL' || result === 'UNKNOWN_USER') {
      return c.json({ message: '404: Not Found', code: 0 }, 404)
    }

    return c.json(result, 201)
  })

  // POST /_test/interactions — Simulate an interaction against a registered
  // command, without a real Discord client.
  app.post('/_test/interactions', async (c) => {
    const body = await c.req.json<TestInteractionRequest>()
    const result = createTestInteraction(db, body)
    if (!result.ok) {
      return c.json({ message: '404: Not Found', code: 0 }, 404)
    }
    return c.json(result.interaction, 201)
  })

  // POST /_test/polls/:messageId/votes — Inject a poll vote for testing
  app.post('/_test/polls/:messageId/votes', async (c) => {
    const { messageId } = c.req.param()
    const payload = await c.req.json<{
      answer_id?: number
      user_id?: string
    }>()

    if (payload.answer_id === undefined || !payload.user_id) {
      return c.json({ message: '400: Bad Request', code: 0 }, 400)
    }

    const result = injectPollVote(
      db,
      messageId,
      payload.answer_id,
      payload.user_id
    )
    if (result === 'UNKNOWN_MESSAGE' || result === 'UNKNOWN_ANSWER') {
      return c.json({ message: '404: Not Found', code: 0 }, 404)
    }

    return c.body(null, 204)
  })

  return app
}
