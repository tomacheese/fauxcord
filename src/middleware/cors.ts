/**
 * CORSミドルウェア
 *
 * 全リクエストに対してCORSヘッダーを付与します。
 * Discordボットのテスト環境からの任意のオリジンを許可します。
 */

import { cors } from "hono/cors";

/**
 * CORS設定ミドルウェアを返します。
 * 任意のオリジンからのアクセスを許可します。
 */
export const corsMiddleware = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: [
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
    "X-RateLimit-Reset-After",
    "X-RateLimit-Bucket",
    "X-RateLimit-Scope",
  ],
});
