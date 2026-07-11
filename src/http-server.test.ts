import { describe, it, expect, afterEach } from 'vitest'
import { createConnection } from 'node:net'
import { createTestGatewayServer } from './test-helpers'

describe('serveWithGateway', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('responds normally to a plain request carrying a non-websocket Upgrade header', async () => {
    // Some HTTP/1.1 clients (e.g. Java's HttpClient) opportunistically send
    // `Upgrade: h2c` on every request. Without the serveWithGateway fallback,
    // @hono/node-server's websocket-only `upgrade` listener silently ignores
    // such requests, and the connection hangs forever with no response.
    const server = await createTestGatewayServer()
    close = server.close
    const { port } = new URL(server.url.replace('ws://', 'http://'))

    const raw = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: Number(port) })
      let data = ''
      const timeout = setTimeout(() => {
        socket.destroy()
        reject(new Error('timed out waiting for a response'))
      }, 5000)
      socket.on('connect', () => {
        socket.write(
          'GET /_mock/health HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${port}\r\n` +
            'Connection: Upgrade, HTTP2-Settings\r\n' +
            'Upgrade: h2c\r\n' +
            'HTTP2-Settings: AAMAAABkAAQCAAAAAAIAAAAA\r\n' +
            '\r\n'
        )
      })
      socket.on('data', (chunk) => {
        data += chunk.toString()
        clearTimeout(timeout)
        socket.destroy()
        resolve(data)
      })
      socket.on('close', () => {
        clearTimeout(timeout)
        resolve(data)
      })
      socket.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })

    expect(raw).toContain('HTTP/1.1 200')
    expect(raw).not.toContain('101 Switching Protocols')
  })

  it('preserves the request body on a POST carrying a non-websocket Upgrade header', async () => {
    // Regression check for the bug this wrapper actually fixes: naively handing
    // the original `req` to a fresh request handler loses the body, because
    // Node's HTTP parser stops feeding `req` once the 'upgrade' event fires.
    const server = await createTestGatewayServer()
    close = server.close
    const { port } = new URL(server.url.replace('ws://', 'http://'))

    const body = JSON.stringify({ token: 'Bot upgrade-body-test' })
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: Number(port) })
      let data = ''
      const timeout = setTimeout(() => {
        socket.destroy()
        reject(new Error('timed out waiting for a response'))
      }, 5000)
      socket.on('connect', () => {
        socket.write(
          'POST /_test/setup HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${port}\r\n` +
            'Content-Type: application/json\r\n' +
            `Content-Length: ${Buffer.byteLength(body)}\r\n` +
            'Connection: Upgrade, HTTP2-Settings\r\n' +
            'Upgrade: h2c\r\n' +
            'HTTP2-Settings: AAMAAABkAAQCAAAAAAIAAAAA\r\n' +
            '\r\n' +
            body
        )
      })
      socket.on('data', (chunk) => {
        data += chunk.toString()
        clearTimeout(timeout)
        socket.destroy()
        resolve(data)
      })
      socket.on('close', () => {
        clearTimeout(timeout)
        resolve(data)
      })
      socket.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })

    // A JSON-parse failure on an empty body would surface as a 500, not 400/201.
    expect(raw).not.toContain('HTTP/1.1 500')
    expect(raw).toMatch(/HTTP\/1\.1 (201|400)/)
  })
})
