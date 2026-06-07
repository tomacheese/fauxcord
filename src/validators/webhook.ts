/**
 * Webhookバリデーション
 *
 * Discord API v10のWebhook制限に準拠したバリデーションを提供します。
 */

import { maxLengthError, type ValidationErrors } from './common.js'

/** Webhook制限値 */
export const WEBHOOK_LIMITS = {
  NAME_MIN: 1,
  NAME_MAX: 80,
  CONTENT_MAX: 2000,
  USERNAME_MAX: 80,
  EMBEDS_MAX: 10,
  /** チャンネルあたりの Webhook 数上限 */
  CHANNEL_WEBHOOKS_MAX: 15,
} as const

/** Webhook作成リクエストの型 */
export interface WebhookCreatePayload {
  name: string
  avatar?: string | null
}

/** Webhook実行リクエストの型 */
export interface WebhookExecutePayload {
  content?: string
  username?: string
  avatar_url?: string
  tts?: boolean
  embeds?: unknown[]
  allowed_mentions?: unknown
}

/**
 * Webhook作成ペイロードをバリデーションします。
 * @param payload - バリデーション対象のペイロード
 * @returns バリデーションエラーマップ
 */
export function validateWebhookCreate(
  payload: WebhookCreatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (!payload.name || payload.name.length < WEBHOOK_LIMITS.NAME_MIN) {
    errors.name = {
      _errors: [
        { code: 'BASE_TYPE_REQUIRED', message: 'This field is required.' },
      ],
    }
  } else if (payload.name.length > WEBHOOK_LIMITS.NAME_MAX) {
    errors.name = { _errors: [maxLengthError(WEBHOOK_LIMITS.NAME_MAX)] }
  }

  return errors
}

/**
 * Webhook実行ペイロードをバリデーションします。
 * @param payload - バリデーション対象のペイロード
 * @returns バリデーションエラーマップ
 */
export function validateWebhookExecute(
  payload: WebhookExecutePayload
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (payload.content && payload.content.length > WEBHOOK_LIMITS.CONTENT_MAX) {
    errors.content = {
      _errors: [maxLengthError(WEBHOOK_LIMITS.CONTENT_MAX)],
    }
  }

  if (
    payload.username &&
    payload.username.length > WEBHOOK_LIMITS.USERNAME_MAX
  ) {
    errors.username = {
      _errors: [maxLengthError(WEBHOOK_LIMITS.USERNAME_MAX)],
    }
  }

  if (payload.embeds && payload.embeds.length > WEBHOOK_LIMITS.EMBEDS_MAX) {
    errors.embeds = {
      _errors: [maxLengthError(WEBHOOK_LIMITS.EMBEDS_MAX)],
    }
  }

  return errors
}
