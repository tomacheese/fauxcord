/**
 * テスト制御 API ルーティング
 *
 * /_test/* テスト専用エンドポイントを実装します。
 */

import { Hono } from "hono";
import type { Database } from "../db.js";
import {
  setupTestEnvironment,
  deleteTestSetup,
  resetTestData,
  getTestMessages,
} from "../services/test-control.js";
import { getChannelWebhooks } from "../services/webhooks.js";

/**
 * テスト制御 APIルートを作成します。
 * @param db - データベース
 * @returns Honoルーターインスタンス
 */
export function createTestRoutes(db: Database): Hono {
  const app = new Hono();

  // POST /_test/setup
  app.post("/_test/setup", async (c) => {
    const payload = await c.req.json<{
      token: string;
      user?: {
        id?: string;
        username?: string;
        discriminator?: string;
      };
      guilds?: {
        id?: string;
        name: string;
        channels?: { id?: string; name: string; type?: number }[];
      }[];
    }>();

    try {
      const result = setupTestEnvironment(db, payload);
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof Error && err.message === "CONFLICT") {
        return c.json({ message: "409: Conflict", code: 0 }, 409);
      }
      throw err;
    }
  });

  // DELETE /_test/setup/:token（:tokenはBot xxx形式）
  app.delete("/_test/setup/*", (c) => {
    // パスパラメータを手動でデコード（Botトークンにスペースが含まれる可能性があるため）
    const token = decodeURIComponent(c.req.path.replace("/_test/setup/", ""));
    const deleted = deleteTestSetup(db, token);
    if (!deleted) {
      return c.json({ message: "404: Not Found", code: 0 }, 404);
    }
    return c.body(null, 204);
  });

  // POST /_test/reset
  app.post("/_test/reset", async (c) => {
    let token: string | undefined;
    try {
      const body = await c.req.json<{ token?: string }>();
      token = body.token;
    } catch {
      // ボディなしの場合は全リセット
    }

    resetTestData(db, token);
    return c.body(null, 204);
  });

  // GET /_test/messages/:channelId
  app.get("/_test/messages/:channelId", (c) => {
    const { channelId } = c.req.param();
    const messages = getTestMessages(db, channelId);
    return c.json({ messages });
  });

  // GET /_test/webhooks/:channelId
  app.get("/_test/webhooks/:channelId", (c) => {
    const { channelId } = c.req.param();
    const webhooks = getChannelWebhooks(db, channelId);
    return c.json(webhooks);
  });

  return app;
}
