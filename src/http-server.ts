/**
 * `@hono/node-server` の `serve()` を Gateway (WebSocket) 対応のまま安全に
 * ラップするヘルパー。
 */

import { serve } from '@hono/node-server'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import type { Hono } from 'hono'
import type { WebSocketServer } from 'ws'

/** {@link serveWithGateway} に渡すオプション */
export interface ServeWithGatewayOptions {
  /** Hono アプリの fetch ハンドラ */
  fetch: Hono['fetch']
  /** リッスンポート */
  port: number
  /** バインドするホスト名 */
  hostname: string
  /** Gateway (WebSocket) 用の `ws` サーバーインスタンス */
  wss: WebSocketServer
}

/** `Connection`/`Upgrade` ネゴシエーションに関するヘッダー名（大文字小文字を区別しない） */
const UPGRADE_RELATED_HEADER_NAMES = new Set([
  'upgrade',
  'connection',
  'http2-settings',
])

/**
 * `serve()` に `websocket` オプションを渡すと `@hono/node-server` が
 * `http.Server` へ独自の `upgrade` リスナーを登録するが、そのリスナーは
 * `Upgrade: websocket` 以外のリクエストを黙って無視する（何もせず return
 * する）。Node の `http.Server` は `upgrade` リスナーが 1 つでも登録されると、
 * 他の `Upgrade` ヘッダーを持つリクエストに対しても `request` イベントを
 * 一切発火しなくなるため、Java の `HttpClient` がデフォルトで送る
 * `Upgrade: h2c`（HTTP/2 平文アップグレードの機会主義的プローブ）のような
 * リクエストは、応答もクローズもされないまま永久にハングしてしまう。
 *
 * このラッパーは `@hono/node-server` 自身の `upgrade` リスナーの後に
 * フォールバック用のリスナーを追加する。素朴に既存の `req`（`IncomingMessage`）を
 * 通常のリクエストハンドラへそのまま渡す方法は成立しない ―― `upgrade` イベントが
 * 発火した時点で Node の HTTP パーサーは既に `req` から切り離されており、
 * リクエストボディがそれ以上 `req` へ流れ込むことはないため（例えば JSON ボディを
 * 持つ POST がこの経路に落ちると、ボディが空のまま扱われてしまう）。代わりに、
 * アップグレード関連ヘッダーを取り除いた上でリクエストを生の HTTP バイト列として
 * 再構築し、同じソケットに対して `connection` イベントを再発火させることで、
 * Node 自身の HTTP パーサーに最初からパースし直させる（Content-Length /
 * チャンク転送などのボディ形式を正しく扱えるのは本物のパーサーだけなので）。
 * @param options - serve に渡すオプション
 * @param listeningListener - リッスン開始時に呼ばれるコールバック
 * @returns 起動した http.Server
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

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.headers.upgrade?.toLowerCase() === 'websocket') {
      return // @hono/node-server 自身のリスナーが処理する
    }

    const statusLine = `${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/${req.httpVersion}\r\n`
    const headerLines: string[] = []
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]
      if (UPGRADE_RELATED_HEADER_NAMES.has(name.toLowerCase())) {
        continue // 再パース後にまた upgrade 扱いされて無限ループしないよう除去する
      }
      headerLines.push(`${name}: ${req.rawHeaders[i + 1]}`)
    }
    const replayedHeader = Buffer.from(
      statusLine + headerLines.join('\r\n') + '\r\n\r\n',
      'latin1'
    )
    // パーサーが既に読み進めていた分（ヘッダー再構築分 + ボディの先頭分）を
    // ソケットの先頭へ戻し、新規接続として最初からパースさせる
    socket.unshift(Buffer.concat([replayedHeader, head]))
    server.emit('connection', socket)
  })

  return server
}
