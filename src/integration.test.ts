/**
 * Integration tests
 *
 * End-to-end tests for the entire server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase, closeDatabase } from './database'
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
import { createOAuth2Routes } from './routes/oauth2'
import { seedMember } from './test-helpers'
import type { Database } from './database'

const BASE_URL = 'http://localhost:3000'
const TEST_TOKEN = 'Bot integrationtest'
const GUILD_ID = '100000000000000001'
const CHANNEL_ID = '100000000000000002'
const USER_ID = '100000000000000003'

/** Assembles the test server */
function buildTestServer(database: Database): Hono {
  const app = new Hono()

  app.use('*', corsMiddleware)
  app.use('*', versionMiddleware)

  // Auth-exempt endpoints
  app.route('/', createMockRoutes(database, '/tmp/uploads-test'))
  app.route('/', createTestRoutes(database))

  // Webhook execution does not require auth — register before the auth middleware
  app.route('/', createWebhookRoutes(database, BASE_URL))

  // Auth-required endpoints
  app.use('*', createAuthMiddleware(database, false))
  app.use('*', rateLimitMiddleware)

  const prefixes = ['/api/v10', '/api', '']
  for (const prefix of prefixes) {
    app.route(prefix, createChannelRoutes(database, BASE_URL))
    app.route(prefix, createGuildRoutes(database))
    app.route(prefix, createUserRoutes(database))
    app.route(prefix, createOAuth2Routes(database))
    app.route(prefix, createInviteRoutes(database))
  }

  app.onError((error, c) => {
    console.error(error)
    return c.json({ message: '500: Internal Server Error', code: 0 }, 500)
  })

  app.notFound((c) => {
    return c.json({ message: '404: Not Found', code: 0 }, 404)
  })

  return app
}

describe('Integration tests', () => {
  let database: Database
  let app: Hono

  beforeAll(async () => {
    database = initializeDatabase(':memory:')
    app = buildTestServer(database)

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
    closeDatabase(database)
  })

  describe('Health check', () => {
    it('GET /_mock/health returns 200', async () => {
      const resource = await app.request('/_mock/health')
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.status).toBe('ok')
      expect(body.db).toBe('ok')
      expect(typeof body.uptime).toBe('number')
    })
  })

  describe('Version routing', () => {
    it('works with /api/v10/ prefix', async () => {
      const resource = await app.request(`/api/v10/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(200)
    })

    it('works with /api/ prefix', async () => {
      const resource = await app.request(`/api/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(200)
    })

    it('works with / prefix', async () => {
      const resource = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(200)
    })

    it('/api/v9/ returns 400', async () => {
      const resource = await app.request(`/api/v9/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(400)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.code).toBe(50_041)
    })

    // OAuth2 routes were previously only mounted at the bare `/` prefix in
    // src/index.ts (unlike every other route group), so `/api/v10/oauth2/*`
    // and `/api/oauth2/*` returned 404 for real clients that always call
    // through the versioned base URL. Discovered via a real discordjs/
    // oceanic.js compatibility run (compat/) that hit `/api/v10/oauth2/*`
    // directly.
    it('OAuth2 routes work with the /api/v10/ prefix', async () => {
      // Real REST clients (e.g. discord.js/Oceanic.js) send a single global
      // Authorization header on every request, including OAuth2 calls, so
      // this reproduces what a real client sends rather than isolating the
      // route-mounting bug from auth behavior.
      const resource = await app.request('/api/v10/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.access_token).toBeTruthy()
    })

    it('OAuth2 routes work with the /api/ prefix', async () => {
      const resource = await app.request('/api/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      })
      expect(resource.status).toBe(200)
    })
  })

  describe('Authentication', () => {
    it('authenticates with a valid token', async () => {
      const resource = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(200)
    })

    it('returns 401 for an invalid token', async () => {
      const resource = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: 'Bot invalidtoken' },
      })
      expect(resource.status).toBe(401)
    })

    it('returns 401 when the Authorization header is absent', async () => {
      const resource = await app.request(`/channels/${CHANNEL_ID}`)
      expect(resource.status).toBe(401)
    })
  })

  describe('Rate Limit headers', () => {
    it('response includes Rate Limit headers', async () => {
      const resource = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.headers.get('X-RateLimit-Limit')).toBe('5')
      expect(resource.headers.get('X-RateLimit-Remaining')).toBe('4')
      expect(resource.headers.get('X-RateLimit-Reset')).toBeTruthy()
      expect(resource.headers.get('X-RateLimit-Bucket')).toBeTruthy()
      expect(resource.headers.get('X-RateLimit-Scope')).toBe('user')
    })
  })

  describe('Message lifecycle', () => {
    it('supports create → get → update → delete', async () => {
      // Create
      const createdResponse = await app.request(
        `/channels/${CHANNEL_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Integration test message' }),
        }
      )
      expect(createdResponse.status).toBe(200)
      const created = (await createdResponse.json()) as Record<string, unknown>
      expect(created.content).toBe('Integration test message')
      const messageId = created.id as string

      // Get
      const fetchedResponse = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(fetchedResponse.status).toBe(200)
      const got = (await fetchedResponse.json()) as Record<string, unknown>
      expect(got.id).toBe(messageId)

      // Update
      const patchResource = await app.request(
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
      expect(patchResource.status).toBe(200)
      const patched = (await patchResource.json()) as Record<string, unknown>
      expect(patched.content).toBe('Updated content')
      expect(patched.edited_timestamp).not.toBeNull()

      // Delete
      const deletedResponse = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(deletedResponse.status).toBe(204)

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
      const createdResponse = await app.request(
        `/channels/${CHANNEL_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Pin test' }),
        }
      )
      const { id: messageId } = await createdResponse.json()

      // Pin
      const pinResource = await app.request(
        `/channels/${CHANNEL_ID}/pins/${messageId}`,
        {
          method: 'PUT',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(pinResource.status).toBe(204)

      // Pinned list
      const pinsResource = await app.request(`/channels/${CHANNEL_ID}/pins`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(pinsResource.status).toBe(200)
      const pins = (await pinsResource.json()) as { id: string }[]
      expect(pins.some((m) => m.id === messageId)).toBe(true)

      // Unpin
      const unpinResource = await app.request(
        `/channels/${CHANNEL_ID}/pins/${messageId}`,
        {
          method: 'DELETE',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(unpinResource.status).toBe(204)
    })
  })

  describe('Guilds API', () => {
    it('retrieves Guild information', async () => {
      const resource = await app.request(`/guilds/${GUILD_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.id).toBe(GUILD_ID)
      expect(body.name).toBe('Integration Test Guild')
    })

    it('retrieves the Guild channel list', async () => {
      const resource = await app.request(`/guilds/${GUILD_ID}/channels`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as { id: string }[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.some((c) => c.id === CHANNEL_ID)).toBe(true)
    })

    it('creates a channel', async () => {
      const resource = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new-channel', type: 0 }),
      })
      expect(resource.status).toBe(201)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.name).toBe('new-channel')
    })
  })

  describe('Users API', () => {
    it('GET /users/@me returns Bot information', async () => {
      const resource = await app.request('/users/@me', {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as Record<string, unknown>
      expect(body.id).toBe(USER_ID)
      expect(body.bot).toBe(true)
    })

    it('GET /users/@me/guilds returns the Guild list', async () => {
      const resource = await app.request('/users/@me/guilds', {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(resource.status).toBe(200)
      const body = await resource.json()
      expect(Array.isArray(body)).toBe(true)
    })
  })

  describe('Webhooks API', () => {
    it('creates and executes a Webhook', async () => {
      // Create Webhook
      const createdResponse = await app.request(
        `/channels/${CHANNEL_ID}/webhooks`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'TestWebhook' }),
        }
      )
      expect(createdResponse.status).toBe(200)
      const webhook = (await createdResponse.json()) as Record<string, string>
      expect(webhook.name).toBe('TestWebhook')

      // Execute Webhook (wait=true)
      const execResource = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Webhook message' }),
        }
      )
      expect(execResource.status).toBe(200)
      const message = (await execResource.json()) as Record<string, unknown>
      expect(message.content).toBe('Webhook message')
    })
  })

  describe('Test control API', () => {
    it('POST /_test/reset (full) clears messages', async () => {
      // Use a separate channel to keep the test isolated
      // Create a new channel
      const chResource = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'reset-test-channel', type: 0 }),
      })
      const { id: resetChannelId } = await chResource.json()

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
      const resetResource = await app.request('/_test/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(resetResource.status).toBe(204)

      // Messages should be gone
      const msgsResource = await app.request(
        `/_test/messages/${resetChannelId}`
      )
      const body = (await msgsResource.json()) as { messages: unknown[] }
      expect(body.messages.length).toBe(0)
    })
  })

  describe('Story: onboarding flow', () => {
    it('creates a channel, posts + pins a message, runs a webhook, and issues an invite', async () => {
      // 1. Create a dedicated channel
      const chResource = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'story-onboarding', type: 0 }),
      })
      expect(chResource.status).toBe(201)
      const { id: channelId } = (await chResource.json()) as { id: string }

      // 2. Post a welcome message
      const messageResource = await app.request(
        `/channels/${channelId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Welcome!' }),
        }
      )
      expect(messageResource.status).toBe(200)
      const { id: messageId } = (await messageResource.json()) as { id: string }

      // 3. Pin it
      const pinResource = await app.request(
        `/channels/${channelId}/pins/${messageId}`,
        { method: 'PUT', headers: { Authorization: TEST_TOKEN } }
      )
      expect(pinResource.status).toBe(204)

      // 4. The pinned list contains it
      const pinsResource = await app.request(`/channels/${channelId}/pins`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(pinsResource.status).toBe(200)
      const pins = (await pinsResource.json()) as { id: string }[]
      expect(pins.some((m) => m.id === messageId)).toBe(true)

      // 5. Create a webhook
      const whResource = await app.request(`/channels/${channelId}/webhooks`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Onboard WH' }),
      })
      expect(whResource.status).toBe(200)
      const webhook = (await whResource.json()) as { id: string; token: string }

      // 6. Execute the webhook
      const execResource = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'via webhook' }),
        }
      )
      expect(execResource.status).toBe(200)
      const execMessage = (await execResource.json()) as { content: string }
      expect(execMessage.content).toBe('via webhook')

      // 7. Create an invite
      const invResource = await app.request(`/channels/${channelId}/invites`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_age: 3600 }),
      })
      expect(invResource.status).toBe(200)
      const invite = (await invResource.json()) as {
        code: string
        channel: { id: string }
      }
      expect(invite.channel.id).toBe(channelId)

      // 8. Fetch the invite by code
      const fetchedInviteResponse = await app.request(
        `/invites/${invite.code}`,
        {
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(fetchedInviteResponse.status).toBe(200)
      const fetched = (await fetchedInviteResponse.json()) as { code: string }
      expect(fetched.code).toBe(invite.code)
    })
  })

  describe('Story: message reaction lifecycle', () => {
    it('adds, inspects, and removes a reaction, then edits and deletes the message', async () => {
      const thumbsUp = encodeURIComponent('👍')

      // 1. Post a message
      const createdResponse = await app.request(
        `/channels/${CHANNEL_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'react to me' }),
        }
      )
      expect(createdResponse.status).toBe(200)
      const { id: messageId } = (await createdResponse.json()) as { id: string }

      // 2. Add own reaction
      const addedResponse = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${thumbsUp}/@me`,
        { method: 'PUT', headers: { Authorization: TEST_TOKEN } }
      )
      expect(addedResponse.status).toBe(204)

      // 3. The reaction user list contains the bot
      const listResource = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${thumbsUp}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(listResource.status).toBe(200)
      const reactors = (await listResource.json()) as { id: string }[]
      expect(reactors.some((u) => u.id === USER_ID)).toBe(true)

      // 4. The message reflects the reaction aggregate
      const withReaction = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(withReaction.status).toBe(200)
      const reactedMessage = (await withReaction.json()) as {
        reactions?: { count: number; me: boolean; emoji: { name: string } }[]
      }
      const agg = reactedMessage.reactions?.find((r) => r.emoji.name === '👍')
      expect(agg).toBeDefined()
      expect(agg?.count).toBeGreaterThanOrEqual(1)
      // The mock hardcodes `me` to false (see src/services/messages.ts)
      expect(agg?.me).toBe(false)

      // 5. Edit the message
      const patchResource = await app.request(
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
      expect(patchResource.status).toBe(200)
      const patched = (await patchResource.json()) as {
        content: string
        edited_timestamp: string | null
      }
      expect(patched.content).toBe('edited')
      expect(patched.edited_timestamp).not.toBeNull()

      // 6. Remove own reaction
      const removedResponse = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${thumbsUp}/@me`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(removedResponse.status).toBe(204)

      // 7. The reaction user list is now empty
      const emptyResource = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${thumbsUp}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(emptyResource.status).toBe(200)
      const emptyReactors = (await emptyResource.json()) as { id: string }[]
      expect(emptyReactors.length).toBe(0)

      // 8. Delete the message
      const delResource = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(delResource.status).toBe(204)

      // 9. It is gone
      const goneResource = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(goneResource.status).toBe(404)
    })
  })

  describe('Story: role assignment lifecycle', () => {
    it('creates a role, assigns it to a member, updates nick, then revokes and deletes', async () => {
      const memberId = seedMember(database, GUILD_ID)

      // 1. Create a role
      const roleResource = await app.request(`/guilds/${GUILD_ID}/roles`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Moderator' }),
      })
      expect(roleResource.status).toBe(200)
      const { id: roleId } = (await roleResource.json()) as { id: string }

      // 2. The role list contains @everyone and the new role
      const rolesResource = await app.request(`/guilds/${GUILD_ID}/roles`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(rolesResource.status).toBe(200)
      const roles = (await rolesResource.json()) as { id: string }[]
      expect(roles.some((r) => r.id === GUILD_ID)).toBe(true)
      expect(roles.some((r) => r.id === roleId)).toBe(true)

      // 3. Assign the role to the member
      const assignResource = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}/roles/${roleId}`,
        { method: 'PUT', headers: { Authorization: TEST_TOKEN } }
      )
      expect(assignResource.status).toBe(204)

      // 4. The member now has the role
      const memberResource = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(memberResource.status).toBe(200)
      const member = (await memberResource.json()) as { roles: string[] }
      expect(member.roles).toContain(roleId)

      // 5. Update the member nickname
      const nickResource = await app.request(
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
      expect(nickResource.status).toBe(200)
      const updated = (await nickResource.json()) as { nick: string | null }
      expect(updated.nick).toBe('Mod')

      // 6. Revoke the role
      const revokeResource = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(revokeResource.status).toBe(204)

      // 7. The member no longer has the role
      const afterResource = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      const afterMember = (await afterResource.json()) as { roles: string[] }
      expect(afterMember.roles).not.toContain(roleId)

      // 8. Delete the role
      const delResource = await app.request(
        `/guilds/${GUILD_ID}/roles/${roleId}`,
        {
          method: 'DELETE',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(delResource.status).toBe(204)

      // 9. The role list no longer contains it
      const finalResource = await app.request(`/guilds/${GUILD_ID}/roles`, {
        headers: { Authorization: TEST_TOKEN },
      })
      const finalRoles = (await finalResource.json()) as { id: string }[]
      expect(finalRoles.some((r) => r.id === roleId)).toBe(false)
    })
  })

  describe('Story: ban lifecycle', () => {
    it('bans a member with a reason, verifies the ban, then unbans', async () => {
      const memberId = seedMember(database, GUILD_ID)

      // 1. Ban the member (reason via X-Audit-Log-Reason header)
      const banResource = await app.request(
        `/guilds/${GUILD_ID}/bans/${memberId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
            'X-Audit-Log-Reason': 'spamming',
          },
          body: JSON.stringify({}),
        }
      )
      expect(banResource.status).toBe(204)

      // 2. The ban list contains the user
      const listResource = await app.request(`/guilds/${GUILD_ID}/bans`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(listResource.status).toBe(200)
      const bans = (await listResource.json()) as { user: { id: string } }[]
      expect(bans.some((b) => b.user.id === memberId)).toBe(true)

      // 3. Fetch the specific ban with its reason
      const fetchedResponse = await app.request(
        `/guilds/${GUILD_ID}/bans/${memberId}`,
        {
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(fetchedResponse.status).toBe(200)
      const ban = (await fetchedResponse.json()) as {
        user: { id: string }
        reason: string | null
      }
      expect(ban.user.id).toBe(memberId)
      expect(ban.reason).toBe('spamming')

      // 4. The banned user is removed from guild membership
      const memberResource = await app.request(
        `/guilds/${GUILD_ID}/members/${memberId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(memberResource.status).toBe(404)

      // 5. Unban
      const unbanResource = await app.request(
        `/guilds/${GUILD_ID}/bans/${memberId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(unbanResource.status).toBe(204)

      // 6. The ban is gone
      const goneResource = await app.request(
        `/guilds/${GUILD_ID}/bans/${memberId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(goneResource.status).toBe(404)
    })
  })

  describe('Story: guild emoji lifecycle', () => {
    it('creates, lists, renames, and deletes a guild emoji', async () => {
      const image = 'data:image/png;base64,iVBORw0KGgo='

      // 1. Create an emoji
      const createdResponse = await app.request(`/guilds/${GUILD_ID}/emojis`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'party', image }),
      })
      expect(createdResponse.status).toBe(201)
      const { id: emojiId } = (await createdResponse.json()) as { id: string }

      // 2. The emoji list contains it
      const listResource = await app.request(`/guilds/${GUILD_ID}/emojis`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(listResource.status).toBe(200)
      const emojis = (await listResource.json()) as { id: string }[]
      expect(emojis.some((error) => error.id === emojiId)).toBe(true)

      // 3. Fetch the single emoji
      const fetchedResponse = await app.request(
        `/guilds/${GUILD_ID}/emojis/${emojiId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(fetchedResponse.status).toBe(200)
      const emoji = (await fetchedResponse.json()) as { name: string }
      expect(emoji.name).toBe('party')

      // 4. Rename it
      const patchResource = await app.request(
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
      expect(patchResource.status).toBe(200)
      const renamed = (await patchResource.json()) as { name: string }
      expect(renamed.name).toBe('party2')

      // 5. Delete it
      const delResource = await app.request(
        `/guilds/${GUILD_ID}/emojis/${emojiId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(delResource.status).toBe(204)

      // 6. It is gone
      const goneResource = await app.request(
        `/guilds/${GUILD_ID}/emojis/${emojiId}`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(goneResource.status).toBe(404)
    })
  })

  describe('Story: channel invite lifecycle', () => {
    it('creates an invite, lists it, fetches by code, then deletes it', async () => {
      // 1. Create an invite
      const createdResponse = await app.request(
        `/channels/${CHANNEL_ID}/invites`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ max_age: 3600 }),
        }
      )
      expect(createdResponse.status).toBe(200)
      const invite = (await createdResponse.json()) as {
        code: string
        channel: { id: string }
        guild: { id: string }
      }
      expect(invite.channel.id).toBe(CHANNEL_ID)
      expect(invite.guild.id).toBe(GUILD_ID)

      // 2. The channel invite list contains it
      const listResource = await app.request(
        `/channels/${CHANNEL_ID}/invites`,
        {
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(listResource.status).toBe(200)
      const invites = (await listResource.json()) as { code: string }[]
      expect(invites.some((index) => index.code === invite.code)).toBe(true)

      // 3. Fetch the invite by code
      const fetchedResponse = await app.request(`/invites/${invite.code}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(fetchedResponse.status).toBe(200)
      const fetched = (await fetchedResponse.json()) as { code: string }
      expect(fetched.code).toBe(invite.code)

      // 4. Delete the invite (returns the deleted invite)
      const delResource = await app.request(`/invites/${invite.code}`, {
        method: 'DELETE',
        headers: { Authorization: TEST_TOKEN },
      })
      expect(delResource.status).toBe(200)
      const deleted = (await delResource.json()) as { code: string }
      expect(deleted.code).toBe(invite.code)

      // 5. It is gone
      const goneResource = await app.request(`/invites/${invite.code}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(goneResource.status).toBe(404)
    })
  })

  describe('Story: thread lifecycle', () => {
    it('creates a thread from a message, joins, lists, and leaves it', async () => {
      // 1. Post a starter message
      const messageResource = await app.request(
        `/channels/${CHANNEL_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'thread starter' }),
        }
      )
      expect(messageResource.status).toBe(200)
      const { id: messageId } = (await messageResource.json()) as { id: string }

      // 2. Create a thread from that message
      const threadResource = await app.request(
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
      expect(threadResource.status).toBe(201)
      const thread = (await threadResource.json()) as {
        id: string
        name: string
      }
      expect(thread.id).toBe(messageId)
      expect(thread.name).toBe('discussion')
      const threadId = thread.id

      // 3. Join the thread (idempotent — creator is already a member)
      const joinResource = await app.request(
        `/channels/${threadId}/thread-members/@me`,
        { method: 'PUT', headers: { Authorization: TEST_TOKEN } }
      )
      expect(joinResource.status).toBe(204)

      // 4. The member list contains the bot user
      const listResource = await app.request(
        `/channels/${threadId}/thread-members`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      expect(listResource.status).toBe(200)
      const members = (await listResource.json()) as { user_id: string }[]
      expect(members.some((m) => m.user_id === USER_ID)).toBe(true)

      // 5. Leave the thread
      const leaveResource = await app.request(
        `/channels/${threadId}/thread-members/@me`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(leaveResource.status).toBe(204)

      // 6. The member list no longer contains the bot user
      const afterResource = await app.request(
        `/channels/${threadId}/thread-members`,
        { headers: { Authorization: TEST_TOKEN } }
      )
      const afterMembers = (await afterResource.json()) as { user_id: string }[]
      expect(afterMembers.some((m) => m.user_id === USER_ID)).toBe(false)
    })
  })

  describe('Story: channel permission overwrite lifecycle', () => {
    it('sets and removes a role permission overwrite on a channel', async () => {
      // 1. Create a role to target
      const roleResource = await app.request(`/guilds/${GUILD_ID}/roles`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'PermRole' }),
      })
      expect(roleResource.status).toBe(200)
      const { id: roleId } = (await roleResource.json()) as { id: string }

      // 2. Set a permission overwrite for the role
      const putResource = await app.request(
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
      expect(putResource.status).toBe(204)

      // 3. The channel reflects the overwrite
      const chResource = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      expect(chResource.status).toBe(200)
      const channel = (await chResource.json()) as {
        permission_overwrites: { id: string; allow: string; deny: string }[]
      }
      const ow = channel.permission_overwrites.find((o) => o.id === roleId)
      expect(ow).toBeDefined()
      expect(ow?.allow).toBe('1024')
      expect(ow?.deny).toBe('2048')

      // 4. Delete the overwrite
      const delResource = await app.request(
        `/channels/${CHANNEL_ID}/permissions/${roleId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(delResource.status).toBe(204)

      // 5. The channel no longer has the overwrite
      const afterResource = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      })
      const afterChannel = (await afterResource.json()) as {
        permission_overwrites: { id: string }[]
      }
      expect(
        afterChannel.permission_overwrites.some((o) => o.id === roleId)
      ).toBe(false)

      // 6. Clean up the role
      const roleDelResource = await app.request(
        `/guilds/${GUILD_ID}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: TEST_TOKEN } }
      )
      expect(roleDelResource.status).toBe(204)
    })
  })

  describe('Story: full webhook lifecycle', () => {
    it('creates, fetches, renames, executes, then deletes a webhook', async () => {
      // 1. Create a webhook
      const createdResponse = await app.request(
        `/channels/${CHANNEL_ID}/webhooks`,
        {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'LifecycleWH' }),
        }
      )
      expect(createdResponse.status).toBe(200)
      const webhook = (await createdResponse.json()) as {
        id: string
        token: string
        name: string
      }
      expect(webhook.name).toBe('LifecycleWH')

      // 2. Fetch it via the token form
      const fetchedResponse = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}`
      )
      expect(fetchedResponse.status).toBe(200)
      const fetched = (await fetchedResponse.json()) as { name: string }
      expect(fetched.name).toBe('LifecycleWH')

      // 3. Rename it
      const patchResource = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'RenamedWH' }),
        }
      )
      expect(patchResource.status).toBe(200)
      const renamed = (await patchResource.json()) as { name: string }
      expect(renamed.name).toBe('RenamedWH')

      // 4. Execute it (wait=true returns the created message)
      const execResource = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'lifecycle msg' }),
        }
      )
      expect(execResource.status).toBe(200)
      const execMessage = (await execResource.json()) as { content: string }
      expect(execMessage.content).toBe('lifecycle msg')

      // 5. The test-control message list shows it as a webhook post
      const msgsResource = await app.request(`/_test/messages/${CHANNEL_ID}`)
      expect(msgsResource.status).toBe(200)
      const { messages } = (await msgsResource.json()) as {
        messages: { content: string; author_token: string }[]
      }
      expect(
        messages.some(
          (m) => m.content === 'lifecycle msg' && m.author_token === 'webhook'
        )
      ).toBe(true)

      // 6. Delete the webhook
      const delResource = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}`,
        { method: 'DELETE' }
      )
      expect(delResource.status).toBe(204)

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
      const chResource = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: {
          Authorization: TEST_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'bulk-ops', type: 0 }),
      })
      expect(chResource.status).toBe(201)
      const { id: channelId } = (await chResource.json()) as { id: string }

      // 2. Send a typing indicator
      const typingResource = await app.request(
        `/channels/${channelId}/typing`,
        {
          method: 'POST',
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(typingResource.status).toBe(204)

      // 3. Post three messages
      const ids: string[] = []
      for (const content of ['one', 'two', 'three']) {
        const resource = await app.request(`/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: TEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        })
        expect(resource.status).toBe(200)
        const { id } = (await resource.json()) as { id: string }
        ids.push(id)
      }

      // 4. The channel lists all three
      const listResource = await app.request(
        `/channels/${channelId}/messages`,
        {
          headers: { Authorization: TEST_TOKEN },
        }
      )
      expect(listResource.status).toBe(200)
      const listed = (await listResource.json()) as { id: string }[]
      for (const id of ids) {
        expect(listed.some((m) => m.id === id)).toBe(true)
      }

      // 5. Bulk-delete them
      const bulkResource = await app.request(
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
      expect(bulkResource.status).toBe(204)

      // 6. None of them remain
      const afterResource = await app.request(
        `/channels/${channelId}/messages`,
        {
          headers: { Authorization: TEST_TOKEN },
        }
      )
      const remaining = (await afterResource.json()) as { id: string }[]
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
      const setupResource = await app.request('/_test/setup', {
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
      expect(setupResource.status).toBe(201)

      // 2. Post a message from each bot
      const sharedMessageResource = await app.request(
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
      expect(sharedMessageResource.status).toBe(200)

      const otherMessageResource = await app.request(
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
      expect(otherMessageResource.status).toBe(200)

      // 3. Reset only the second bot's data
      const resetResource = await app.request('/_test/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: OTHER_TOKEN }),
      })
      expect(resetResource.status).toBe(204)

      // 4. The second bot's channel is empty
      const otherMsgsResource = await app.request(
        `/_test/messages/${OTHER_CHANNEL_ID}`
      )
      expect(otherMsgsResource.status).toBe(200)
      const otherBody = (await otherMsgsResource.json()) as {
        messages: unknown[]
      }
      expect(otherBody.messages.length).toBe(0)

      // 5. The shared bot's message is preserved
      const sharedMsgsResource = await app.request(
        `/_test/messages/${CHANNEL_ID}`
      )
      expect(sharedMsgsResource.status).toBe(200)
      const sharedBody = (await sharedMsgsResource.json()) as {
        messages: { content: string }[]
      }
      expect(
        sharedBody.messages.some((m) => m.content === 'shared bot keeps this')
      ).toBe(true)
    })
  })
})
