/**
 * Guilds API ルーティング
 *
 * /guilds/* エンドポイントを実装します。
 */

import { Hono } from "hono";
import type { Database } from "../db.js";
import { DiscordErrorCode, discordError, validationError } from "../errors.js";
import { generateSnowflake } from "../snowflake.js";
import {
  getGuild,
  updateGuild,
  deleteGuild,
  getGuildRoles,
  createRole,
  getRole,
  updateRole,
  deleteRole,
  getGuildMember,
  getGuildMembers,
  updateGuildMember,
  removeGuildMember,
} from "../services/guilds.js";
import { getGuildChannels } from "../services/channels.js";
import { getGuildWebhooks } from "../services/webhooks.js";
import { validateChannelCreate } from "../validators/guild.js";
import { validationError as createValidationError } from "../errors.js";
import { GUILD_LIMITS } from "../validators/guild.js";

/**
 * Guilds APIルートを作成します。
 * @param db - データベース
 * @returns Honoルーターインスタンス
 */
export function createGuildRoutes(db: Database): Hono {
  const app = new Hono();

  // GET /guilds/:guildId
  app.get("/guilds/:guildId", (c) => {
    const { guildId } = c.req.param();
    const withCounts = c.req.query("with_counts") === "true";

    const guild = getGuild(db, guildId, withCounts);
    if (!guild) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        "Unknown Guild",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(guild);
  });

  // PATCH /guilds/:guildId
  app.patch("/guilds/:guildId", async (c) => {
    const { guildId } = c.req.param();
    const payload = await c.req.json<{ name?: string }>();

    const updated = updateGuild(db, guildId, { name: payload.name });
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        "Unknown Guild",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(updated);
  });

  // DELETE /guilds/:guildId
  app.delete("/guilds/:guildId", (c) => {
    const { guildId } = c.req.param();

    const deleted = deleteGuild(db, guildId);
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        "Unknown Guild",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.body(null, 204);
  });

  // GET /guilds/:guildId/channels
  app.get("/guilds/:guildId/channels", (c) => {
    const { guildId } = c.req.param();

    const guild = getGuild(db, guildId);
    if (!guild) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        "Unknown Guild",
        404,
      );
      return c.json(err.body, 404);
    }

    const channels = getGuildChannels(db, guildId);
    return c.json(channels);
  });

  // POST /guilds/:guildId/channels
  app.post("/guilds/:guildId/channels", async (c) => {
    const { guildId } = c.req.param();

    const guild = getGuild(db, guildId);
    if (!guild) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        "Unknown Guild",
        404,
      );
      return c.json(err.body, 404);
    }

    // チャンネル数上限チェック
    const channels = getGuildChannels(db, guildId);
    if (channels.length >= GUILD_LIMITS.CHANNELS_MAX) {
      const err = discordError(
        DiscordErrorCode.MAX_CHANNELS_REACHED,
        "Maximum number of guild channels reached (500)",
        400,
      );
      return c.json(err.body, 400);
    }

    const payload = await c.req.json<{
      name: string;
      type?: number;
      topic?: string | null;
      nsfw?: boolean;
      parent_id?: string | null;
      position?: number | null;
    }>();

    // バリデーション
    const errors = validateChannelCreate(payload);
    if (Object.keys(errors).length > 0) {
      return c.json(createValidationError(errors).body, 400);
    }

    const channelId = generateSnowflake();
    const position = payload.position ?? channels.length;

    db.prepare(
      `INSERT INTO channels (id, guild_id, name, type, topic, nsfw, position, parent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      channelId,
      guildId,
      payload.name,
      payload.type ?? 0,
      payload.topic ?? null,
      payload.nsfw ? 1 : 0,
      position,
      payload.parent_id ?? null,
    );

    const newChannel = db
      .prepare("SELECT * FROM channels WHERE id = ?")
      .get(channelId) as {
      id: string;
      guild_id: string | null;
      type: number;
      name: string | null;
      topic: string | null;
      nsfw: number;
      position: number;
      rate_limit_per_user: number;
      parent_id: string | null;
      last_message_id: string | null;
    };

    return c.json(
      {
        id: newChannel.id,
        type: newChannel.type,
        guild_id: newChannel.guild_id,
        position: newChannel.position,
        name: newChannel.name,
        topic: newChannel.topic,
        nsfw: newChannel.nsfw === 1,
        last_message_id: newChannel.last_message_id,
        rate_limit_per_user: newChannel.rate_limit_per_user,
        parent_id: newChannel.parent_id,
        permission_overwrites: [],
      },
      201,
    );
  });

  // GET /guilds/:guildId/members
  app.get("/guilds/:guildId/members", (c) => {
    const { guildId } = c.req.param();
    const limit = parseInt(c.req.query("limit") ?? "1", 10);
    const after = c.req.query("after") ?? "0";

    const members = getGuildMembers(db, guildId, limit, after);
    return c.json(members);
  });

  // GET /guilds/:guildId/members/:userId
  app.get("/guilds/:guildId/members/:userId", (c) => {
    const { guildId, userId } = c.req.param();

    const member = getGuildMember(db, guildId, userId);
    if (!member) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MEMBER,
        "Unknown Member",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(member);
  });

  // GET /guilds/:guildId/roles
  app.get("/guilds/:guildId/roles", (c) => {
    const { guildId } = c.req.param();
    const roles = getGuildRoles(db, guildId);
    return c.json(roles);
  });

  // POST /guilds/:guildId/roles
  app.post("/guilds/:guildId/roles", async (c) => {
    const { guildId } = c.req.param();

    const guild = getGuild(db, guildId);
    if (!guild) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        "Unknown Guild",
        404,
      );
      return c.json(err.body, 404);
    }

    // ロール数上限チェック
    const roles = getGuildRoles(db, guildId);
    if (roles.length >= GUILD_LIMITS.ROLES_MAX) {
      const err = discordError(
        DiscordErrorCode.MAX_ROLES_REACHED,
        "Maximum number of guild roles reached (250)",
        400,
      );
      return c.json(err.body, 400);
    }

    const payload = await c.req.json<{
      name?: string;
      permissions?: string;
      color?: number;
      hoist?: boolean;
      mentionable?: boolean;
    }>();

    const roleId = generateSnowflake();
    const role = createRole(db, {
      roleId,
      guildId,
      ...payload,
    });

    return c.json(role);
  });

  // PATCH /guilds/:guildId/roles/:roleId
  app.patch("/guilds/:guildId/roles/:roleId", async (c) => {
    const { guildId, roleId } = c.req.param();

    const guild = getGuild(db, guildId);
    if (!guild) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_GUILD,
        "Unknown Guild",
        404,
      );
      return c.json(err.body, 404);
    }

    const payload = await c.req.json<{
      name?: string;
      color?: number;
      hoist?: boolean;
      mentionable?: boolean;
      permissions?: string;
    }>();

    const updated = updateRole(db, guildId, roleId, payload);
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_ROLE,
        "Unknown Role",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(updated);
  });

  // DELETE /guilds/:guildId/roles/:roleId
  app.delete("/guilds/:guildId/roles/:roleId", (c) => {
    const { guildId, roleId } = c.req.param();

    // @everyoneロール（id == guild_id）は削除不可
    if (roleId === guildId) {
      const err = discordError(
        DiscordErrorCode.INVALID_ROLE,
        "Invalid role",
        400,
      );
      return c.json(err.body, 400);
    }

    const deleted = deleteRole(db, guildId, roleId);
    if (!deleted) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_ROLE,
        "Unknown Role",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.body(null, 204);
  });

  // PATCH /guilds/:guildId/members/:userId
  app.patch("/guilds/:guildId/members/:userId", async (c) => {
    const { guildId, userId } = c.req.param();

    const payload = await c.req.json<{
      nick?: string | null;
      roles?: string[];
    }>();

    // 指定されたロールがすべてGuildに存在するか検証する
    if (payload.roles !== undefined) {
      for (const roleId of payload.roles) {
        if (!getRole(db, guildId, roleId)) {
          const err = discordError(
            DiscordErrorCode.UNKNOWN_ROLE,
            "Unknown Role",
            404,
          );
          return c.json(err.body, 404);
        }
      }
    }

    const updated = updateGuildMember(db, guildId, userId, payload);
    if (!updated) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MEMBER,
        "Unknown Member",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.json(updated);
  });

  // DELETE /guilds/:guildId/members/:userId
  app.delete("/guilds/:guildId/members/:userId", (c) => {
    const { guildId, userId } = c.req.param();

    const removed = removeGuildMember(db, guildId, userId);
    if (!removed) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_MEMBER,
        "Unknown Member",
        404,
      );
      return c.json(err.body, 404);
    }
    return c.body(null, 204);
  });

  // GET /guilds/:guildId/webhooks
  app.get("/guilds/:guildId/webhooks", (c) => {
    const { guildId } = c.req.param();
    const webhooks = getGuildWebhooks(db, guildId);
    return c.json(webhooks);
  });

  return app;
}
