/**
 * メッセージ操作サービス
 *
 * メッセージのCRUD操作・リアクション・ピン留め機能を提供します。
 */

import type { Database } from "../db.js";
import { snowflakeToTimestamp } from "../snowflake.js";

/** DBから取得したメッセージレコードの型 */
interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  author_token: string | null;
  content: string;
  tts: number;
  mention_everyone: number;
  pinned: number;
  type: number;
  flags: number;
  referenced_message_id: string | null;
  created_at: string;
  edited_at: string | null;
}

/** DBから取得したユーザーレコードの型 */
interface UserRow {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  bot: number;
}

/** DBから取得したembedレコードの型 */
interface EmbedRow {
  id: number;
  message_id: string;
  data: string;
  position: number;
}

/** DBから取得したattachmentレコードの型 */
interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  size: number;
  content_type: string;
  file_path: string;
}

/** DBから取得したリアクション集計レコードの型 */
interface ReactionAggRow {
  emoji: string;
  count: number;
}

/** リアクションオブジェクト */
export interface ReactionObject {
  /** リアクション数 */
  count: number;
  /** リクエスト元ユーザーがリアクション済みかどうか（モックでは常に false） */
  me: boolean;
  /** 絵文字情報 */
  emoji: {
    /** カスタム絵文字のID（標準絵文字の場合はnull） */
    id: string | null;
    /** 絵文字文字列（Unicode 絵文字またはカスタム絵文字名） */
    name: string;
  };
}

/** APIレスポンス用メッセージオブジェクト */
export interface MessageObject {
  id: string;
  channel_id: string;
  author: {
    id: string;
    username: string;
    discriminator: string;
    bot: boolean;
    avatar: string | null;
  };
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: never[];
  mention_roles: never[];
  attachments: AttachmentObject[];
  embeds: unknown[];
  /** リアクション一覧（リアクションがない場合はフィールド自体が省略される） */
  reactions?: ReactionObject[];
  pinned: boolean;
  type: number;
  flags: number;
  message_reference?: { message_id: string };
  /** Webhook経由で送信されたメッセージの場合のWebhook ID */
  webhook_id?: string;
}

/** APIレスポンス用添付ファイルオブジェクト */
export interface AttachmentObject {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  content_type: string;
}

/**
 * DBのメッセージレコードをAPIレスポンス形式に変換します。
 * @param row - メッセージDBレコード
 * @param author - 作成者ユーザーレコード
 * @param embeds - Embedレコードの配列
 * @param attachments - 添付ファイルレコードの配列
 * @param reactions - リアクション集計レコードの配列
 * @param baseUrl - ベースURL（添付ファイルURLの生成用）
 * @returns APIレスポンス用オブジェクト
 */
export function toMessageObject(
  row: MessageRow,
  author: UserRow,
  embeds: EmbedRow[],
  attachments: AttachmentRow[],
  reactions: ReactionAggRow[],
  baseUrl: string,
): MessageObject {
  const obj: MessageObject = {
    id: row.id,
    channel_id: row.channel_id,
    author: {
      id: author.id,
      username: author.username,
      discriminator: author.discriminator,
      bot: author.bot === 1,
      avatar: author.avatar,
    },
    content: row.content,
    timestamp: new Date(row.created_at).toISOString(),
    edited_timestamp: row.edited_at ? new Date(row.edited_at).toISOString() : null,
    tts: row.tts === 1,
    mention_everyone: row.mention_everyone === 1,
    mentions: [],
    mention_roles: [],
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      url: `${baseUrl}/_mock/attachments/${row.channel_id}/${row.id}/${a.filename}`,
      proxy_url: `${baseUrl}/_mock/attachments/${row.channel_id}/${row.id}/${a.filename}`,
      content_type: a.content_type,
    })),
    embeds: embeds
      .sort((a, b) => a.position - b.position)
      .map((e) => JSON.parse(e.data) as unknown),
    pinned: row.pinned === 1,
    type: row.type,
    flags: row.flags,
  };

  if (row.referenced_message_id) {
    obj.message_reference = { message_id: row.referenced_message_id };
  }

  // Webhook経由のメッセージにはwebhook_idを付与する（author_id = Webhook ID）
  if (row.author_token === "webhook") {
    obj.webhook_id = row.author_id;
  }

  // リアクションがある場合のみ reactions フィールドを付与（Discord API 仕様に準拠）
  if (reactions.length > 0) {
    obj.reactions = reactions.map((r) => ({
      count: r.count,
      me: false, // モックでは常に false（リクエスト元ユーザーを特定しない）
      emoji: {
        id: null,   // 標準絵文字のため常に null
        name: r.emoji,
      },
    }));
  }

  return obj;
}

/**
 * メッセージをDBから取得してAPIレスポンス形式に変換します。
 * @param db - データベース
 * @param messageId - メッセージID
 * @param baseUrl - ベースURL
 * @returns メッセージオブジェクト（存在しない場合null）
 */
export function getMessage(
  db: Database,
  messageId: string,
  baseUrl: string,
): MessageObject | null {
  const row = db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(messageId) as MessageRow | undefined;
  if (!row) return null;

  const author = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(row.author_id) as UserRow | undefined;
  if (!author) return null;

  const embeds = db
    .prepare("SELECT * FROM embeds WHERE message_id = ? ORDER BY position")
    .all(messageId) as EmbedRow[];

  const attachments = db
    .prepare("SELECT * FROM attachments WHERE message_id = ?")
    .all(messageId) as AttachmentRow[];

  const reactions = db
    .prepare(
      "SELECT emoji, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY emoji",
    )
    .all(messageId) as ReactionAggRow[];

  return toMessageObject(row, author, embeds, attachments, reactions, baseUrl);
}

/** メッセージ一覧取得のクエリパラメータ */
export interface MessageListParams {
  limit?: number;
  before?: string;
  after?: string;
  around?: string;
}

/**
 * チャンネルのメッセージ一覧を取得します。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @param params - ページネーションパラメータ
 * @param baseUrl - ベースURL
 * @returns メッセージオブジェクトの配列（新しい順）
 */
export function getMessages(
  db: Database,
  channelId: string,
  params: MessageListParams,
  baseUrl: string,
): MessageObject[] {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);

  let query: string;
  let queryParams: unknown[];

  if (params.before) {
    query =
      "SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?";
    queryParams = [channelId, params.before, limit];
  } else if (params.after) {
    query =
      "SELECT * FROM messages WHERE channel_id = ? AND id > ? ORDER BY id ASC LIMIT ?";
    queryParams = [channelId, params.after, limit];
  } else if (params.around) {
    const half = Math.floor(limit / 2);
    // around より前のメッセージ（新しい順で half 件取得）
    const beforeRows = db
      .prepare(
        "SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
      )
      .all(channelId, params.around, half) as MessageRow[];
    // around を含む以降のメッセージ（古い順で (limit - half) 件取得）
    const afterRows = db
      .prepare(
        "SELECT * FROM messages WHERE channel_id = ? AND id >= ? ORDER BY id ASC LIMIT ?",
      )
      .all(channelId, params.around, limit - half) as MessageRow[];
    // beforeRows は降順（新しい順）、afterRows は昇順（古い順）で取得しているため、
    // afterRows を reverse して降順に揃え、afterRows → beforeRows の順で結合して
    // 全体を新しい順（降順）にする
    const rows = [...afterRows.reverse(), ...beforeRows];

    return rows
      .map((r) => {
        const author = db
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(r.author_id) as UserRow | undefined;
        if (!author) return null;
        const embeds = db
          .prepare("SELECT * FROM embeds WHERE message_id = ? ORDER BY position")
          .all(r.id) as EmbedRow[];
        const attachments = db
          .prepare("SELECT * FROM attachments WHERE message_id = ?")
          .all(r.id) as AttachmentRow[];
        const rxns = db
          .prepare(
            "SELECT emoji, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY emoji",
          )
          .all(r.id) as ReactionAggRow[];
        return toMessageObject(r, author, embeds, attachments, rxns, baseUrl);
      })
      .filter((m): m is MessageObject => m !== null);
  } else {
    query =
      "SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?";
    queryParams = [channelId, limit];
  }

  const rows = db.prepare(query).all(...queryParams) as MessageRow[];

  // after は古い順（ASC）で取得しているため reverse して新しい順にする。
  // before・指定なしは降順（DESC）で取得済みのためそのまま返す
  const orderedRows = params.after ? rows.reverse() : rows;

  return orderedRows
    .map((r) => {
      const author = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(r.author_id) as UserRow | undefined;
      if (!author) return null;
      const embeds = db
        .prepare("SELECT * FROM embeds WHERE message_id = ? ORDER BY position")
        .all(r.id) as EmbedRow[];
      const attachments = db
        .prepare("SELECT * FROM attachments WHERE message_id = ?")
        .all(r.id) as AttachmentRow[];
      const rxns = db
        .prepare(
          "SELECT emoji, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY emoji",
        )
        .all(r.id) as ReactionAggRow[];
      return toMessageObject(r, author, embeds, attachments, rxns, baseUrl);
    })
    .filter((m): m is MessageObject => m !== null);
}

/** メッセージ作成パラメータ */
export interface MessageCreateParams {
  channelId: string;
  authorId: string;
  authorToken: string;
  messageId: string;
  content?: string;
  tts?: boolean;
  embeds?: unknown[];
  messageReference?: { message_id?: string };
  flags?: number;
}

/**
 * メッセージを作成します。
 * @param db - データベース
 * @param params - メッセージ作成パラメータ
 * @param baseUrl - ベースURL
 * @returns 作成したメッセージオブジェクト
 */
export function createMessage(
  db: Database,
  params: MessageCreateParams,
  baseUrl: string,
): MessageObject {
  db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, author_token, content, tts, flags, referenced_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.messageId,
    params.channelId,
    params.authorId,
    params.authorToken,
    params.content ?? "",
    params.tts ? 1 : 0,
    params.flags ?? 0,
    params.messageReference?.message_id ?? null,
  );

  // Embedを保存
  if (params.embeds) {
    for (let i = 0; i < params.embeds.length; i++) {
      db.prepare(
        "INSERT INTO embeds (message_id, data, position) VALUES (?, ?, ?)",
      ).run(params.messageId, JSON.stringify(params.embeds[i]), i);
    }
  }

  // チャンネルのlast_message_idを更新
  db.prepare("UPDATE channels SET last_message_id = ? WHERE id = ?").run(
    params.messageId,
    params.channelId,
  );

  const msg = getMessage(db, params.messageId, baseUrl);
  if (!msg) throw new Error("Failed to create message");
  return msg;
}

/**
 * メッセージを更新します。
 * @param db - データベース
 * @param messageId - メッセージID
 * @param payload - 更新内容
 * @param baseUrl - ベースURL
 * @returns 更新後のメッセージオブジェクト
 */
export function updateMessage(
  db: Database,
  messageId: string,
  payload: { content?: string; embeds?: unknown[] | null },
  baseUrl: string,
): MessageObject | null {
  const row = db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(messageId) as MessageRow | undefined;
  if (!row) return null;

  if (payload.content !== undefined) {
    db.prepare(
      "UPDATE messages SET content = ?, edited_at = datetime('now') WHERE id = ?",
    ).run(payload.content, messageId);
  }

  // null は空配列と同等（embeds を全削除）。undefined は「変更なし」として無視する
  if (payload.embeds !== undefined) {
    db.prepare("DELETE FROM embeds WHERE message_id = ?").run(messageId);
    const embedsArray = Array.isArray(payload.embeds) ? payload.embeds : [];
    for (let i = 0; i < embedsArray.length; i++) {
      db.prepare(
        "INSERT INTO embeds (message_id, data, position) VALUES (?, ?, ?)",
      ).run(messageId, JSON.stringify(embedsArray[i]), i);
    }
  }

  return getMessage(db, messageId, baseUrl);
}

/**
 * メッセージを削除します。
 * @param db - データベース
 * @param messageId - メッセージID
 * @returns 削除成功ならtrue
 */
export function deleteMessage(db: Database, messageId: string): boolean {
  const result = db
    .prepare("DELETE FROM messages WHERE id = ?")
    .run(messageId);
  return result.changes > 0;
}

/** 2週間前のタイムスタンプ（ミリ秒） */
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * メッセージが2週間以上前かどうかを確認します。
 *
 * 実際の Discord API と同様に、メッセージの存在有無にかかわらず
 * Snowflake ID に埋め込まれたタイムスタンプから経過時間を判定します。
 * @param db - データベース
 * @param messageId - メッセージID
 * @returns 2週間以上前の場合true
 */
export function isTooOldForBulkDelete(
  db: Database,
  messageId: string,
): boolean {
  // Snowflake ID からタイムスタンプを復元して判定する（実Discordと同じ挙動）
  try {
    const createdAt = snowflakeToTimestamp(messageId).getTime();
    return Date.now() - createdAt > TWO_WEEKS_MS;
  } catch {
    // Snowflakeとして解釈できないIDはDBのcreated_atにフォールバック
    const row = db
      .prepare("SELECT created_at FROM messages WHERE id = ?")
      .get(messageId) as { created_at: string } | undefined;
    if (!row) return false;

    const createdAt = new Date(row.created_at).getTime();
    return Date.now() - createdAt > TWO_WEEKS_MS;
  }
}

/**
 * リアクションを追加します。
 * @param db - データベース
 * @param messageId - メッセージID
 * @param userId - ユーザーID
 * @param emoji - 絵文字
 * @returns 追加成功ならtrue
 */
export function addReaction(
  db: Database,
  messageId: string,
  userId: string,
  emoji: string,
): boolean {
  try {
    db.prepare(
      "INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)",
    ).run(messageId, userId, emoji);
    return true;
  } catch {
    return false;
  }
}

/**
 * リアクションを削除します（自分のリアクション）。
 * @param db - データベース
 * @param messageId - メッセージID
 * @param userId - ユーザーID
 * @param emoji - 絵文字
 */
export function removeReaction(
  db: Database,
  messageId: string,
  userId: string,
  emoji: string,
): void {
  db.prepare(
    "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
  ).run(messageId, userId, emoji);
}

/**
 * 指定絵文字の全リアクションを削除します。
 * @param db - データベース
 * @param messageId - メッセージID
 * @param emoji - 絵文字
 */
export function removeEmojiReactions(
  db: Database,
  messageId: string,
  emoji: string,
): void {
  db.prepare(
    "DELETE FROM reactions WHERE message_id = ? AND emoji = ?",
  ).run(messageId, emoji);
}

/**
 * メッセージの全リアクションを削除します。
 * @param db - データベース
 * @param messageId - メッセージID
 */
export function removeAllReactions(db: Database, messageId: string): void {
  db.prepare("DELETE FROM reactions WHERE message_id = ?").run(messageId);
}

/**
 * リアクションしたユーザー一覧を取得します。
 * @param db - データベース
 * @param messageId - メッセージID
 * @param emoji - 絵文字
 * @param limit - 取得件数（デフォルト25）
 * @param after - ページネーション
 * @returns ユーザーオブジェクトの配列
 */
export function getReactionUsers(
  db: Database,
  messageId: string,
  emoji: string,
  limit = 25,
  after?: string,
): UserRow[] {
  const clampedLimit = Math.min(limit, 100);
  if (after) {
    return db
      .prepare(
        `SELECT u.* FROM users u
         JOIN reactions r ON r.user_id = u.id
         WHERE r.message_id = ? AND r.emoji = ? AND u.id > ?
         ORDER BY u.id ASC LIMIT ?`,
      )
      .all(messageId, emoji, after, clampedLimit) as UserRow[];
  }
  return db
    .prepare(
      `SELECT u.* FROM users u
       JOIN reactions r ON r.user_id = u.id
       WHERE r.message_id = ? AND r.emoji = ?
       ORDER BY u.id ASC LIMIT ?`,
    )
    .all(messageId, emoji, clampedLimit) as UserRow[];
}

/**
 * ピン留めされたメッセージ一覧を取得します。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @param baseUrl - ベースURL
 * @returns メッセージオブジェクトの配列
 */
export function getPinnedMessages(
  db: Database,
  channelId: string,
  baseUrl: string,
): MessageObject[] {
  const rows = db
    .prepare(
      `SELECT m.* FROM messages m
       JOIN pins p ON p.message_id = m.id
       WHERE p.channel_id = ?
       ORDER BY p.pinned_at ASC`,
    )
    .all(channelId) as MessageRow[];

  return rows
    .map((r) => {
      const author = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(r.author_id) as UserRow | undefined;
      if (!author) return null;
      const embeds = db
        .prepare("SELECT * FROM embeds WHERE message_id = ? ORDER BY position")
        .all(r.id) as EmbedRow[];
      const attachments = db
        .prepare("SELECT * FROM attachments WHERE message_id = ?")
        .all(r.id) as AttachmentRow[];
      const rxns = db
        .prepare(
          "SELECT emoji, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY emoji",
        )
        .all(r.id) as ReactionAggRow[];
      return toMessageObject(r, author, embeds, attachments, rxns, baseUrl);
    })
    .filter((m): m is MessageObject => m !== null);
}

/**
 * メッセージをピン留めします。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @param messageId - メッセージID
 * @returns エラーコード（0=成功、10008=メッセージ不存在、40041=既にピン済み、30003=上限超過、50019=別チャンネル）
 */
export function pinMessage(
  db: Database,
  channelId: string,
  messageId: string,
): 0 | 10008 | 40041 | 30003 | 50019 {
  // メッセージが同じチャンネルにあるか確認
  const msg = db
    .prepare("SELECT channel_id FROM messages WHERE id = ?")
    .get(messageId) as { channel_id: string } | undefined;

  // 実Discordと同様に、存在しないメッセージは404 Unknown Messageを返す
  if (!msg) return 10008;
  if (msg.channel_id !== channelId) return 50019;

  // ピン済みチェック
  const existing = db
    .prepare("SELECT 1 FROM pins WHERE channel_id = ? AND message_id = ?")
    .get(channelId, messageId);
  if (existing) return 40041;

  // 上限チェック
  const count = (
    db
      .prepare("SELECT COUNT(*) as cnt FROM pins WHERE channel_id = ?")
      .get(channelId) as { cnt: number }
  ).cnt;
  if (count >= 50) return 30003;

  db.prepare(
    "INSERT INTO pins (channel_id, message_id) VALUES (?, ?)",
  ).run(channelId, messageId);
  db.prepare("UPDATE messages SET pinned = 1 WHERE id = ?").run(messageId);
  return 0;
}

/**
 * メッセージのピン留めを解除します。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @param messageId - メッセージID
 */
export function unpinMessage(
  db: Database,
  channelId: string,
  messageId: string,
): void {
  db.prepare(
    "DELETE FROM pins WHERE channel_id = ? AND message_id = ?",
  ).run(channelId, messageId);
  // 他のチャンネルでピン済みでなければpinned=0に
  const stillPinned = db
    .prepare("SELECT 1 FROM pins WHERE message_id = ?")
    .get(messageId);
  if (!stillPinned) {
    db.prepare("UPDATE messages SET pinned = 0 WHERE id = ?").run(messageId);
  }
}
