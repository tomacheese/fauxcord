/**
 * Discord Mock Server エントリーポイント
 *
 * Hono アプリを起動して Discord REST API v10 のモックサーバーを提供します。
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./db.js";
import { corsMiddleware } from "./middleware/cors.js";
import { versionMiddleware } from "./middleware/version.js";
import { createAuthMiddleware, type AppEnv } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { createLatencyMiddleware } from "./middleware/latency.js";
import { createChannelRoutes } from "./routes/channels.js";
import { createGuildRoutes } from "./routes/guilds.js";
import { createUserRoutes } from "./routes/users.js";
import { createWebhookRoutes } from "./routes/webhooks.js";
import { createOAuth2Routes } from "./routes/oauth2.js";
import { createTestRoutes } from "./routes/test.js";
import { createMockRoutes } from "./routes/mock.js";
import { readFile } from "node:fs/promises";
import { setupTestEnvironment } from "./services/test-control.js";

const config = loadConfig();

// データベース初期化
const db = initializeDatabase(config.dbPath);

// Hono アプリ作成
const app = new Hono<AppEnv>();

// ミドルウェア設定（全リクエストに適用）
app.use("*", corsMiddleware);
app.use("*", versionMiddleware);

// インフラAPIは認証不要（先に登録）
app.route("/", createMockRoutes(db, config.uploadPath));

// テスト制御APIは認証不要
app.route("/", createTestRoutes(db));

// OAuth2は一部認証不要
app.route("/", createOAuth2Routes(db));

// 以下は認証チェックあり
// Webhookのトークンベース操作（/webhooks/{id}/{token}...）は auth.ts で免除済み
// Bot トークンが必要な CRUD は認証が通る
const authMiddleware = createAuthMiddleware(db, config.disableAuth);
const latencyMiddleware = createLatencyMiddleware(config.latencyMs);

app.use("*", authMiddleware);
app.use("*", latencyMiddleware);
app.use("*", rateLimitMiddleware);

// バージョンプレフィックスを正規化して各ルートにマウント
// /api/v10/ → /
// /api/ → /
// / → そのまま
const routePrefix = ["/api/v10", "/api", ""];

for (const prefix of routePrefix) {
  app.route(prefix, createChannelRoutes(db, config.baseUrl));
  app.route(prefix, createGuildRoutes(db));
  app.route(prefix, createUserRoutes(db));
  // Webhook ルートも全プレフィックスで有効化（/api/v10/webhooks/... に対応）
  app.route(prefix, createWebhookRoutes(db, config.baseUrl));
}

// グローバルエラーハンドラ
app.onError((err, c) => {
  console.error(err);
  return c.json({ message: "500: Internal Server Error", code: 0 }, 500);
});

app.notFound((c) => {
  return c.json({ message: "404: Not Found", code: 0 }, 404);
});

// SEED_FILE の読み込み
if (config.seedFile) {
  try {
    const seedData = JSON.parse(await readFile(config.seedFile, "utf-8")) as {
      bots: Array<{
        token: string;
        user?: { id?: string; username?: string };
        guilds?: Array<{
          id?: string;
          name: string;
          channels?: Array<{ id?: string; name: string; type?: number }>;
        }>;
      }>;
    };

    for (const bot of seedData.bots) {
      try {
        setupTestEnvironment(db, bot);
        console.info(`Seeded bot: ${bot.token}`);
      } catch (err) {
        if (err instanceof Error && err.message === "CONFLICT") {
          console.info(`Bot already exists: ${bot.token}, skipping`);
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    console.error("Failed to load seed file:", err);
  }
}

// サーバー起動
const port = config.port;
const hostname = config.host;

console.info(`Discord Mock Server starting on ${hostname}:${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname,
});

export { app };
