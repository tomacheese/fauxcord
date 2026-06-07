/**
 * 統合テスト
 *
 * 実際のサーバー全体のエンドツーエンドテストを行います。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { initializeDatabase, closeDatabase } from "./db.js";
import { corsMiddleware } from "./middleware/cors.js";
import { versionMiddleware } from "./middleware/version.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { createChannelRoutes } from "./routes/channels.js";
import { createGuildRoutes } from "./routes/guilds.js";
import { createUserRoutes } from "./routes/users.js";
import { createWebhookRoutes } from "./routes/webhooks.js";
import { createTestRoutes } from "./routes/test.js";
import { createMockRoutes } from "./routes/mock.js";
import type { Database } from "./db.js";

const BASE_URL = "http://localhost:3000";
const TEST_TOKEN = "Bot integrationtest";
const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "100000000000000002";
const USER_ID = "100000000000000003";

/** テスト用サーバーを組み立てます */
function buildTestServer(db: Database): Hono {
  const app = new Hono();

  app.use("*", corsMiddleware);
  app.use("*", versionMiddleware);

  // 認証不要エンドポイント
  app.route("/", createMockRoutes(db, "/tmp/uploads-test"));
  app.route("/", createTestRoutes(db));

  // Webhook実行は認証不要なのでauthより前に登録
  app.route("/", createWebhookRoutes(db, BASE_URL));

  // 認証必須
  app.use("*", createAuthMiddleware(db, false));
  app.use("*", rateLimitMiddleware);

  const prefixes = ["/api/v10", "/api", ""];
  for (const prefix of prefixes) {
    app.route(prefix, createChannelRoutes(db, BASE_URL));
    app.route(prefix, createGuildRoutes(db));
    app.route(prefix, createUserRoutes(db));
  }

  app.onError((err, c) => {
    console.error(err);
    return c.json({ message: "500: Internal Server Error", code: 0 }, 500);
  });

  app.notFound((c) => {
    return c.json({ message: "404: Not Found", code: 0 }, 404);
  });

  return app;
}

describe("統合テスト", () => {
  let db: Database;
  let app: Hono;

  beforeAll(async () => {
    db = initializeDatabase(":memory:");
    app = buildTestServer(db);

    // テスト環境セットアップ
    await app.request("/_test/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: TEST_TOKEN,
        user: { id: USER_ID, username: "IntegrationBot" },
        guilds: [
          {
            id: GUILD_ID,
            name: "Integration Test Guild",
            channels: [{ id: CHANNEL_ID, name: "general", type: 0 }],
          },
        ],
      }),
    });
  });

  afterAll(() => {
    closeDatabase(db);
  });

  describe("ヘルスチェック", () => {
    it("GET /_mock/health は200を返すこと", async () => {
      const res = await app.request("/_mock/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.db).toBe("ok");
      expect(typeof body.uptime).toBe("number");
    });
  });

  describe("バージョンルーティング", () => {
    it("/api/v10/ プレフィックスで動作すること", async () => {
      const res = await app.request(`/api/v10/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(200);
    });

    it("/api/ プレフィックスで動作すること", async () => {
      const res = await app.request(`/api/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(200);
    });

    it("/ プレフィックスで動作すること", async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(200);
    });

    it("/api/v9/ は400を返すこと", async () => {
      const res = await app.request(`/api/v9/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe(50041);
    });
  });

  describe("認証", () => {
    it("有効なトークンで認証できること", async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(200);
    });

    it("無効なトークンは401を返すこと", async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: "Bot invalidtoken" },
      });
      expect(res.status).toBe(401);
    });

    it("認証ヘッダーなしは401を返すこと", async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`);
      expect(res.status).toBe(401);
    });
  });

  describe("Rate Limitヘッダー", () => {
    it("レスポンスにRate Limitヘッダーが含まれること", async () => {
      const res = await app.request(`/channels/${CHANNEL_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
      expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
      expect(res.headers.get("X-RateLimit-Bucket")).toBeTruthy();
      expect(res.headers.get("X-RateLimit-Scope")).toBe("user");
    });
  });

  describe("メッセージのライフサイクル", () => {
    it("メッセージの作成→取得→更新→削除ができること", async () => {
      // 作成
      const createRes = await app.request(`/channels/${CHANNEL_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: TEST_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Integration test message" }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();
      expect(created.content).toBe("Integration test message");
      const messageId = created.id;

      // 取得
      const getRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } },
      );
      expect(getRes.status).toBe(200);
      const got = await getRes.json();
      expect(got.id).toBe(messageId);

      // 更新
      const patchRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: TEST_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: "Updated content" }),
        },
      );
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.content).toBe("Updated content");
      expect(patched.edited_timestamp).not.toBeNull();

      // 削除
      const deleteRes = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        {
          method: "DELETE",
          headers: { Authorization: TEST_TOKEN },
        },
      );
      expect(deleteRes.status).toBe(204);

      // 削除後は404
      const get404 = await app.request(
        `/channels/${CHANNEL_ID}/messages/${messageId}`,
        { headers: { Authorization: TEST_TOKEN } },
      );
      expect(get404.status).toBe(404);
    });
  });

  describe("ピン留め", () => {
    it("メッセージをピン留め・解除できること", async () => {
      // メッセージ作成
      const createRes = await app.request(`/channels/${CHANNEL_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: TEST_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Pin test" }),
      });
      const { id: messageId } = await createRes.json();

      // ピン留め
      const pinRes = await app.request(
        `/channels/${CHANNEL_ID}/pins/${messageId}`,
        {
          method: "PUT",
          headers: { Authorization: TEST_TOKEN },
        },
      );
      expect(pinRes.status).toBe(204);

      // ピン済みリスト
      const pinsRes = await app.request(`/channels/${CHANNEL_ID}/pins`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(pinsRes.status).toBe(200);
      const pins = await pinsRes.json();
      expect(pins.some((m: { id: string }) => m.id === messageId)).toBe(true);

      // 解除
      const unpinRes = await app.request(
        `/channels/${CHANNEL_ID}/pins/${messageId}`,
        {
          method: "DELETE",
          headers: { Authorization: TEST_TOKEN },
        },
      );
      expect(unpinRes.status).toBe(204);
    });
  });

  describe("Guilds API", () => {
    it("Guild情報を取得できること", async () => {
      const res = await app.request(`/guilds/${GUILD_ID}`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(GUILD_ID);
      expect(body.name).toBe("Integration Test Guild");
    });

    it("Guildのチャンネル一覧を取得できること", async () => {
      const res = await app.request(`/guilds/${GUILD_ID}/channels`, {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((c: { id: string }) => c.id === CHANNEL_ID)).toBe(true);
    });

    it("チャンネルを作成できること", async () => {
      const res = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: "POST",
        headers: {
          Authorization: TEST_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "new-channel", type: 0 }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("new-channel");
    });
  });

  describe("Users API", () => {
    it("GET /users/@me はBot情報を返すこと", async () => {
      const res = await app.request("/users/@me", {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(USER_ID);
      expect(body.bot).toBe(true);
    });

    it("GET /users/@me/guilds はGuild一覧を返すこと", async () => {
      const res = await app.request("/users/@me/guilds", {
        headers: { Authorization: TEST_TOKEN },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("Webhooks API", () => {
    it("Webhookを作成・実行できること", async () => {
      // Webhook作成
      const createRes = await app.request(`/channels/${CHANNEL_ID}/webhooks`, {
        method: "POST",
        headers: {
          Authorization: TEST_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "TestWebhook" }),
      });
      expect(createRes.status).toBe(200);
      const webhook = await createRes.json();
      expect(webhook.name).toBe("TestWebhook");

      // Webhook実行 (wait=true)
      const execRes = await app.request(
        `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Webhook message" }),
        },
      );
      expect(execRes.status).toBe(200);
      const msg = await execRes.json();
      expect(msg.content).toBe("Webhook message");
    });
  });

  describe("テスト制御 API", () => {
    it("POST /_test/reset (全体) でメッセージがリセットされること", async () => {
      // まず別チャンネルを使って独立したテストを行う
      // 新規チャンネルを作成
      const chRes = await app.request(`/guilds/${GUILD_ID}/channels`, {
        method: "POST",
        headers: {
          Authorization: TEST_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "reset-test-channel", type: 0 }),
      });
      const { id: resetChannelId } = await chRes.json();

      // メッセージを送信
      await app.request(`/channels/${resetChannelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: TEST_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Before reset" }),
      });

      // リセット（全体）
      const resetRes = await app.request("/_test/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(resetRes.status).toBe(204);

      // メッセージが消えていること
      const msgsRes = await app.request(
        `/_test/messages/${resetChannelId}`,
      );
      const body = await msgsRes.json();
      expect(body.messages.length).toBe(0);
    });
  });
});
