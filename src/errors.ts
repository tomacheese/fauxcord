/**
 * Discord APIエラーコード定数とエラー生成ヘルパー
 *
 * Discord API v10と完全互換のエラーコードを定義します。
 */

/**
 * Discordエラーコード定数
 */
export const DiscordErrorCode = {
  // 10xxx — リソース不明
  UNKNOWN_CHANNEL: 10003,
  UNKNOWN_GUILD: 10004,
  UNKNOWN_MEMBER: 10007,
  UNKNOWN_MESSAGE: 10008,
  UNKNOWN_ROLE: 10011,
  UNKNOWN_TOKEN: 10012,
  UNKNOWN_USER: 10013,
  UNKNOWN_WEBHOOK: 10015,
  // 30xxx — 上限超過
  MAX_PINS_REACHED: 30003,
  MAX_ROLES_REACHED: 30005,
  MAX_WEBHOOKS_REACHED: 30007,
  MAX_CHANNELS_REACHED: 30013,
  MAX_ATTACHMENTS: 30015,
  // 40xxx — その他エラー
  UNAUTHORIZED: 40001,
  REQUEST_TOO_LARGE: 40005,
  ALREADY_PINNED: 40041,
  // 50xxx — 操作不可
  MISSING_ACCESS: 50001,
  CANNOT_EDIT_OTHER: 50005,
  EMPTY_MESSAGE: 50006,
  MISSING_PERMISSIONS: 50013,
  INVALID_BULK_DELETE: 50016,
  WRONG_PIN_CHANNEL: 50019,
  INVALID_ROLE: 50028,
  MESSAGE_TOO_OLD: 50034,
  INVALID_FORM_BODY: 50035,
  INVALID_API_VERSION: 50041,
  FILE_TOO_LARGE: 50045,
} as const;

/** エラーレスポンスの型 */
export interface DiscordErrorResponse {
  body: {
    message: string;
    code: number;
    errors?: Record<string, unknown>;
  };
  status: number;
}

/**
 * Discord互換エラーレスポンスを生成します。
 * @param code - Discordエラーコード
 * @param message - エラーメッセージ
 * @param status - HTTPステータスコード
 * @returns エラーレスポンスオブジェクト
 */
export function discordError(
  code: number,
  message: string,
  status: number,
): DiscordErrorResponse {
  return {
    body: { message, code },
    status,
  };
}

/**
 * バリデーションエラー (50035) レスポンスを生成します。
 * @param errors - フィールドごとのエラー詳細
 * @returns バリデーションエラーレスポンスオブジェクト
 */
export function validationError(
  errors: Record<string, unknown>,
): DiscordErrorResponse {
  return {
    body: {
      message: "Invalid Form Body",
      code: DiscordErrorCode.INVALID_FORM_BODY,
      errors,
    },
    status: 400,
  };
}

/**
 * エラーレスポンスからHono用のレスポンスを返すためのヘルパー型
 */
export const ERROR_MESSAGES = {
  [DiscordErrorCode.UNKNOWN_CHANNEL]: "Unknown Channel",
  [DiscordErrorCode.UNKNOWN_GUILD]: "Unknown Guild",
  [DiscordErrorCode.UNKNOWN_MEMBER]: "Unknown Member",
  [DiscordErrorCode.UNKNOWN_MESSAGE]: "Unknown Message",
  [DiscordErrorCode.UNKNOWN_ROLE]: "Unknown Role",
  [DiscordErrorCode.UNKNOWN_TOKEN]: "Unknown Token",
  [DiscordErrorCode.UNKNOWN_USER]: "Unknown User",
  [DiscordErrorCode.UNKNOWN_WEBHOOK]: "Unknown Webhook",
  [DiscordErrorCode.MAX_PINS_REACHED]:
    "Maximum number of pins reached for the channel (50)",
  [DiscordErrorCode.MAX_ROLES_REACHED]:
    "Maximum number of guild roles reached (250)",
  [DiscordErrorCode.MAX_WEBHOOKS_REACHED]:
    "Maximum number of webhooks reached (15)",
  [DiscordErrorCode.MAX_CHANNELS_REACHED]:
    "Maximum number of guild channels reached (500)",
  [DiscordErrorCode.MAX_ATTACHMENTS]:
    "Maximum number of attachments in a message reached (10)",
  [DiscordErrorCode.UNAUTHORIZED]: "Unauthorized",
  [DiscordErrorCode.REQUEST_TOO_LARGE]: "Request entity too large",
  [DiscordErrorCode.ALREADY_PINNED]: "This message was already pinned",
  [DiscordErrorCode.MISSING_ACCESS]: "Missing Access",
  [DiscordErrorCode.CANNOT_EDIT_OTHER]:
    "Cannot edit a message authored by another user",
  [DiscordErrorCode.EMPTY_MESSAGE]: "Cannot send an empty message",
  [DiscordErrorCode.MISSING_PERMISSIONS]:
    "You lack permissions to perform that action",
  [DiscordErrorCode.INVALID_BULK_DELETE]:
    "Provided too many messages to delete",
  [DiscordErrorCode.WRONG_PIN_CHANNEL]:
    "A message can only be pinned to the channel it was sent in",
  [DiscordErrorCode.INVALID_ROLE]: "Invalid role",
  [DiscordErrorCode.MESSAGE_TOO_OLD]:
    "A message provided was too old to bulk delete",
  [DiscordErrorCode.INVALID_FORM_BODY]: "Invalid Form Body",
  [DiscordErrorCode.INVALID_API_VERSION]: "Invalid API version provided",
  [DiscordErrorCode.FILE_TOO_LARGE]:
    "File uploaded exceeds the maximum size",
} as const;
