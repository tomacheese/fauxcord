import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { versionMiddleware } from "./version.js";

describe("versionMiddleware", () => {
  const app = new Hono();
  app.use("*", versionMiddleware);
  app.get("/api/v10/channels/:id", (c) => c.json({ ok: true }));
  app.get("/api/channels/:id", (c) => c.json({ ok: true }));

  it("v10パスは正常に処理されること", async () => {
    const res = await app.request("/api/v10/channels/123");
    expect(res.status).toBe(200);
  });

  it("バージョン未指定パスは正常に処理されること", async () => {
    const res = await app.request("/api/channels/123");
    expect(res.status).toBe(200);
  });

  it("v9パスは400を返すこと", async () => {
    const res = await app.request("/api/v9/channels/123");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(50041);
  });

  it("v6パスは400を返すこと", async () => {
    const res = await app.request("/api/v6/channels/123");
    expect(res.status).toBe(400);
  });
});
