/**
 * Discord API error code constants and error generation helpers
 *
 * Defines error codes fully compatible with Discord API v10.
 */

/**
 * Discord error code constants
 */
export const DiscordErrorCode = {
  // 10xxx — Unknown resource
  UNKNOWN_CHANNEL: 10_003,
  UNKNOWN_GUILD: 10_004,
  UNKNOWN_MEMBER: 10_007,
  UNKNOWN_MESSAGE: 10_008,
  UNKNOWN_INVITE: 10_006,
  UNKNOWN_ROLE: 10_011,
  UNKNOWN_TOKEN: 10_012,
  UNKNOWN_USER: 10_013,
  UNKNOWN_EMOJI: 10_014,
  UNKNOWN_WEBHOOK: 10_015,
  // 30xxx — Limit exceeded
  MAX_PINS_REACHED: 30_003,
  MAX_ROLES_REACHED: 30_005,
  MAX_WEBHOOKS_REACHED: 30_007,
  MAX_CHANNELS_REACHED: 30_013,
  MAX_ATTACHMENTS: 30_015,
  // 40xxx — Other errors
  UNAUTHORIZED: 40_001,
  REQUEST_TOO_LARGE: 40_005,
  ALREADY_PINNED: 40_041,
  // 50xxx — Operation not allowed
  MISSING_ACCESS: 50_001,
  CANNOT_EDIT_OTHER: 50_005,
  EMPTY_MESSAGE: 50_006,
  MISSING_PERMISSIONS: 50_013,
  INVALID_BULK_DELETE: 50_016,
  WRONG_PIN_CHANNEL: 50_019,
  INVALID_ROLE: 50_028,
  MESSAGE_TOO_OLD: 50_034,
  INVALID_FORM_BODY: 50_035,
  INVALID_API_VERSION: 50_041,
  FILE_TOO_LARGE: 50_045,
} as const

/** Error response type */
export interface DiscordErrorResponse {
  body: {
    message: string
    code: number
    errors?: Record<string, unknown>
  }
  status: number
}

/**
 * Generates a Discord-compatible error response.
 * @param code - Discord error code
 * @param message - Error message
 * @param status - HTTP status code
 * @returns Error response object
 */
export function discordError(
  code: number,
  message: string,
  status: number
): DiscordErrorResponse {
  return {
    body: { message, code },
    status,
  }
}

/**
 * Generates a validation error (50035) response.
 * @param errors - Error details per field
 * @returns Validation error response object
 */
export function validationError(
  errors: Record<string, unknown>
): DiscordErrorResponse {
  return {
    body: {
      message: 'Invalid Form Body',
      code: DiscordErrorCode.INVALID_FORM_BODY,
      errors,
    },
    status: 400,
  }
}

/**
 * Helper map for building Hono responses from error codes
 */
export const ERROR_MESSAGES = {
  [DiscordErrorCode.UNKNOWN_CHANNEL]: 'Unknown Channel',
  [DiscordErrorCode.UNKNOWN_GUILD]: 'Unknown Guild',
  [DiscordErrorCode.UNKNOWN_MEMBER]: 'Unknown Member',
  [DiscordErrorCode.UNKNOWN_MESSAGE]: 'Unknown Message',
  [DiscordErrorCode.UNKNOWN_INVITE]: 'Unknown Invite',
  [DiscordErrorCode.UNKNOWN_ROLE]: 'Unknown Role',
  [DiscordErrorCode.UNKNOWN_TOKEN]: 'Unknown Token',
  [DiscordErrorCode.UNKNOWN_USER]: 'Unknown User',
  [DiscordErrorCode.UNKNOWN_EMOJI]: 'Unknown Emoji',
  [DiscordErrorCode.UNKNOWN_WEBHOOK]: 'Unknown Webhook',
  [DiscordErrorCode.MAX_PINS_REACHED]:
    'Maximum number of pins reached for the channel (50)',
  [DiscordErrorCode.MAX_ROLES_REACHED]:
    'Maximum number of guild roles reached (250)',
  [DiscordErrorCode.MAX_WEBHOOKS_REACHED]:
    'Maximum number of webhooks reached (15)',
  [DiscordErrorCode.MAX_CHANNELS_REACHED]:
    'Maximum number of guild channels reached (500)',
  [DiscordErrorCode.MAX_ATTACHMENTS]:
    'Maximum number of attachments in a message reached (10)',
  [DiscordErrorCode.UNAUTHORIZED]: 'Unauthorized',
  [DiscordErrorCode.REQUEST_TOO_LARGE]: 'Request entity too large',
  [DiscordErrorCode.ALREADY_PINNED]: 'This message was already pinned',
  [DiscordErrorCode.MISSING_ACCESS]: 'Missing Access',
  [DiscordErrorCode.CANNOT_EDIT_OTHER]:
    'Cannot edit a message authored by another user',
  [DiscordErrorCode.EMPTY_MESSAGE]: 'Cannot send an empty message',
  [DiscordErrorCode.MISSING_PERMISSIONS]:
    'You lack permissions to perform that action',
  [DiscordErrorCode.INVALID_BULK_DELETE]:
    'Provided too many messages to delete',
  [DiscordErrorCode.WRONG_PIN_CHANNEL]:
    'A message can only be pinned to the channel it was sent in',
  [DiscordErrorCode.INVALID_ROLE]: 'Invalid role',
  [DiscordErrorCode.MESSAGE_TOO_OLD]:
    'A message provided was too old to bulk delete',
  [DiscordErrorCode.INVALID_FORM_BODY]: 'Invalid Form Body',
  [DiscordErrorCode.INVALID_API_VERSION]: 'Invalid API version provided',
  [DiscordErrorCode.FILE_TOO_LARGE]: 'File uploaded exceeds the maximum size',
} as const
