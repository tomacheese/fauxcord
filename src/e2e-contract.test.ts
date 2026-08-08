import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Database } from './db'
import { MANIFEST } from '../spec/manifest'
import { createContractFixture, createRealServer } from './test-helpers'

describe('real HTTP contract fixture', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('starts the production app assembly on an OS-assigned port', async () => {
    const server = await createRealServer()
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

  it('rejects a destructive assertion when the declared mutation did not happen', async () => {
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
    const response = await fetch(`${server.baseUrl}${request.path}`, {
      headers: { Authorization: fixture.token },
    })

    await expect(
      branch.assert({
        baseUrl: server.baseUrl,
        fixture,
        response,
      })
    ).rejects.toThrow('did not remove its target resource')
  })

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
          if (branch.body === 'empty') {
            await expect(response.text(), label).resolves.toBe('')
          } else if (branch.body === 'json') {
            await expect(response.json(), label).resolves.toBeDefined()
          } else {
            const body = await response.arrayBuffer()
            expect(body.byteLength, label).toBeGreaterThan(0)
          }
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
})
