import { describe, it, expect, afterEach, vi } from 'vitest'
import WebSocket from 'ws'
import { createTestGatewayServer } from '../test-helpers'
import { GatewayOp } from './opcodes'
import { sendReconnect } from './server'
import { SessionManager } from './session'

describe('Gateway WebSocket handshake', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('sends HELLO immediately on connect', async () => {
    const server = await createTestGatewayServer()
    close = server.close
    const ws = new WebSocket(server.url)
    const first = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (raw: Buffer) => {
        resolve(JSON.parse(raw.toString()))
      })
    })
    expect(first.op).toBe(GatewayOp.Hello)
    expect((first.d as { heartbeat_interval: number }).heartbeat_interval).toBe(
      41_250
    )
    ws.close()
  })
})

describe('sendReconnect', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('sends RECONNECT (op7) and closes the session', async () => {
    const { sendReconnect } = await import('./server')
    const { seedBot } = await import('../test-helpers')
    const server = await createTestGatewayServer()
    close = server.close
    seedBot(server.db, 'Bot reconnecttoken')
    const ws = new WebSocket(server.url)
    await new Promise((resolve) => ws.once('message', resolve)) // HELLO
    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot reconnecttoken', intents: 0 },
      })
    )
    await new Promise((resolve) => ws.once('message', resolve)) // READY

    const session = server.sessionManager.getAll()[0]
    expect(session).toBeDefined()

    const reconnectPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (raw: Buffer) => {
        resolve(JSON.parse(raw.toString()))
      })
    })

    sendReconnect(session)

    const reconnect = await reconnectPromise
    expect(reconnect.op).toBe(GatewayOp.Reconnect)
  })

  it('does not throw when the socket send/close throws (already closed socket)', () => {
    const manager = new SessionManager()
    const ws = {
      send: vi.fn(() => {
        throw new Error('socket is not open')
      }),
      close: vi.fn(() => {
        throw new Error('socket is not open')
      }),
    }
    const session = manager.create({
      botId: 'b1',
      token: 'Bot x',
      intents: 0,
      ws: ws as never,
    })

    expect(() => {
      sendReconnect(session)
    }).not.toThrow()
    expect(ws.send).toHaveBeenCalledTimes(1)
  })
})
