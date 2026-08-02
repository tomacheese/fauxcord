import { afterEach, describe, expect, it } from 'vitest'
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

    expect(
      new Set([
        fixture.messageId,
        fixture.deletableMessageId,
        fixture.webhookMessageId,
        fixture.deletableOriginalWebhookMessageId,
        fixture.deletableEntitlementId,
        fixture.deletableLobbyId,
      ]).size
    ).toBe(6)
  })
})
