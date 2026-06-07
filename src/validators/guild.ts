/**
 * Guildバリデーション
 *
 * Discord API v10のGuild制限に準拠したバリデーションを提供します。
 */

import { maxLengthError, typeError, type ValidationErrors } from './common.js'

/** Guild制限値 */
export const GUILD_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 100,
  CHANNELS_MAX: 500,
  ROLES_MAX: 250,
  WEBHOOKS_PER_CHANNEL_MAX: 15,
  WEBHOOKS_TOTAL_MAX: 1000,
} as const

/** チャンネル作成リクエストの型 */
export interface ChannelCreatePayload {
  name: string
  type?: number
  topic?: string | null
  nsfw?: boolean
  parent_id?: string | null
  position?: number | null
}

/** ロール作成リクエストの型 */
export interface RoleCreatePayload {
  name?: string
  permissions?: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
}

/**
 * Guild名バリデーションを行います。
 * @param name - Guild名
 * @returns バリデーションエラーマップ
 */
export function validateGuildName(name: unknown): ValidationErrors {
  const errors: ValidationErrors = {}

  if (typeof name !== 'string') {
    errors.name = { _errors: [typeError('string')] }
    return errors
  }

  if (
    name.length < GUILD_LIMITS.NAME_MIN ||
    name.length > GUILD_LIMITS.NAME_MAX
  ) {
    errors.name = {
      _errors: [
        {
          code: 'BASE_TYPE_BAD_LENGTH',
          message: `Must be between ${GUILD_LIMITS.NAME_MIN} and ${GUILD_LIMITS.NAME_MAX} in length.`,
        },
      ],
    }
  }

  return errors
}

/**
 * チャンネル作成ペイロードをバリデーションします。
 * @param payload - バリデーション対象のペイロード
 * @returns バリデーションエラーマップ
 */
export function validateChannelCreate(
  payload: ChannelCreatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (!payload.name || payload.name.length === 0) {
    errors.name = {
      _errors: [
        { code: 'BASE_TYPE_REQUIRED', message: 'This field is required.' },
      ],
    }
  } else if (payload.name.length > 100) {
    errors.name = { _errors: [maxLengthError(100)] }
  }

  return errors
}
