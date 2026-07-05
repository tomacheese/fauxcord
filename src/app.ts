/**
 * Hono アプリの組み立てロジック
 *
 * ミドルウェア登録・ルート登録・Gateway WebSocket ハンドラのマウントを担う。
 * 本番起動（src/index.ts）とテスト起動（src/test-helpers.ts）の両方から
 * 共有される。
 */

import { Hono } from 'hono'
import { upgradeWebSocket } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import type { Database } from './db'
import { corsMiddleware } from './middleware/cors'
import { versionMiddleware } from './middleware/version'
import { createAuthMiddleware, type AppEnv } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { createLatencyMiddleware } from './middleware/latency'
import { createChannelRoutes } from './routes/channels'
import { createGuildRoutes } from './routes/guilds'
import { createUserRoutes } from './routes/users'
import { createGatewayRoutes } from './routes/gateway'
import { createWebhookRoutes } from './routes/webhooks'
import { createInviteRoutes } from './routes/invites'
import { createOAuth2Routes } from './routes/oauth2'
import { createTestRoutes } from './routes/test'
import { createMockRoutes } from './routes/mock'
import { createGatewayWebSocketHandler } from './gateway/server'
import type { SessionManager } from './gateway/session'

/** buildApp に渡す設定の必要最小サブセット */
export interface BuildAppConfig {
  /** 添付ファイル URL 生成等に使う baseUrl */
  baseUrl: string
  /** 添付ファイル保存先ディレクトリ */
  uploadPath?: string
  /** true の場合、任意のトークンを許可する */
  disableAuth: boolean
  /** 全レスポンスに付与する疑似レイテンシ (ms) */
  latencyMs?: number
}

/**
 * Hono アプリを組み立てる（起動処理は含まない）。
 * index.ts の本番起動と test-helpers.ts のテスト起動の両方から共有される。
 * @param db - データベース
 * @param config - baseUrl・uploadPath・disableAuth・latencyMs
 * @returns 組み立て済みアプリと、`serve()` の `websocket` オプションに渡す `WebSocketServer`、
 * および Gateway 配信に使う `SessionManager`
 */
export function buildApp(
  db: Database,
  config: BuildAppConfig
): { app: Hono<AppEnv>; wss: WebSocketServer; sessionManager: SessionManager } {
  const app = new Hono<AppEnv>()
  // `noServer: true` が必須（`@hono/node-server` の `serve({ websocket: { server: wss } })`
  // が upgrade イベントのハンドリングを引き受けるため）
  const wss = new WebSocketServer({ noServer: true })

  // Configure middleware (applied to all requests)
  app.use('*', corsMiddleware)
  app.use('*', versionMiddleware)

  // Infrastructure APIs require no authentication (registered first)
  app.route('/', createMockRoutes(db, config.uploadPath ?? '/data/uploads'))

  // Test control APIs require no authentication
  app.route('/', createTestRoutes(db))

  // OAuth2 is partially exempt from authentication (its endpoints validate
  // their own Bearer/client-credential auth internally), so it is mounted
  // before the auth middleware below — but, like every other route group, it
  // must still be reachable under all three version prefixes, not just the
  // bare path. Real clients (discord.js, Oceanic.js, etc.) always call
  // through the versioned base URL (e.g. `/api/v10/oauth2/token`).
  for (const oauth2Prefix of ['/api/v10', '/api', '']) {
    app.route(oauth2Prefix, createOAuth2Routes(db))
  }

  // Gateway WebSocket は "/" にマウントする（実 Discord の Gateway URL 構造に合わせ、
  // パス自体には意味を持たせずクエリパラメータで v=10&encoding=json を受け取る）。
  // 認証は WebSocket 接続確立後の IDENTIFY メッセージ内で行う（Discord 本家と同様）ため、
  // HTTP レベルの Bot トークン認証ミドルウェアより前にマウントし、認証不要とする。
  const gatewayHandler = createGatewayWebSocketHandler(db, {
    baseUrl: config.baseUrl,
    disableAuth: config.disableAuth,
  })
  app.get(
    '/',
    upgradeWebSocket(() => gatewayHandler.upgrade)
  )

  // Routes below require authentication checks
  // Token-based webhook operations (/webhooks/{id}/{token}...) are exempted in auth.ts
  // CRUD operations requiring a Bot token go through authentication
  const authMiddleware = createAuthMiddleware(db, config.disableAuth)
  const latencyMiddleware = createLatencyMiddleware(config.latencyMs ?? 0)

  app.use('*', authMiddleware)
  app.use('*', latencyMiddleware)
  app.use('*', rateLimitMiddleware)

  // Normalize version prefixes and mount each route
  // /api/v10/ → /
  // /api/ → /
  // / → as-is
  const routePrefix = ['/api/v10', '/api', '']

  for (const prefix of routePrefix) {
    app.route(
      prefix,
      createChannelRoutes(db, config.baseUrl, config.uploadPath)
    )
    app.route(prefix, createGuildRoutes(db))
    app.route(prefix, createUserRoutes(db))
    app.route(prefix, createGatewayRoutes(db, config.baseUrl))
    // Webhook routes are also enabled for all prefixes (to support /api/v10/webhooks/...)
    app.route(prefix, createWebhookRoutes(db, config.baseUrl))
    app.route(prefix, createInviteRoutes(db))
  }

  // Global error handler
  app.onError((err, c) => {
    console.error(err)
    return c.json({ message: '500: Internal Server Error', code: 0 }, 500)
  })

  app.notFound((c) => {
    return c.json({ message: '404: Not Found', code: 0 }, 404)
  })

  return { app, wss, sessionManager: gatewayHandler.sessionManager }
}
