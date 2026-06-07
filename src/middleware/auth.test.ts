import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createAuthMiddleware } from "./auth.js";
import { initializeDatabase, closeDatabase } from "../db.js";
import { seedBot } from "../test-helpers.js";
import type { Database } from "../db.js";

describe("createAuthMiddleware", () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = initializeDatabase(":memory:");
    app = new Hono();
    app.use("*", createAuthMiddleware(db, false));
    app.get("/test", (c) => c.json({ ok: true }));
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it("有効なBotトークンで認証成功すること", async () => {
    seedBot(db, "Bot validtoken");
    const res = await app.request("/test", {
      headers: { Authorization: "Bot validtoken" },
    });
    expect(res.status).toBe(200);
  });

  it("未登録のトークンは401を返すこと", async () => {
    const res = await app.request("/test", {
      headers: { Authorization: "Bot unknowntoken" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe(0);
  });

  it("Authorizationヘッダーなしは401を返すこと", async () => {
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("DISABLE_AUTH=trueの場合、未知のトークンも許可すること", async () => {
    const appNoAuth = new Hono();
    appNoAuth.use("*", createAuthMiddleware(db, true));
    appNoAuth.get("/test", (c) => c.json({ ok: true }));

    const res = await appNoAuth.request("/test", {
      headers: { Authorization: "Bot anytoken" },
    });
    expect(res.status).toBe(200);
  });

  it("認証不要パスは認証をスキップすること", async () => {
    app.get("/_mock/health", (c) => c.json({ status: "ok" }));
    // /_mock/healthはAuth不要なのでDBにトークンがなくてもOK
    const appWithAuth = new Hono();
    appWithAuth.get("/_mock/health", (c) => c.json({ status: "ok" }));
    appWithAuth.use("*", createAuthMiddleware(db, false));
    appWithAuth.get("/protected", (c) => c.json({ protected: true }));

    const healthRes = await appWithAuth.request("/_mock/health");
    expect(healthRes.status).toBe(200);
  });
});
