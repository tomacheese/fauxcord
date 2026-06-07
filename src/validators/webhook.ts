/**
 * Webhook validation
 *
 * Provides validation conforming to Discord API v10 Webhook limits.
 */

import { maxLengthError, type ValidationErrors } from './common.js'

/** Webhook limit values */
export const WEBHOOK_LIMITS = {
  NAME_MIN: 1,
  NAME_MAX: 80,
  CONTENT_MAX: 2000,
  USERNAME_MAX: 80,
  EMBEDS_MAX: 10,
  /** Maximum number of Webhooks per channel */
  CHANNEL_WEBHOOKS_MAX: 15,
} as const

/** Webhook creation request type */
export interface WebhookCreatePayload {
  name: string
  avatar?: string | null
}

/** Webhook execution request type */
export interface WebhookExecutePayload {
  content?: string
  username?: string
  avatar_url?: string
  tts?: boolean
  embeds?: unknown[]
  allowed_mentions?: unknown
}

/**
 * Validates a webhook creation payload.
 * @param payload - Payload to validate
 * @returns Validation error map
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
 * Validates a webhook execution payload.
 * @param payload - Payload to validate
 * @returns Validation error map
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

  if (
    Array.isArray(payload.embeds) &&
    payload.embeds.length > WEBHOOK_LIMITS.EMBEDS_MAX
  ) {
    errors.embeds = {
      _errors: [maxLengthError(WEBHOOK_LIMITS.EMBEDS_MAX)],
    }
  }

  return errors
}
