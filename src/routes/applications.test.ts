import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import { createAuthMiddleware, type AppEnv } from '../middleware/auth'
import { createMockRoutes } from './mock'
import {
  createFullTestApp,
  seedApplicationOwner,
  seedBearerCredential,
  seedBot,
  seedSecondUser,
} from '../test-helpers'
import { createApplicationRoutes } from './applications'

describe('application routes', () => {
  let app: Hono<AppEnv>
  let db: Database
  let applicationId: string
  let ownerId: string
  let token: string
  let uploadPath: string

  beforeEach(async () => {
    db = initializeDatabase(':memory:')
    ;({ applicationId, ownerId } = seedApplicationOwner(db))
    token = 'Bot applications-test'
    seedBot(db, token, applicationId)
    uploadPath = await mkdtemp(path.join(tmpdir(), 'fauxcord-app-route-'))
    app = new Hono<AppEnv>()
    app.route('/', createMockRoutes(db, uploadPath))
    app.use('*', createAuthMiddleware(db, false))
    app.route(
      '/',
      createApplicationRoutes(db, 'http://localhost:3000', uploadPath)
    )
  })

  afterEach(async () => {
    await rm(uploadPath, { recursive: true, force: true })
  })

  it('updates @me and retrieves the stored application profile', async () => {
    const update = await app.request('/applications/@me', {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: { default: 'Route updated' },
        tags: ['test'],
      }),
    })
    expect(update.status).toBe(200)
    await expect(update.json()).resolves.toMatchObject({
      id: applicationId,
      description: 'Route updated',
      tags: ['test'],
    })

    const get = await app.request(`/applications/${applicationId}`, {
      headers: { Authorization: token },
    })
    await expect(get.json()).resolves.toMatchObject({
      id: applicationId,
      description: 'Route updated',
    })
  })

  it('returns 401 without a credential and 403 for another application', async () => {
    const unauthorized = await app.request(`/applications/${applicationId}`)
    expect(unauthorized.status).toBe(401)
    const other = seedApplicationOwner(db)
    const denied = await app.request(`/applications/${other.applicationId}`, {
      headers: { Authorization: token },
    })
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({ code: 50_001 })
  })

  it('returns 404 for a missing owned application and 50035 for invalid updates', async () => {
    db.prepare('DELETE FROM applications WHERE id = ?').run(applicationId)
    const missing = await app.request(`/applications/${applicationId}`, {
      headers: { Authorization: token },
    })
    expect(missing.status).toBe(404)

    db.prepare(
      `INSERT INTO applications (id, owner_id, name, verify_key)
       VALUES (?, ?, 'Replacement Application', ?)`
    ).run(applicationId, ownerId, `verify_${applicationId}`)
    const invalid = await app.request(`/applications/${applicationId}`, {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ code: 50_035 })
  })

  it('retrieves an activity instance and stores a multipart attachment', async () => {
    const activity = await app.request(
      `/applications/${applicationId}/activity-instances/instance-1`,
      { headers: { Authorization: token } }
    )
    expect(activity.status).toBe(200)
    await expect(activity.json()).resolves.toMatchObject({
      application_id: applicationId,
      instance_id: 'instance-1',
    })

    const form = new FormData()
    form.set(
      'file',
      new File(['application asset'], 'asset.txt', { type: 'text/plain' })
    )
    const uploaded = await app.request(
      `/applications/${applicationId}/attachment`,
      {
        method: 'POST',
        headers: { Authorization: token },
        body: form,
      }
    )
    expect(uploaded.status).toBe(200)
    const body = (await uploaded.json()) as {
      attachment: { url: string; content_type: string }
    }
    expect(body.attachment.content_type).toBe('text/plain')
    const fetched = await app.request(body.attachment.url)
    expect(fetched.status).toBe(200)
    expect(await fetched.text()).toBe('application asset')
  })

  it('rejects an activity instance ID longer than the OpenAPI maximum', async () => {
    const instanceId = 'x'.repeat(152_134)
    const response = await app.request(
      `/applications/${applicationId}/activity-instances/${instanceId}`,
      { headers: { Authorization: token } }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 50_035 })
  })

  it('allows Bearer only on OpenAPI-permitted application operations', async () => {
    const credential = seedBearerCredential(db, undefined, applicationId)
    db.prepare(
      "UPDATE oauth2_access_tokens SET scope = 'applications.entitlements' WHERE token = ?"
    ).run(credential.bearerToken)
    const authorization = `Bearer ${credential.bearerToken}`

    const form = new FormData()
    form.set('file', new File(['bearer asset'], 'bearer.txt'))
    const attachment = await app.request(
      `/applications/${applicationId}/attachment`,
      {
        method: 'POST',
        headers: { Authorization: authorization },
        body: form,
      }
    )
    expect(attachment.status).toBe(200)
    const entitlements = await app.request(
      `/applications/${applicationId}/entitlements`,
      { headers: { Authorization: authorization } }
    )
    expect(entitlements.status).toBe(200)

    for (const request of [
      { path: `/applications/${applicationId}`, method: 'GET' },
      { path: `/applications/${applicationId}/emojis`, method: 'GET' },
      {
        path: `/applications/${applicationId}/role-connections/metadata`,
        method: 'GET',
      },
      {
        path: `/applications/${applicationId}/entitlements`,
        method: 'POST',
      },
    ]) {
      const response = await app.request(request.path, {
        method: request.method,
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body:
          request.method === 'POST'
            ? JSON.stringify({
                sku_id: '900000000000000001',
                owner_id: ownerId,
                owner_type: 2,
              })
            : undefined,
      })
      expect(response.status, `${request.method} ${request.path}`).toBe(403)
    }
  })

  it('rejects an attachment Bearer token with an unlisted OAuth2 scope', async () => {
    const credential = seedBearerCredential(db, undefined, applicationId)
    db.prepare(
      "UPDATE oauth2_access_tokens SET scope = 'unknown.scope' WHERE token = ?"
    ).run(credential.bearerToken)
    const form = new FormData()
    form.set('file', new File(['denied'], 'denied.txt'))

    const response = await app.request(
      `/applications/${applicationId}/attachment`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential.bearerToken}` },
        body: form,
      }
    )
    expect(response.status).toBe(403)
  })

  it('rejects an attachment request without multipart file using 50035', async () => {
    const form = new FormData()
    const response = await app.request(
      `/applications/${applicationId}/attachment`,
      {
        method: 'POST',
        headers: { Authorization: token },
        body: form,
      }
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 50_035 })
  })

  it('creates, lists, retrieves, updates, and deletes application emojis', async () => {
    const collection = `/applications/${applicationId}/emojis`
    const headers = {
      Authorization: token,
      'Content-Type': 'application/json',
    }
    const createdResponse = await app.request(collection, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'wave',
        image: 'data:image/png;base64,aGVsbG8=',
      }),
    })
    expect(createdResponse.status).toBe(201)
    const created = (await createdResponse.json()) as { id: string }

    const list = await app.request(collection, {
      headers: { Authorization: token },
    })
    await expect(list.json()).resolves.toMatchObject({
      items: [{ id: created.id, name: 'wave' }],
    })
    const get = await app.request(`${collection}/${created.id}`, {
      headers: { Authorization: token },
    })
    expect(get.status).toBe(200)
    const updated = await app.request(`${collection}/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'hello' }),
    })
    await expect(updated.json()).resolves.toMatchObject({ name: 'hello' })
    const deleted = await app.request(`${collection}/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: token },
    })
    expect(deleted.status).toBe(204)
    const missing = await app.request(`${collection}/${created.id}`, {
      headers: { Authorization: token },
    })
    expect(missing.status).toBe(404)
  })

  it('returns 50035 for invalid emoji input and 404 for an unknown emoji', async () => {
    const collection = `/applications/${applicationId}/emojis`
    const invalid = await app.request(collection, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ code: 50_035 })
    const missing = await app.request(`${collection}/0`, {
      headers: { Authorization: token },
    })
    expect(missing.status).toBe(404)
  })

  it('returns 50035 for malformed application and resource snowflakes', async () => {
    const malformedApplication = await app.request(
      '/applications/not-a-snowflake/emojis',
      { headers: { Authorization: token } }
    )
    expect(malformedApplication.status).toBe(400)
    await expect(malformedApplication.json()).resolves.toMatchObject({
      code: 50_035,
    })

    const malformedEntitlement = await app.request(
      `/applications/${applicationId}/entitlements/not-a-snowflake`,
      { headers: { Authorization: token } }
    )
    expect(malformedEntitlement.status).toBe(400)
    await expect(malformedEntitlement.json()).resolves.toMatchObject({
      code: 50_035,
    })
  })

  it('creates, lists, gets, consumes, and deletes entitlements', async () => {
    const { userId } = seedSecondUser(db)
    const skuId = '900000000000000001'
    db.prepare(
      `INSERT INTO skus (id, application_id, name, slug)
       VALUES (?, ?, 'Route SKU', 'route-sku')`
    ).run(skuId, applicationId)
    const collection = `/applications/${applicationId}/entitlements`
    const headers = {
      Authorization: token,
      'Content-Type': 'application/json',
    }
    const create = async (): Promise<{ id: string }> => {
      const response = await app.request(collection, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sku_id: skuId,
          owner_id: userId,
          owner_type: 2,
        }),
      })
      expect(response.status).toBe(200)
      return (await response.json()) as { id: string }
    }
    const consumed = await create()
    const deleted = await create()

    const list = await app.request(
      `${collection}?user_id=${userId}&sku_ids=${skuId}&limit=10`,
      { headers: { Authorization: token } }
    )
    expect((await list.json()) as unknown[]).toHaveLength(2)
    const retrieved = await app.request(`${collection}/${consumed.id}`, {
      headers: { Authorization: token },
    })
    expect(retrieved.status).toBe(200)
    const consumedResponse = await app.request(
      `${collection}/${consumed.id}/consume`,
      {
        method: 'POST',
        headers: { Authorization: token },
      }
    )
    expect(consumedResponse.status).toBe(204)
    const consumedGet = await app.request(`${collection}/${consumed.id}`, {
      headers: { Authorization: token },
    })
    await expect(consumedGet.json()).resolves.toMatchObject({ consumed: true })
    const deletedResponse = await app.request(`${collection}/${deleted.id}`, {
      method: 'DELETE',
      headers: { Authorization: token },
    })
    expect(deletedResponse.status).toBe(204)
    const missing = await app.request(`${collection}/${deleted.id}`, {
      headers: { Authorization: token },
    })
    expect(missing.status).toBe(404)
  })

  it('returns 50035 for invalid entitlement input and queries', async () => {
    const collection = `/applications/${applicationId}/entitlements`
    const headers = {
      Authorization: token,
      'Content-Type': 'application/json',
    }
    const create = await app.request(collection, {
      method: 'POST',
      headers,
      body: JSON.stringify({ owner_type: 3 }),
    })
    expect(create.status).toBe(400)
    await expect(create.json()).resolves.toMatchObject({ code: 50_035 })
    const query = await app.request(`${collection}?limit=0`, {
      headers: { Authorization: token },
    })
    expect(query.status).toBe(400)
    await expect(query.json()).resolves.toMatchObject({ code: 50_035 })

    const invalidUser = await app.request(`${collection}?user_id=invalid`, {
      headers: { Authorization: token },
    })
    expect(invalidUser.status).toBe(400)
    await expect(invalidUser.json()).resolves.toMatchObject({ code: 50_035 })
  })

  it('gets and atomically replaces role connection metadata', async () => {
    const url = `/applications/${applicationId}/role-connections/metadata`
    const initial = await app.request(url, {
      headers: { Authorization: token },
    })
    await expect(initial.json()).resolves.toEqual([])
    const replaced = await app.request(url, {
      method: 'PUT',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          type: 2,
          key: 'score',
          name: 'Score',
          description: 'Player score',
        },
      ]),
    })
    expect(replaced.status).toBe(200)
    await expect(replaced.json()).resolves.toEqual([
      {
        type: 2,
        key: 'score',
        name: 'Score',
        description: 'Player score',
      },
    ])
    const get = await app.request(url, {
      headers: { Authorization: token },
    })
    await expect(get.json()).resolves.toHaveLength(1)
  })

  it('rejects invalid role connection metadata using 50035', async () => {
    const response = await app.request(
      `/applications/${applicationId}/role-connections/metadata`,
      {
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ type: 9, key: '', name: '', description: '' }]),
      }
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 50_035 })
  })
})

describe('application route assembly', () => {
  it('mounts the application domain under every API prefix', async () => {
    const context = createFullTestApp()
    const token = 'Bot application-prefix-test'
    const applicationId = '810000000000000001'
    const ownerId = '810000000000000002'
    seedApplicationOwner(context.db, applicationId, ownerId)
    seedBot(context.db, token, applicationId)

    try {
      for (const prefix of ['/api/v10', '/api', '']) {
        const response = await context.app.request(
          `${prefix}/applications/${applicationId}`,
          { headers: { Authorization: token } }
        )
        expect(response.status, prefix).toBe(200)
      }
    } finally {
      context.cleanup()
    }
  })
})
