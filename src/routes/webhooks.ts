/**
 * Webhooks API ルーティング
 *
 * /webhooks/* エンドポイントを実装します。
 */

import { Hono } from "hono";
import type { Database } from "../db.js";
import { DiscordErrorCode, discordError, validationError } from "../errors.js";
import { generateSnowflake } from "../snowflake.js";
import {
  getWebhook,
  getWebhookByToken,
  updateWebhook,
  deleteWebhook,
  executeWebhook,
} from "../services/webhooks.js";
import { getMessage, updateMessage, deleteMessage } from "../services/messages.js";
import { validateWebhookExecute } from "../validators/webhook.js";
import { isEmptyMessage } from "../validators/message.js";

/**
 * Webhooks APIルートを作成します。
 * @param db - データベース
 * @param baseUrl - ベースURL
 * @returns Honoルーターインスタンス
 */
export function createWebhookRoutes(db: Database, baseUrl: string): Hono {
  const app = new Hono();

  // GET /webhooks/:webhookId
  app.get("/webhooks/:webhookId", (c) => {
    const { webhookId } = c.req.param();
    const webhook = getWebhook(db, webhookId);
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(webhook);
  });

  // GET /webhooks/:webhookId/:token
  app.get("/webhooks/:webhookId/:token", (c) => {
    const { webhookId, token } = c.req.param();
    const webhook = getWebhookByToken(db, webhookId, token);
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }
    // tokenフィールドを除外して返す
    const { token: _t, ...webhookWithoutToken } = webhook;
    return c.json(webhookWithoutToken);
  });

  // PATCH /webhooks/:webhookId
  app.patch("/webhooks/:webhookId", async (c) => {
    const { webhookId } = c.req.param();
    const payload = await c.req.json<{
      name?: string;
      channel_id?: string;
    }>();

    const updated = updateWebhook(db, webhookId, payload);
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(updated);
  });

  // DELETE /webhooks/:webhookId
  app.delete("/webhooks/:webhookId", (c) => {
    const { webhookId } = c.req.param();
    const deleted = deleteWebhook(db, webhookId);
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.body(null, 204);
  });

  // PATCH /webhooks/:webhookId/:token
  app.patch("/webhooks/:webhookId/:token", async (c) => {
    const { webhookId, token } = c.req.param();

    const webhook = getWebhookByToken(db, webhookId, token);
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }

    const payload = await c.req.json<{
      name?: string;
      avatar?: string | null;
    }>();

    const updated = updateWebhook(db, webhookId, {
      name: payload.name,
      avatar: payload.avatar,
    });
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }

    // トークン付きエンドポイントではtokenフィールドを除外して返す
    const { token: _t, ...webhookWithoutToken } = updated;
    return c.json(webhookWithoutToken);
  });

  // DELETE /webhooks/:webhookId/:token
  app.delete("/webhooks/:webhookId/:token", (c) => {
    const { webhookId, token } = c.req.param();

    const webhook = getWebhookByToken(db, webhookId, token);
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }

    deleteWebhook(db, webhookId);
    return c.body(null, 204);
  });

  // POST /webhooks/:webhookId/:token（実行）
  app.post("/webhooks/:webhookId/:token", async (c) => {
    const { webhookId, token } = c.req.param();
    // discord.py は wait=True を ?wait=1 として送る。"true" と "1" 両方を真と解釈する
    const waitParam = c.req.query("wait") ?? "";
    const wait = waitParam === "true" || waitParam === "1";

    const webhook = getWebhookByToken(db, webhookId, token);
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }

    const contentType = c.req.header("content-type") ?? "";
    let payload: Record<string, unknown>;

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const payloadJson = formData.get("payload_json");
      payload = payloadJson
        ? (JSON.parse(payloadJson as string) as Record<string, unknown>)
        : {};
    } else {
      payload = await c.req.json<Record<string, unknown>>();
    }

    const hasAttachments = false; // Webhook実行でのファイル添付は簡略実装

    // 空メッセージチェック
    if (isEmptyMessage(payload, hasAttachments)) {
      const err = discordError(
        DiscordErrorCode.EMPTY_MESSAGE,
        "Cannot send an empty message",
        400,
      );
      return c.json(err.body, 400);
    }

    // バリデーション
    const errors = validateWebhookExecute(payload);
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400);
    }

    if (!wait) {
      // waitが false の場合は非同期実行（バックグラウンドでDB保存）
      const messageId = generateSnowflake();
      try {
        executeWebhook(
          db,
          {
            messageId,
            channelId: webhook.channel_id,
            webhookId: webhook.id,
            webhookName: webhook.name,
            content: payload.content as string | undefined,
            username: payload.username as string | undefined,
            tts: payload.tts as boolean | undefined,
            embeds: payload.embeds as unknown[] | undefined,
          },
          baseUrl,
        );
      } catch {
        // バックグラウンド実行のため無視
      }
      return c.body(null, 204);
    }

    const messageId = generateSnowflake();
    const msg = executeWebhook(
      db,
      {
        messageId,
        channelId: webhook.channel_id,
        webhookId: webhook.id,
        webhookName: webhook.name,
        content: payload.content as string | undefined,
        username: payload.username as string | undefined,
        tts: payload.tts as boolean | undefined,
        embeds: payload.embeds as unknown[] | undefined,
      },
      baseUrl,
    );

    return c.json(msg);
  });

  // GET /webhooks/:webhookId/:token/messages/:messageId
  app.get("/webhooks/:webhookId/:token/messages/:messageId", (c) => {
    const { webhookId, token, messageId } = c.req.param();

    const webhook = getWebhookByToken(db, webhookId, token);
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }

    const msg = getMessage(db, messageId, baseUrl);
    if (!msg) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        "Unknown Message",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(msg);
  });

  // PATCH /webhooks/:webhookId/:token/messages/:messageId
  app.patch("/webhooks/:webhookId/:token/messages/:messageId", async (c) => {
    const { webhookId, token, messageId } = c.req.param();

    const webhook = getWebhookByToken(db, webhookId, token);
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }

    const payload = await c.req.json<{
      content?: string;
      embeds?: unknown[];
    }>();

    const updated = updateMessage(db, messageId, payload, baseUrl);
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        "Unknown Message",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(updated);
  });

  // DELETE /webhooks/:webhookId/:token/messages/:messageId
  app.delete("/webhooks/:webhookId/:token/messages/:messageId", (c) => {
    const { webhookId, token, messageId } = c.req.param();

    const webhook = getWebhookByToken(db, webhookId, token);
    if (!webhook) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_WEBHOOK,
        "Unknown Webhook",
        404,
      );
      return c.json(err.body, 404);
    }

    const deleted = deleteMessage(db, messageId);
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MESSAGE,
        "Unknown Message",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.body(null, 204);
  });

  return app;
}
