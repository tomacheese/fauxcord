/**
 * Integration tests
 *
 * End-to-end tests for the entire server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase, closeDatabase } from './db'
import { corsMiddleware } from './middleware/cors'
import { versionMiddleware } from './middleware/version'
import { createAuthMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { createChannelRoutes } from './routes/channels'
import { createGuildRoutes } from './routes/guilds'
import { createUserRoutes } from './routes/users'
import { createWebhookRoutes } from './routes/webhooks'
import { createInviteRoutes } from './routes/invites'
import { createTestRoutes } from './routes/test'
import { createMockRoutes } from './routes/mock'
import { seedMember } from './test-helpers'
import type { Database } from './db'

const BASE_URL = 'http://localhost:3000'
const TEST_TOKEN = 'Bot integrationtest'
const GUILD_ID = '100000000000000001'
const CHANNEL_ID = '100000000000000002'
const USER_ID = '100000000000000003'

/** Assembles the test server */
function buildTestServer(db: Database): Hono {
  const app = new Hono()

  app.use('*', corsMiddleware)
  app.use('*', versionMiddleware)

  // Auth-exempt endpoints
  app.route('/', createMockRoutes(db, '/tmp/uploads-test'))
  app.route('/', createTestRoutes(db))

  // Webhook execution does not require auth — register before the auth middleware
  app.route('/', createWebhookRoutes(db, BASE_URL))

  // Auth-required endpoints
  app.use('*', createAuthMiddleware(db, false))
  app.use('*', rateLimitMiddleware)

  const prefixes = ['/api/v10', '/api', '']
  for (const prefix of prefixes) {
    app.route(prefix, createChannelRoutes(db, BASE_URL))
    app.route(prefix, createGuildRoutes(db))
    app.route(prefix, createUserRoutes(db))
    app.route(prefix, createInviteRoutes(db))
  }

  app.onError((err, c) => {
    console.error(err)
    return c.json({ message: '500: Internal Server Error', code: 0 }, 500)
  })

  app.notFound((c) => {
    return c.json({ message: '404: Not Found', code: 0 }, 404)
  })

  return app
}

describe('Integration tests', () => {
  let db: Database
  let app: Hono

  beforeAll(async () => {
    db = initializeDatabase(':memory:')
    app = buildTestServer(db)

    // Set up test environment
    await app.request('/_test/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: TEST_TOKEN,
        user: { id: USER_ID, username: 'IntegrationBot' },
        guilds: [
          {
            id: GUILD_ID,
            name: 'Integration Test Guild',
            channels: [{ id: CHANNEL_ID, name: 'general', type: 0 }],
          },
        ],
      }),
    })
  })

  afterAll(() => {
    closeDatabase(db)
  })

  describe('Health check', () => {
    it('GET /_mock/health returns 200', async () => {
      const res = await app.request('/_mock/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe('ok')
      expect(body.db).toBe('ok')
      expect(typeof body.uptime).toBe('number')
    })
  })

  describe('Version routing', () => {
    it('works with /api/v10/ prefix', async () => {
      const res = await app.request(`/api/v10/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
    })

    it('works with /api/ prefix', async () => {
      const res = await app.request(`/api/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
    })

    it('works with / prefix', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
    })

    it('/api/v9/ returns 400', async () => {
      const res = await app.request(`/api/v9/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.code).toBe(50_041)
    })
  })

  describe('Authentication', () => {
    it('authenticates with a valid token', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
    })

    it('returns 401 for an invalid token', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: 'Bot invalidtoken' },
      })
      expect(res.status).toBe(401)
    })

    it('returns 401 when the Authorization header is absent', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`)
      expect(res.status).toBe(401)
    })
  })

  describe('Rate Limit headers', () => {
    it('response includes Rate Limit headers', async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
      expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy()
      expect(res.headers.get('X-RateLimit-Bucket')).toBeTruthy()
      expect(res.headers.get('X-RateLimit-Scope')).toBe('user')
    })
  })

  describe('Message lifecycle', () => {
    it('supports create → get → update → delete', async () => {
      // Create
      const createRes = await app.request(`/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Integration test message' }),
      })
      expect(createRes.status).toBe(200)
      const created = (await createRes.json()) as Record<string, unknown>
      expect(created.content).toBe('Integration test message')
      const messageId = created.id as string

      // Get
      const getRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(getRes.status).toBe(200)
      const got = (await getRes.json()) as Record<string, unknown>
      expect(got.id).toBe(messageId)

      // Update
      const patchRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Updated content' }),
        }
      )
      expect(patchRes.status).toBe(200)
      const patched = (await patchRes.json()) as Record<string, unknown>
      expect(patched.content).toBe('Updated content')
      expect(patched.edited_timestamp).not.toBeNull()

      // Delete
      const deleteRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(deleteRes.status).toBe(204)

      // Returns 404 after deletion
      const get404 = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(get404.status).toBe(404)
    })
  })

  describe('Pins', () => {
    it('pins and unpins a message', async () => {
      // Create a message
      const createRes = await app.request(`/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Pin test' }),
      })
      const { id: messageId } = await createRes.json()

      // Pin
      const pinRes = await app.request(
        `/channels/${CHANNEL_ID}/pins/${messageId}`,
        {
          method: 'PUT',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(pinRes.status).toBe(204)

      // Pinned list
      const pinsRes = await app.request(`/channels/${CHANNEL_ID}/pins`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(pinsRes.status).toBe(200)
      const pins = (await pinsRes.json()) as { id: string }[]
      expect(pins.some((m) => m.id === messageId)).toBe(true)

      // Unpin
      const unpinRes = await app.request(
        `/channels/${CHANNEL_ID}/pins/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(unpinRes.status).toBe(204)
    })
  })

  describe('Guilds API', () => {
    it('retrieves Guild information', async () => {
      const res = await app.request(`/guilds/${GUILD_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(GUILD_ID)
      expect(body.name).toBe('Integration Test Guild')
    })

    it('retrieves the Guild channel list', async () => {
      const res = await app.request(`/guilds/${GUILD_ID}/channels`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string }[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.some((c) => c.id === CHANNEL_ID)).toBe(true)
    })

    it('creates a channel', async () => {
      const res = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new-channel', type: 0 }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.name).toBe('new-channel')
    })
  })

  describe('Users API', () => {
    it('GET /users/@me returns Bot information', async () => {
      const res = await app.request('/users/@me', {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.id).toBe(USER_ID)
      expect(body.bot).toBe(true)
    })

    it('GET /users/@me/guilds returns the Guild list', async () => {
      const res = await app.request('/users/@me/guilds', {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
    })
  })

  describe('Webhooks API', () => {
    it('creates and executes a Webhook', async () => {
      // Create Webhook
      const createRes = await app.request(`/channels/${CHANNEL_ID}/webhooks`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'TestWebhook' }),
      })
      expect(createRes.status).toBe(200)
      const webhook = (await createRes.json()) as Record<string, string>
      expect(webhook.name).toBe('TestWebhook')

      // Execute Webhook (wait=true)
      const execRes = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Webhook message' }),
        }
      )
      expect(execRes.status).toBe(200)
      const msg = (await execRes.json()) as Record<string, unknown>
      expect(msg.content).toBe('Webhook message')
    })
  })

  describe('Test control API', () => {
    it('POST /_test/reset (full) clears messages', async () => {
      // Use a separate channel to keep the test isolated
      // Create a new channel
      const chRes = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'reset-test-channel', type: 0 }),
      })
      const { id: resetChannelId } = await chRes.json()

      // Send a message
      await app.request(`/channels/${resetChannelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Before reset' }),
      })

      // Full reset
      const resetRes = await app.request('/_test/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(resetRes.status).toBe(204)

      // Messages should be gone
      const msgsRes = await app.request(`/_test/messages/${resetChannelId}`)
      const body = (await msgsRes.json()) as { messages: unknown[] }
      expect(body.messages.length).toBe(0)
    })
  })

  describe('Story: onboarding flow', () => {
    it('creates a channel, posts + pins a message, runs a webhook, and issues an invite', async () => {
      // 1. Create a dedicated channel
      const chRes = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'story-onboarding', type: 0 }),
      })
      expect(chRes.status).toBe(201)
      const { id: channelId } = (await chRes.json()) as { id: string }

      // 2. Post a welcome message
      const msgRes = await app.request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Welcome!' }),
      })
      expect(msgRes.status).toBe(200)
      const { id: messageId } = (await msgRes.json()) as { id: string }

      // 3. Pin it
      const pinRes = await app.request(
        `/channels/${channelId}/pins/${messageId}`,
        { method: 'PUT', headers: { Authorization: TEST_TOKEN } }
      )
      expect(pinRes.status).toBe(204)

      // 4. The pinned list contains it
      const pinsRes = await app.request(`/channels/${channelId}/pins`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(pinsRes.status).toBe(200)
      const pins = (await pinsRes.json()) as { id: string }[]
      expect(pins.some((m) => m.id === messageId)).toBe(true)

      // 5. Create a webhook
      const whRes = await app.request(`/channels/${channelId}/webhooks`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Onboard WH' }),
      })
      expect(whRes.status).toBe(200)
      const webhook = (await whRes.json()) as { id: string; token: string }

      // 6. Execute the webhook
      const execRes = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'via webhook' }),
        }
      )
      expect(execRes.status).toBe(200)
      const execMsg = (await execRes.json()) as { content: string }
      expect(execMsg.content).toBe('via webhook')

      // 7. Create an invite
      const invRes = await app.request(`/channels/${channelId}/invites`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_age: 3600 }),
      })
      expect(invRes.status).toBe(200)
      const invite = (await invRes.json()) as {
        code: string
        channel: { id: string }
      }
      expect(invite.channel.id).toBe(channelId)

      // 8. Fetch the invite by code
      const getInvRes = await app.request(`/invites/${invite.code}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(getInvRes.status).toBe(200)
      const fetched = (await getInvRes.json()) as { code: string }
      expect(fetched.code).toBe(invite.code)
    })
  })

  describe('Story: message reaction lifecycle', () => {
    it('adds, inspects, and removes a reaction, then edits and deletes the message', async () => {
      const thumbsUp = encodeURIComponent('👍')

      // 1. Post a message
      const createRes = await app.request(`/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'react to me' }),
      })
      expect(createRes.status).toBe(200)
      const { id: messageId } = (await createRes.json()) as { id: string }

      // 2. Add own reaction
      const addRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${thumbsUp}/@me`,
        { method: 'PUT', headers: { Authorization: TEST_TOKEN } }
      )
      expect(addRes.status).toBe(204)

      // 3. The reaction user list contains the bot
      const listRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${thumbsUp}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(listRes.status).toBe(200)
      const reactors = (await listRes.json()) as { id: string }[]
      expect(reactors.some((u) => u.id === USER_ID)).toBe(true)

      // 4. The message reflects the reaction aggregate
      const withReaction = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      const reactedMsg = (await withReaction.json()) as {
        reactions?: { count: number; me: boolean; emoji: { name: string } }[]
      }
      const agg = reactedMsg.reactions?.find((r) => r.emoji.name === '👍')
      expect(agg).toBeDefined()
      expect(agg?.count).toBeGreaterThanOrEqual(1)
      // The mock hardcodes `me` to false (see src/services/messages.ts)
      expect(agg?.me).toBe(false)

      // 5. Edit the message
      const patchRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'edited' }),
        }
      )
      expect(patchRes.status).toBe(200)
      const patched = (await patchRes.json()) as {
        content: string
        edited_timestamp: string | null
      }
      expect(patched.content).toBe('edited')
      expect(patched.edited_timestamp).not.toBeNull()

      // 6. Remove own reaction
      const removeRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${thumbsUp}/@me`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(removeRes.status).toBe(204)

      // 7. The reaction user list is now empty
      const emptyRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${thumbsUp}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      const emptyReactors = (await emptyRes.json()) as { id: string }[]
      expect(emptyReactors.length).toBe(0)

      // 8. Delete the message
      const delRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(delRes.status).toBe(204)

      // 9. It is gone
      const goneRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(goneRes.status).toBe(404)
    })
  })

  describe('Story: role assignment lifecycle', () => {
    it('creates a role, assigns it to a member, updates nick, then revokes and deletes', async () => {
      const memberId = seedMember(db, GUILD_ID)

      // 1. Create a role
      const roleRes = await app.request(`/guilds/${GUILD_ID}/roles`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Moderator' }),
      })
      expect(roleRes.status).toBe(200)
      const { id: roleId } = (await roleRes.json()) as { id: string }

      // 2. The role list contains @everyone and the new role
      const rolesRes = await app.request(`/guilds/${GUILD_ID}/roles`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(rolesRes.status).toBe(200)
      const roles = (await rolesRes.json()) as { id: string }[]
      expect(roles.some((r) => r.id === GUILD_ID)).toBe(true)
      expect(roles.some((r) => r.id === roleId)).toBe(true)

      // 3. Assign the role to the member
      const assignRes = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}/roles/${roleId}`,
        { method: 'PUT', headers: { Authorization: TEST_TOKEN } }
      )
      expect(assignRes.status).toBe(204)

      // 4. The member now has the role
      const memberRes = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(memberRes.status).toBe(200)
      const member = (await memberRes.json()) as { roles: string[] }
      expect(member.roles).toContain(roleId)

      // 5. Update the member nickname
      const nickRes = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nick: 'Mod' }),
        }
      )
      expect(nickRes.status).toBe(200)
      const updated = (await nickRes.json()) as { nick: string | null }
      expect(updated.nick).toBe('Mod')

      // 6. Revoke the role
      const revokeRes = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(revokeRes.status).toBe(204)

      // 7. The member no longer has the role
      const afterRes = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      const afterMember = (await afterRes.json()) as { roles: string[] }
      expect(afterMember.roles).not.toContain(roleId)

      // 8. Delete the role
      const delRes = await app.request(`/guilds/${GUILD_ID}/roles/${roleId}`, {
        method: 'DELETE',
        headers: { Authorization: TEST_TOKEN },
      })
      expect(delRes.status).toBe(204)

      // 9. The role list no longer contains it
      const finalRes = await app.request(`/guilds/${GUILD_ID}/roles`, {
        headers: { Authorization: TEST_TOKEN },
      })
      const finalRoles = (await finalRes.json()) as { id: string }[]
      expect(finalRoles.some((r) => r.id === roleId)).toBe(false)
    })
  })

  describe('Story: ban lifecycle', () => {
    it('bans a member with a reason, verifies the ban, then unbans', async () => {
      const memberId = seedMember(db, GUILD_ID)

      // 1. Ban the member (reason via X-Audit-Log-Reason header)
      const banRes = await app.request(`/guilds/${GUILD_ID}/bans/${memberId}`, {
        method: 'PUT',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
          'X-Audit-Log-Reason': 'spamming',
        },
        body: JSON.stringify({}),
      })
      expect(banRes.status).toBe(204)

      // 2. The ban list contains the user
      const listRes = await app.request(`/guilds/${GUILD_ID}/bans`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(listRes.status).toBe(200)
      const bans = (await listRes.json()) as { user: { id: string } }[]
      expect(bans.some((b) => b.user.id === memberId)).toBe(true)

      // 3. Fetch the specific ban with its reason
      const getRes = await app.request(`/guilds/${GUILD_ID}/bans/${memberId}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(getRes.status).toBe(200)
      const ban = (await getRes.json()) as {
        user: { id: string }
        reason: string | null
      }
      expect(ban.user.id).toBe(memberId)
      expect(ban.reason).toBe('spamming')

      // 4. The banned user is removed from guild membership
      const memberRes = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(memberRes.status).toBe(404)

      // 5. Unban
      const unbanRes = await app.request(
        `/guilds/${GUILD_ID}/bans/${memberId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(unbanRes.status).toBe(204)

      // 6. The ban is gone
      const goneRes = await app.request(
        `/guilds/${GUILD_ID}/bans/${memberId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(goneRes.status).toBe(404)
    })
  })

  describe('Story: guild emoji lifecycle', () => {
    it('creates, lists, renames, and deletes a guild emoji', async () => {
      const image = 'data:image/png;base64,iVBORw0KGgo='

      // 1. Create an emoji
      const createRes = await app.request(`/guilds/${GUILD_ID}/emojis`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'party', image }),
      })
      expect(createRes.status).toBe(201)
      const { id: emojiId } = (await createRes.json()) as { id: string }

      // 2. The emoji list contains it
      const listRes = await app.request(`/guilds/${GUILD_ID}/emojis`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(listRes.status).toBe(200)
      const emojis = (await listRes.json()) as { id: string }[]
      expect(emojis.some((e) => e.id === emojiId)).toBe(true)

      // 3. Fetch the single emoji
      const getRes = await app.request(
        `/guilds/${GUILD_ID}/emojis/${emojiId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(getRes.status).toBe(200)
      const emoji = (await getRes.json()) as { name: string }
      expect(emoji.name).toBe('party')

      // 4. Rename it
      const patchRes = await app.request(
        `/guilds/${GUILD_ID}/emojis/${emojiId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'party2' }),
        }
      )
      expect(patchRes.status).toBe(200)
      const renamed = (await patchRes.json()) as { name: string }
      expect(renamed.name).toBe('party2')

      // 5. Delete it
      const delRes = await app.request(
        `/guilds/${GUILD_ID}/emojis/${emojiId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(delRes.status).toBe(204)

      // 6. It is gone
      const goneRes = await app.request(
        `/guilds/${GUILD_ID}/emojis/${emojiId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(goneRes.status).toBe(404)
    })
  })

  describe('Story: channel invite lifecycle', () => {
    it('creates an invite, lists it, fetches by code, then deletes it', async () => {
      // 1. Create an invite
      const createRes = await app.request(`/channels/${CHANNEL_ID}/invites`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_age: 3600 }),
      })
      expect(createRes.status).toBe(200)
      const invite = (await createRes.json()) as {
        code: string
        channel: { id: string }
        guild: { id: string }
      }
      expect(invite.channel.id).toBe(CHANNEL_ID)
      expect(invite.guild.id).toBe(GUILD_ID)

      // 2. The channel invite list contains it
      const listRes = await app.request(`/channels/${CHANNEL_ID}/invites`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(listRes.status).toBe(200)
      const invites = (await listRes.json()) as { code: string }[]
      expect(invites.some((i) => i.code === invite.code)).toBe(true)

      // 3. Fetch the invite by code
      const getRes = await app.request(`/invites/${invite.code}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(getRes.status).toBe(200)
      const fetched = (await getRes.json()) as { code: string }
      expect(fetched.code).toBe(invite.code)

      // 4. Delete the invite (returns the deleted invite)
      const delRes = await app.request(`/invites/${invite.code}`, {
        method: 'DELETE',
        headers: { Authorization: TEST_TOKEN },
      })
      expect(delRes.status).toBe(200)
      const deleted = (await delRes.json()) as { code: string }
      expect(deleted.code).toBe(invite.code)

      // 5. It is gone
      const goneRes = await app.request(`/invites/${invite.code}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(goneRes.status).toBe(404)
    })
  })

  describe('Story: thread lifecycle', () => {
    it('creates a thread from a message, joins, lists, and leaves it', async () => {
      // 1. Post a starter message
      const msgRes = await app.request(`/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'thread starter' }),
      })
      expect(msgRes.status).toBe(200)
      const { id: messageId } = (await msgRes.json()) as { id: string }

      // 2. Create a thread from that message
      const threadRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/threads`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'discussion' }),
        }
      )
      expect(threadRes.status).toBe(201)
      const thread = (await threadRes.json()) as { id: string; name: string }
      expect(thread.id).toBe(messageId)
      expect(thread.name).toBe('discussion')
      const threadId = thread.id

      // 3. Join the thread (idempotent — creator is already a member)
      const joinRes = await app.request(
        `/channels/${threadId}/thread-members/@me`,
        { method: 'PUT', headers: { Authorization: TEST_TOKEN } }
      )
      expect(joinRes.status).toBe(204)

      // 4. The member list contains the bot user
      const listRes = await app.request(
        `/channels/${threadId}/thread-members`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(listRes.status).toBe(200)
      const members = (await listRes.json()) as { user_id: string }[]
      expect(members.some((m) => m.user_id === USER_ID)).toBe(true)

      // 5. Leave the thread
      const leaveRes = await app.request(
        `/channels/${threadId}/thread-members/@me`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(leaveRes.status).toBe(204)

      // 6. The member list no longer contains the bot user
      const afterRes = await app.request(
        `/channels/${threadId}/thread-members`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      const afterMembers = (await afterRes.json()) as { user_id: string }[]
      expect(afterMembers.some((m) => m.user_id === USER_ID)).toBe(false)
    })
  })

  describe('Story: channel permission overwrite lifecycle', () => {
    it('sets and removes a role permission overwrite on a channel', async () => {
      // 1. Create a role to target
      const roleRes = await app.request(`/guilds/${GUILD_ID}/roles`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'PermRole' }),
      })
      expect(roleRes.status).toBe(200)
      const { id: roleId } = (await roleRes.json()) as { id: string }

      // 2. Set a permission overwrite for the role
      const putRes = await app.request(
        `/channels/${CHANNEL_ID}/permissions/${roleId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type: 0, allow: '1024', deny: '2048' }),
        }
      )
      expect(putRes.status).toBe(204)

      // 3. The channel reflects the overwrite
      const chRes = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(chRes.status).toBe(200)
      const channel = (await chRes.json()) as {
        permission_overwrites: { id: string; allow: string; deny: string }[]
      }
      const ow = channel.permission_overwrites.find((o) => o.id === roleId)
      expect(ow).toBeDefined()
      expect(ow?.allow).toBe('1024')
      expect(ow?.deny).toBe('2048')

      // 4. Delete the overwrite
      const delRes = await app.request(
        `/channels/${CHANNEL_ID}/permissions/${roleId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(delRes.status).toBe(204)

      // 5. The channel no longer has the overwrite
      const afterRes = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      const afterChannel = (await afterRes.json()) as {
        permission_overwrites: { id: string }[]
      }
      expect(
        afterChannel.permission_overwrites.some((o) => o.id === roleId)
      ).toBe(false)

      // 6. Clean up the role
      const roleDelRes = await app.request(
        `/guilds/${GUILD_ID}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(roleDelRes.status).toBe(204)
    })
  })

  describe('Story: full webhook lifecycle', () => {
    it('creates, fetches, renames, executes, then deletes a webhook', async () => {
      // 1. Create a webhook
      const createRes = await app.request(`/channels/${CHANNEL_ID}/webhooks`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'LifecycleWH' }),
      })
      expect(createRes.status).toBe(200)
      const webhook = (await createRes.json()) as {
        id: string
        token: string
        name: string
      }
      expect(webhook.name).toBe('LifecycleWH')

      // 2. Fetch it via the token form
      const getRes = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}`
      )
      expect(getRes.status).toBe(200)
      const fetched = (await getRes.json()) as { name: string }
      expect(fetched.name).toBe('LifecycleWH')

      // 3. Rename it
      const patchRes = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'RenamedWH' }),
        }
      )
      expect(patchRes.status).toBe(200)
      const renamed = (await patchRes.json()) as { name: string }
      expect(renamed.name).toBe('RenamedWH')

      // 4. Execute it (wait=true returns the created message)
      const execRes = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'lifecycle msg' }),
        }
      )
      expect(execRes.status).toBe(200)
      const execMsg = (await execRes.json()) as { content: string }
      expect(execMsg.content).toBe('lifecycle msg')

      // 5. The test-control message list shows it as a webhook post
      const msgsRes = await app.request(`/_test/messages/${CHANNEL_ID}`)
      expect(msgsRes.status).toBe(200)
      const { messages } = (await msgsRes.json()) as {
        messages: { content: string; author_token: string }[]
      }
      expect(
        messages.some(
          (m) => m.content === 'lifecycle msg' && m.author_token === 'webhook'
        )
      ).toBe(true)

      // 6. Delete the webhook
      const delRes = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}`,
        { method: 'DELETE' }
      )
      expect(delRes.status).toBe(204)

      // 7. Executing the deleted webhook returns 404
      const afterExec = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'after delete' }),
        }
      )
      expect(afterExec.status).toBe(404)
    })
  })

  describe('Story: bulk message management and typing', () => {
    it('sends a typing indicator, posts messages, then bulk-deletes them', async () => {
      // 1. Create a dedicated channel
      const chRes = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'bulk-ops', type: 0 }),
      })
      expect(chRes.status).toBe(201)
      const { id: channelId } = (await chRes.json()) as { id: string }

      // 2. Send a typing indicator
      const typingRes = await app.request(`/channels/${channelId}/typing`, {
        method: 'POST',
        headers: { Authorization: TEST_TOKEN },
      })
      expect(typingRes.status).toBe(204)

      // 3. Post three messages
      const ids: string[] = []
      for (const content of ['one', 'two', 'three']) {
        const res = await app.request(`/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        })
        expect(res.status).toBe(200)
        const { id } = (await res.json()) as { id: string }
        ids.push(id)
      }

      // 4. The channel lists all three
      const listRes = await app.request(`/channels/${channelId}/messages`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(listRes.status).toBe(200)
      const listed = (await listRes.json()) as { id: string }[]
      for (const id of ids) {
        expect(listed.some((m) => m.id === id)).toBe(true)
      }

      // 5. Bulk-delete them
      const bulkRes = await app.request(
        `/channels/${channelId}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: ids }),
        }
      )
      expect(bulkRes.status).toBe(204)

      // 6. None of them remain
      const afterRes = await app.request(`/channels/${channelId}/messages`, {
        headers: { Authorization: TEST_TOKEN },
      })
      const remaining = (await afterRes.json()) as { id: string }[]
      for (const id of ids) {
        expect(remaining.some((m) => m.id === id)).toBe(false)
      }
    })
  })

  describe('Story: token-scoped reset isolation', () => {
    it('resets only the targeted bot data and preserves the shared bot data', async () => {
      const OTHER_TOKEN = 'Bot story11'
      const OTHER_CHANNEL_ID = '100000000000000092'

      // 1. Register a second bot with its own guild and channel
      const setupRes = await app.request('/_test/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: OTHER_TOKEN,
          user: { id: '100000000000000090', username: 'Story11Bot' },
          guilds: [
            {
              id: '100000000000000091',
              name: 'Story11 Guild',
              channels: [{ id: OTHER_CHANNEL_ID, name: 's11', type: 0 }],
            },
          ],
        }),
      })
      expect(setupRes.status).toBe(201)

      // 2. Post a message from each bot
      const sharedMsgRes = await app.request(
        `/channels/${CHANNEL_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'shared bot keeps this' }),
        }
      )
      expect(sharedMsgRes.status).toBe(200)

      const otherMsgRes = await app.request(
        `/channels/${OTHER_CHANNEL_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: OTHER_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'other bot loses this' }),
        }
      )
      expect(otherMsgRes.status).toBe(200)

      // 3. Reset only the second bot's data
      const resetRes = await app.request('/_test/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: OTHER_TOKEN }),
      })
      expect(resetRes.status).toBe(204)

      // 4. The second bot's channel is empty
      const otherMsgsRes = await app.request(
        `/_test/messages/${OTHER_CHANNEL_ID}`
      )
      const otherBody = (await otherMsgsRes.json()) as { messages: unknown[] }
      expect(otherBody.messages.length).toBe(0)

      // 5. The shared bot's message is preserved
      const sharedMsgsRes = await app.request(`/_test/messages/${CHANNEL_ID}`)
      const sharedBody = (await sharedMsgsRes.json()) as {
        messages: { content: string }[]
      }
      expect(
        sharedBody.messages.some((m) => m.content === 'shared bot keeps this')
      ).toBe(true)
    })
  })
})
