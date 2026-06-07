import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createGuildRoutes } from "./guilds.js";
import { initializeDatabase, closeDatabase } from "../db.js";
import { seedBot, seedGuild } from "../test-helpers.js";
import type { Database } from "../db.js";

describe("Guilds API", () => {
  let db: Database;
  let app: Hono;
  let guildId: string;
  let token: string;

  /**
   * テスト用のRoleをDBに登録します。
   * @param roleId - Role ID
   * @param name - Role名
   */
  function seedRole(roleId: string, name = "Test Role"): string {
    db.prepare(
      "INSERT INTO roles (id, guild_id, name, position) VALUES (?, ?, ?, 1)",
    ).run(roleId, guildId, name);
    return roleId;
  }

  /**
   * テスト用のGuildメンバーをDBに登録します。
   * @param userId - ユーザーID
   * @param nick - ニックネーム
   */
  function seedMember(userId: string, nick: string | null = null): string {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, username) VALUES (?, 'TestUser')",
    ).run(userId);
    db.prepare(
      "INSERT INTO guild_members (guild_id, user_id, nick) VALUES (?, ?, ?)",
    ).run(guildId, userId, nick);
    return userId;
  }

  beforeEach(() => {
    db = initializeDatabase(":memory:");
    app = new Hono();
    app.route("/", createGuildRoutes(db));

    token = seedBot(db);
    guildId = seedGuild(db, token);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe("PATCH /guilds/:guildId", () => {
    it("Guild名を更新できること", async () => {
      const res = await app.request(`/guilds/${guildId}`, {
        method: "PATCH",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Updated Guild" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(guildId);
      expect(body.name).toBe("Updated Guild");
    });

    it("nameを省略した場合は変更されないこと", async () => {
      const res = await app.request(`/guilds/${guildId}`, {
        method: "PATCH",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("Test Guild");
    });

    it("存在しないGuildは404を返すこと", async () => {
      const res = await app.request("/guilds/999999999999999999", {
        method: "PATCH",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "X" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10004);
    });
  });

  describe("DELETE /guilds/:guildId", () => {
    it("Guildを削除できること", async () => {
      const res = await app.request(`/guilds/${guildId}`, {
        method: "DELETE",
        headers: { Authorization: token },
      });
      expect(res.status).toBe(204);

      // 削除後は取得できないこと
      const getRes = await app.request(`/guilds/${guildId}`, {
        headers: { Authorization: token },
      });
      expect(getRes.status).toBe(404);
    });

    it("存在しないGuildは404を返すこと", async () => {
      const res = await app.request("/guilds/999999999999999999", {
        method: "DELETE",
        headers: { Authorization: token },
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10004);
    });
  });

  describe("PATCH /guilds/:guildId/roles/:roleId", () => {
    it("ロールを更新できること", async () => {
      const roleId = seedRole("444444444444444444");
      const res = await app.request(`/guilds/${guildId}/roles/${roleId}`, {
        method: "PATCH",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Updated Role",
          color: 0xff0000,
          hoist: true,
          mentionable: true,
          permissions: "8",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(roleId);
      expect(body.name).toBe("Updated Role");
      expect(body.color).toBe(0xff0000);
      expect(body.hoist).toBe(true);
      expect(body.mentionable).toBe(true);
      expect(body.permissions).toBe("8");
    });

    it("一部のフィールドのみ更新できること", async () => {
      const roleId = seedRole("444444444444444444", "Original");
      const res = await app.request(`/guilds/${guildId}/roles/${roleId}`, {
        method: "PATCH",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ color: 123 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("Original");
      expect(body.color).toBe(123);
    });

    it("存在しないGuildは404 (10004) を返すこと", async () => {
      const res = await app.request(
        "/guilds/999999999999999999/roles/444444444444444444",
        {
          method: "PATCH",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "X" }),
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10004);
    });

    it("存在しないRoleは404 (10011) を返すこと", async () => {
      const res = await app.request(
        `/guilds/${guildId}/roles/999999999999999999`,
        {
          method: "PATCH",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "X" }),
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10011);
    });
  });

  describe("DELETE /guilds/:guildId/roles/:roleId", () => {
    it("ロールを削除できること", async () => {
      const roleId = seedRole("444444444444444444");
      const res = await app.request(`/guilds/${guildId}/roles/${roleId}`, {
        method: "DELETE",
        headers: { Authorization: token },
      });
      expect(res.status).toBe(204);

      // 削除後はロール一覧に含まれないこと
      const listRes = await app.request(`/guilds/${guildId}/roles`, {
        headers: { Authorization: token },
      });
      const roles = (await listRes.json()) as { id: string }[];
      expect(roles.some((r) => r.id === roleId)).toBe(false);
    });

    it("存在しないRoleは404 (10011) を返すこと", async () => {
      const res = await app.request(
        `/guilds/${guildId}/roles/999999999999999999`,
        {
          method: "DELETE",
          headers: { Authorization: token },
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10011);
    });

    it("@everyoneロール (id == guild_id) は削除できず400を返すこと", async () => {
      // @everyone ロールは id が guild_id と同一
      seedRole(guildId, "@everyone");
      const res = await app.request(`/guilds/${guildId}/roles/${guildId}`, {
        method: "DELETE",
        headers: { Authorization: token },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /guilds/:guildId/members/:userId", () => {
    it("ニックネームを更新できること", async () => {
      const userId = seedMember("555555555555555555");
      const res = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nick: "NewNick" }),
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nick).toBe("NewNick");
      expect(body.user.id).toBe(userId);
    });

    it("nick: null でニックネームをクリアできること", async () => {
      const userId = seedMember("555555555555555555", "OldNick");
      const res = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nick: null }),
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nick).toBeNull();
    });

    it("ロールを設定できること", async () => {
      const userId = seedMember("555555555555555555");
      const roleId = seedRole("444444444444444444");
      const res = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roles: [roleId] }),
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.roles).toEqual([roleId]);
    });

    it("存在しないロールを指定した場合は404 (10011) を返すこと", async () => {
      const userId = seedMember("555555555555555555");
      const res = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roles: ["999999999999999999"] }),
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10011);
    });

    it("存在しないメンバーは404 (10007) を返すこと", async () => {
      const res = await app.request(
        `/guilds/${guildId}/members/999999999999999999`,
        {
          method: "PATCH",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nick: "X" }),
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10007);
    });
  });

  describe("DELETE /guilds/:guildId/members/:userId", () => {
    it("メンバーをキックできること", async () => {
      const userId = seedMember("555555555555555555");
      const res = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        {
          method: "DELETE",
          headers: { Authorization: token },
        },
      );
      expect(res.status).toBe(204);

      // キック後は取得できないこと
      const getRes = await app.request(
        `/guilds/${guildId}/members/${userId}`,
        { headers: { Authorization: token } },
      );
      expect(getRes.status).toBe(404);
    });

    it("存在しないメンバーは404 (10007) を返すこと", async () => {
      const res = await app.request(
        `/guilds/${guildId}/members/999999999999999999`,
        {
          method: "DELETE",
          headers: { Authorization: token },
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(10007);
    });
  });
});
