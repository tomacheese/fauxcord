/**
 * Webhook validation
 *
 * Provides validation conforming to Discord API v10 Webhook limits.
 */

import { maxLengthError, typeError, type ValidationErrors } from './common'

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

/** Webhook update (PATCH) payload (unknown fields until validated) */
export interface WebhookUpdatePayload {
  name?: unknown
  avatar?: unknown
  channel_id?: unknown
}

/**
 * Validates a webhook update (PATCH) payload. `name`, when present, must be a
 * non-empty string of at most 80 characters (matching creation constraints).
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validateWebhookUpdate(
  payload: WebhookUpdatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (payload.name !== undefined && payload.name !== null) {
    if (typeof payload.name !== 'string') {
      errors.name = { _errors: [typeError('string')] }
    } else if (payload.name.length < WEBHOOK_LIMITS.NAME_MIN) {
      errors.name = {
        _errors: [
          { code: 'BASE_TYPE_REQUIRED', message: 'This field is required.' },
        ],
      }
    } else if (payload.name.length > WEBHOOK_LIMITS.NAME_MAX) {
      errors.name = { _errors: [maxLengthError(WEBHOOK_LIMITS.NAME_MAX)] }
    }
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

/**
 * Checks whether a channel has reached its webhook count limit.
 * @param currentCount - Current number of webhooks in the channel
 * @returns true if the limit has been reached
 */
export function isChannelWebhookLimitReached(currentCount: number): boolean {
  return currentCount >= WEBHOOK_LIMITS.CHANNEL_WEBHOOKS_MAX
}
