/**
 * Helper that safely wraps `@hono/node-server`'s `serve()` while keeping
 * Gateway (WebSocket) support intact.
 */

import { serve } from '@hono/node-server'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import type { Hono } from 'hono'
import type { WebSocketServer } from 'ws'

/** Options passed to {@link serveWithGateway} */
export interface ServeWithGatewayOptions {
  /** The Hono app's fetch handler */
  fetch: Hono['fetch']
  /** The port to listen on */
  port: number
  /** The hostname to bind to */
  hostname: string
  /** The `ws` server instance for the Gateway (WebSocket) */
  wss: WebSocketServer
}

/** Header names related to `Connection`/`Upgrade` negotiation (case-insensitive) */
const UPGRADE_RELATED_HEADER_NAMES = new Set([
  'upgrade',
  'connection',
  'http2-settings',
])

/**
 * When the `websocket` option is passed to `serve()`, `@hono/node-server`
 * registers its own `upgrade` listener on the `http.Server`, but that listener
 * silently ignores (returns without doing anything for) any request other than
 * `Upgrade: websocket`. Once even a single `upgrade` listener is registered on
 * Node's `http.Server`, it stops firing the `request` event entirely for any
 * request carrying an `Upgrade` header. As a result, requests such as the
 * `Upgrade: h2c` (an opportunistic probe for a cleartext HTTP/2 upgrade) that
 * Java's `HttpClient` sends by default hang forever, never getting a response
 * or being closed.
 *
 * This wrapper adds a fallback listener after `@hono/node-server`'s own
 * `upgrade` listener. Naively handing the existing `req` (`IncomingMessage`)
 * straight to the normal request handler does not work — by the time the
 * `upgrade` event fires, Node's HTTP parser has already been detached from
 * `req`, so no more request body flows into `req` (e.g. a POST with a JSON body
 * that falls into this path would be treated as having an empty body). Instead,
 * we strip the upgrade-related headers, reconstruct the request as raw HTTP
 * bytes, and re-emit the `connection` event on the same socket so that Node's
 * own HTTP parser parses it again from scratch (only the real parser can
 * correctly handle body encodings such as Content-Length / chunked transfer).
 * @param options - the options to pass to serve
 * @param listeningListener - callback invoked when listening starts
 * @returns the started http.Server
 */
export function serveWithGateway(
  options: ServeWithGatewayOptions,
  listeningListener?: (info: AddressInfo) => void
): ReturnType<typeof serve> {
  const server = serve(
    {
      fetch: options.fetch,
      port: options.port,
      hostname: options.hostname,
      websocket: { server: options.wss },
    },
    listeningListener
  )

  server.on(
    'upgrade',
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (request.headers.upgrade?.toLowerCase() === 'websocket') {
        return // @hono/node-server's own listener handles this
      }

      const statusLine = `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}\r\n`
      const headerLines: string[] = []
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]
        if (UPGRADE_RELATED_HEADER_NAMES.has(name.toLowerCase())) {
          continue // Strip these so re-parsing is not treated as an upgrade again, avoiding an infinite loop
        }
        headerLines.push(`${name}: ${request.rawHeaders[index + 1]}`)
      }
      const replayedHeader = Buffer.from(
        statusLine + headerLines.join('\r\n') + '\r\n\r\n',
        'latin1'
      )
      // Unshift what the parser had already consumed (the reconstructed headers
      // plus the leading part of the body) back to the front of the socket, so it
      // is parsed from scratch as a new connection
      socket.unshift(Buffer.concat([replayedHeader, head]))
      server.emit('connection', socket)
    }
  )

  return server
}
