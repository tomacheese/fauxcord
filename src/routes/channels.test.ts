import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createChannelRoutes } from "./channels.js";
import { initializeDatabase, closeDatabase } from "../db.js";
import { seedBot, seedGuild, seedChannel } from "../test-helpers.js";
import type { Database } from "../db.js";

const BASE_URL = "http://localhost:3000";

describe("Channels API", () => {
  let db: Database;
  let app: Hono;
  let channelId: string;
  let token: string;

  beforeEach(() => {
    db = initializeDatabase(":memory:");
    app = new Hono();
    app.route("/", createChannelRoutes(db, BASE_URL));

    token = seedBot(db);
    const guildId = seedGuild(db, token);
    channelId = seedChannel(db, guildId);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe("GET /channels/:channelId", () => {
    it("チャンネルを取得できること", async () => {
      const res = await app.request(`/channels/${channelId}`, {
        headers: { Authorization: token },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(channelId);
      expect(body.name).toBe("general");
    });

    it("存在しないチャンネルは404を返すこと", async () => {
      const res = await app.request("/channels/999999999999999999", {
        headers: { Authorization: token },
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10003);
    });
  });

  describe("PATCH /channels/:channelId", () => {
    it("チャンネル名を更新できること", async () => {
      const res = await app.request(`/channels/${channelId}`, {
        method: "PATCH",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "updated-channel" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("updated-channel");
    });
  });

  describe("POST /channels/:channelId/messages", () => {
    it("メッセージを送信できること", async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Hello, World!" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.content).toBe("Hello, World!");
      expect(body.channel_id).toBe(channelId);
    });

    it("空メッセージは400を返すこと", async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe(50006);
    });

    it("2001文字以上のcontentは400を返すこと", async () => {
      const res = await app.request(`/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "a".repeat(2001) }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe(50035);
    });
  });

  describe("GET /channels/:channelId/messages", () => {
    it("メッセージ一覧を取得できること", async () => {
      // メッセージ投稿
      await app.request(`/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Test message" }),
      });

      const res = await app.request(`/channels/${channelId}/messages`, {
        headers: { Authorization: token },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it("limitパラメータが機能すること", async () => {
      // 5件投稿
      for (let i = 0; i < 5; i++) {
        await app.request(`/channels/${channelId}/messages`, {
          method: "POST",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: `Message ${i}` }),
        });
      }

      const res = await app.request(
        `/channels/${channelId}/messages?limit=3`,
        { headers: { Authorization: token } },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBe(3);
    });
  });

  describe("DELETE /channels/:channelId/messages/:messageId", () => {
    it("メッセージを削除できること", async () => {
      // 投稿
      const postRes = await app.request(`/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "To delete" }),
      });
      const { id: messageId } = await postRes.json();

      const deleteRes = await app.request(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: "DELETE",
          headers: { Authorization: token },
        },
      );
      expect(deleteRes.status).toBe(204);
    });
  });

  describe("DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/:userId", () => {
    it("特定ユーザーのリアクションを削除できること", async () => {
      // メッセージ投稿
      const postRes = await app.request(`/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "React to me" }),
      });
      const { id: messageId } = await postRes.json();

      // 別ユーザーのリアクションをDBに直接登録
      const reactingUserId = "777777777777777777";
      db.prepare(
        "INSERT INTO users (id, username) VALUES (?, 'Reactor')",
      ).run(reactingUserId);
      db.prepare(
        "INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)",
      ).run(messageId, reactingUserId, "👍");

      const emoji = encodeURIComponent("👍");
      const res = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}/${reactingUserId}`,
        {
          method: "DELETE",
          headers: { Authorization: token },
        },
      );
      expect(res.status).toBe(204);

      // 削除後はリアクションユーザー一覧に含まれないこと
      const listRes = await app.request(
        `/channels/${channelId}/messages/${messageId}/reactions/${emoji}`,
        { headers: { Authorization: token } },
      );
      const users = (await listRes.json()) as { id: string }[];
      expect(users.some((u) => u.id === reactingUserId)).toBe(false);
    });
  });

  describe("GET /channels/:channelId/pins", () => {
    it("ピン留めメッセージ一覧を取得できること", async () => {
      const res = await app.request(`/channels/${channelId}/pins`, {
        headers: { Authorization: token },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });
});
