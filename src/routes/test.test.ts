import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createTestRoutes } from "./test.js";
import { initializeDatabase, closeDatabase } from "../db.js";
import type { Database } from "../db.js";

describe("Test Control API", () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = initializeDatabase(":memory:");
    app = new Hono();
    app.route("/", createTestRoutes(db));
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe("POST /_test/setup", () => {
    it("テスト環境をセットアップできること", async () => {
      const res = await app.request("/_test/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "Bot testtoken",
          user: { id: "111111111111111111", username: "TestBot" },
          guilds: [
            {
              id: "222222222222222222",
              name: "Test Guild",
              channels: [
                { id: "333333333333333333", name: "general", type: 0 },
              ],
            },
          ],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.token).toBe("Bot testtoken");
      expect(body.user.id).toBe("111111111111111111");
      expect(body.guilds[0].channels[0].id).toBe("333333333333333333");
    });

    it("IDを省略した場合は自動採番されること", async () => {
      const res = await app.request("/_test/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "Bot autotoken",
          guilds: [
            {
              name: "Auto Guild",
              channels: [{ name: "auto-channel", type: 0 }],
            },
          ],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.guilds[0].id).toBeTruthy();
      expect(body.guilds[0].channels[0].id).toBeTruthy();
    });

    it("重複トークンは409を返すこと", async () => {
      const setupBody = JSON.stringify({
        token: "Bot duplicatetoken",
        guilds: [],
      });

      await app.request("/_test/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: setupBody,
      });

      const res = await app.request("/_test/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: setupBody,
      });
      expect(res.status).toBe(409);
    });
  });

  describe("POST /_test/reset", () => {
    it("全データをリセットできること", async () => {
      const res = await app.request("/_test/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(204);
    });
  });

  describe("GET /_test/messages/:channelId", () => {
    it("チャンネルのメッセージを取得できること", async () => {
      const res = await app.request("/_test/messages/333333333333333333");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("messages");
      expect(Array.isArray(body.messages)).toBe(true);
    });
  });
});
