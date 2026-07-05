import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { createTestGatewayServer } from './test-helpers'

describe('createTestGatewayServer', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('starts a real server that accepts a WebSocket connection', async () => {
    const server = await createTestGatewayServer()
    close = server.close
    const ws = new WebSocket(server.url)
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        resolve()
      })
      ws.once('error', reject)
    })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})
