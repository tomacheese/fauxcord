import { afterEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { createRequire } from 'node:module'
import type { Database } from './db'
import {
  MANIFEST,
  type SpecEndpoint,
  type SpecSuccessBranch,
} from '../spec/manifest'
import { serveWithGateway } from './http-server'
import { createContractFixture, createRealServer } from './test-helpers'

const require = createRequire(import.meta.url)
const addFormats = require('ajv-formats') as (ajv: Ajv2020) => void
const spec = JSON.parse(
  readFileSync(new URL('../spec/openapi.json', import.meta.url), 'utf8')
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<string, { content?: Record<string, unknown> }>
      }
    >
  >
}
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: true,
})
addFormats(ajv)
ajv.addFormat('snowflake', /^(0|[1-9][0-9]*)$/)
ajv.addFormat('nonce', true)
ajv.addSchema(spec, 'https://discord.com/spec')

function responseSchema(
  entry: SpecEndpoint,
  branch: SpecSuccessBranch
): { $ref: string } | undefined {
  const response =
    spec.paths[entry.specPath][entry.method].responses?.[String(branch.status)]
  if (!response?.content?.['application/json']) return undefined
  const escapedPath = entry.specPath.replaceAll('~', '~0').replaceAll('/', '~1')
  return {
    $ref:
      `https://discord.com/spec#/paths/${escapedPath}/${entry.method}` +
      `/responses/${branch.status}/content/application~1json/schema`,
  }
}

async function assertResponseBody(
  entry: SpecEndpoint,
  branch: SpecSuccessBranch,
  response: Response,
  label: string
): Promise<void> {
  if (branch.body === 'empty') {
    await expect(response.text(), label).resolves.toBe('')
    return
  }
  if (branch.body === 'json') {
    const body: unknown = await response.json()
    const schema = responseSchema(entry, branch)
    expect(schema, `No JSON schema found for ${label}`).toBeDefined()
    if (!schema) return
    const validate = ajv.compile(schema)
    if (!validate(body)) {
      throw new Error(
        `Schema validation failed for ${label}: ${JSON.stringify(validate.errors)}`
      )
    }
    return
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(bytes.byteLength, label).toBeGreaterThan(0)
  if (branch.body === 'png') {
    expect([...bytes.subarray(0, 8)], label).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])
    let offset = 8
    const chunks: string[] = []
    while (offset < bytes.byteLength) {
      expect(offset + 12, label).toBeLessThanOrEqual(bytes.byteLength)
      const length = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
        4
      ).getUint32(0)
      const chunkEnd = offset + 12 + length
      expect(chunkEnd, label).toBeLessThanOrEqual(bytes.byteLength)
      chunks.push(
        new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
      )
      offset = chunkEnd
    }
    expect(chunks, label).toContain('IHDR')
    expect(chunks.at(-1), label).toBe('IEND')
    return
  }
  expect(new TextDecoder().decode(bytes).trim(), label).not.toBe('')
}

describe('real HTTP contract fixture', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('starts the production app assembly on an OS-assigned port', async () => {
    const requestedPorts: number[] = []
    const server = await createRealServer({
      serve: (options, listener) => {
        requestedPorts.push(options.port)
        return serveWithGateway(options, listener)
      },
    })
    close = server.close
    const response = await fetch(`${server.baseUrl}/_mock/health`)

    expect(new URL(response.url).port).not.toBe('3000')
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      db: 'ok',
    })

    const gateway = (await fetch(`${server.baseUrl}/api/v10/gateway`).then(
      (result) => result.json()
    )) as { url: string }
    expect(gateway.url).toBe(server.baseUrl.replace('http:', 'ws:'))
    expect(requestedPorts).toEqual([0])

    await server.close()
    await server.close()
    close = undefined
  })

  it('keeps stable resources isolated from destructive request fixtures', async () => {
    const server = await createRealServer()
    close = server.close
    const fixture = createContractFixture(server.db)
    const headers = { Authorization: fixture.token }

    const deleted = await fetch(
      `${server.baseUrl}/api/v10/invites/${fixture.deletableInviteCode}`,
      { method: 'DELETE', headers }
    )
    expect(deleted.status).toBe(200)
    expect(
      await fetch(`${server.baseUrl}/api/v10/invites/${fixture.inviteCode}`, {
        headers,
      }).then((response) => response.status)
    ).toBe(200)

    const deletedMessage = await fetch(
      `${server.baseUrl}/api/v10/channels/${fixture.channelId}/messages/${fixture.deletableMessageId}`,
      { method: 'DELETE', headers }
    )
    expect(deletedMessage.status).toBe(204)
    expect(
      await fetch(
        `${server.baseUrl}/api/v10/channels/${fixture.channelId}/messages/${fixture.messageId}`,
        { headers }
      ).then((response) => response.status)
    ).toBe(200)
  })

  it('rejects a destructive assertion when a sibling resource changed instead', async () => {
    const server = await createRealServer()
    close = server.close
    const fixture = createContractFixture(server.db)
    const entry = MANIFEST.find(
      ({ method, specPath }) =>
        method === 'delete' && specPath === '/invites/{code}'
    )
    expect(entry).toBeDefined()
    const branch = entry?.successBranches[0]
    expect(branch).toBeDefined()
    if (!branch) return
    const request = branch.request(fixture)
    const wrongResponse = await fetch(
      `${server.baseUrl}/api/v10/invites/${fixture.inviteCode}`,
      {
        method: 'DELETE',
        headers: { Authorization: fixture.token },
      }
    )
    const response = new Response(await wrongResponse.text(), {
      status: wrongResponse.status,
      headers: wrongResponse.headers,
    })
    Object.defineProperty(response, 'url', {
      value: `${server.baseUrl}${request.path}`,
    })

    await expect(
      branch.assert({
        baseUrl: server.baseUrl,
        fixture,
        response,
      })
    ).rejects.toThrow('follow-up HTTP resource is still present')
  })

  it('rejects the Partner SDK token assertion for an unrelated provisional token', async () => {
    const server = await createRealServer()
    close = server.close
    const fixture = createContractFixture(server.db)
    const entry = MANIFEST.find(
      ({ method, specPath }) =>
        method === 'post' && specPath === '/partner-sdk/token'
    )
    expect(entry).toBeDefined()
    const branch = entry?.successBranches[0]
    expect(branch).toBeDefined()
    if (!branch) return
    const request = branch.request(fixture)
    server.db
      .prepare(
        `INSERT INTO oauth2_access_tokens
           (token, client_id, user_id, scope, expires_at)
         VALUES (?, ?, ?, 'identify', datetime('now', '+1 hour'))`
      )
      .run('provisional_unrelated', fixture.applicationId, fixture.memberId)
    const response = Response.json(
      {
        access_token: 'provisional_unrelated',
        id_token: `provisional-id-${fixture.memberId}`,
      },
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
    Object.defineProperty(response, 'url', {
      value: `${server.baseUrl}${request.path}`,
    })

    await expect(
      branch.assert({
        baseUrl: server.baseUrl,
        fixture,
        response,
      })
    ).rejects.toThrow('did not apply its expected operation effect')
  })

  it('rejects every mutation assertion when its operation was skipped', async () => {
    const acceptedWithoutMutation: string[] = []
    for (const entry of MANIFEST) {
      if (entry.method === 'get') continue
      for (const branch of entry.successBranches) {
        const server = await createRealServer()
        try {
          const fixture = await entry.createFixture({
            create: () => Promise.resolve(createContractFixture(server.db)),
          })
          const request = branch.request(fixture)
          const response = new Response(
            branch.body === 'empty' ? null : JSON.stringify({}),
            {
              status: branch.status,
              headers: branch.contentType
                ? { 'Content-Type': branch.contentType }
                : undefined,
            }
          )
          Object.defineProperty(response, 'url', {
            value: `${server.baseUrl}${request.path}`,
          })

          try {
            await branch.assert({
              baseUrl: server.baseUrl,
              fixture,
              response,
            })
            acceptedWithoutMutation.push(
              `${entry.method.toUpperCase()} ${entry.specPath} ${branch.status}`
            )
          } catch {
            // Rejection is the required result when no state change occurred.
          }
        } finally {
          await server.close()
        }
      }
    }

    expect(acceptedWithoutMutation).toEqual([])
  }, 120_000)

  it('executes every declared success branch through the real server', async () => {
    for (const entry of MANIFEST) {
      for (const branch of entry.successBranches) {
        const server = await createRealServer()
        try {
          const fixture = await entry.createFixture({
            create: () => Promise.resolve(createContractFixture(server.db)),
          })
          const request = branch.request(fixture)
          const headers = new Headers(request.init?.headers)
          if (entry.authentication === 'bot') {
            headers.set('Authorization', fixture.token)
          } else if (entry.authentication === 'bearer') {
            headers.set('Authorization', `Bearer ${fixture.bearerToken}`)
          }
          const response = await fetch(`${server.baseUrl}${request.path}`, {
            ...request.init,
            headers,
          })
          const label = `${entry.method.toUpperCase()} ${entry.specPath} ${branch.status}`
          expect(response.status, label).toBe(branch.status)
          if (branch.contentType) {
            expect(response.headers.get('content-type'), label).toContain(
              branch.contentType
            )
          }
          const assertionResponse = response.clone()
          await assertResponseBody(entry, branch, response, label)
          await branch.assert({
            baseUrl: server.baseUrl,
            fixture,
            response: assertionResponse,
          })
        } finally {
          await server.close()
        }
      }
    }
  }, 120_000)

  it('cleans resources when server startup fails', async () => {
    const uploadPath = await mkdtemp(path.join(tmpdir(), 'fauxcord-failure-'))
    let db: Database | undefined
    let server: Awaited<ReturnType<typeof createRealServer>> | undefined
    let error: unknown
    try {
      server = await createRealServer({
        uploadPath,
        onDatabaseCreated: (created) => {
          db = created
        },
        serve: () => {
          throw new Error('injected startup failure')
        },
      })
    } catch (error_) {
      error = error_
    } finally {
      await server?.close()
    }

    try {
      expect(error).toEqual(new Error('injected startup failure'))
      await expect(stat(uploadPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(() => db?.prepare('SELECT 1').get()).toThrow()
    } finally {
      await rm(uploadPath, { recursive: true, force: true })
    }
  })

  it('propagates an asynchronous startup error and cleans resources', async () => {
    const uploadPath = await mkdtemp(path.join(tmpdir(), 'fauxcord-async-'))
    const expected = new Error('injected async startup failure')
    let closeCalls = 0
    let db: Database | undefined
    // eslint-disable-next-line unicorn/prefer-event-target -- Node servers expose EventEmitter's `error` event contract.
    const fakeServer = new EventEmitter() as ReturnType<typeof serveWithGateway>
    Object.assign(fakeServer, {
      listening: false,
      close: (callback?: (error?: Error) => void) => {
        closeCalls += 1
        callback?.()
        return fakeServer
      },
    })
    fakeServer.on('error', () => undefined)

    try {
      const startup = createRealServer({
        uploadPath,
        onDatabaseCreated: (created) => {
          db = created
        },
        serve: () => {
          queueMicrotask(() => fakeServer.emit('error', expected))
          return fakeServer
        },
      })
      const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error('startup did not reject'))
        }, 100)
      })

      await expect(Promise.race([startup, timeout])).rejects.toThrow(
        expected.message
      )
      expect(closeCalls).toBe(1)
      await expect(stat(uploadPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(() => db?.prepare('SELECT 1').get()).toThrow()
    } finally {
      await rm(uploadPath, { recursive: true, force: true })
    }
  })
})
