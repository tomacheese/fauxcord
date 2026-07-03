/**
 * Thread validation
 *
 * Provides validation conforming to Discord API v10 thread limits.
 */

import { maxLengthError, typeError, type ValidationErrors } from './common.js'

/** Thread limit values */
export const THREAD_LIMITS = {
  NAME_MIN: 1,
  NAME_MAX: 100,
} as const

/** Allowed thread channel types (Announcement/Public/Private thread) */
export const THREAD_CHANNEL_TYPES = [10, 11, 12] as const

/** Valid auto-archive durations (minutes) per the Discord spec */
export const THREAD_AUTO_ARCHIVE_DURATIONS = [60, 1440, 4320, 10_080] as const

/** Thread creation request payload */
export interface ThreadCreatePayload {
  name?: unknown
  auto_archive_duration?: unknown
  rate_limit_per_user?: unknown
  type?: unknown
  invitable?: unknown
}

/**
 * Validates a thread creation payload: requires a non-empty `name` within the
 * length limit. Mirrors the Discord "Invalid Form Body" error shape.
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validateThreadCreate(
  payload: ThreadCreatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (
    payload.name === undefined ||
    payload.name === null ||
    (typeof payload.name === 'string' && payload.name.length === 0)
  ) {
    errors.name = {
      _errors: [
        { code: 'BASE_TYPE_REQUIRED', message: 'This field is required.' },
      ],
    }
  } else if (typeof payload.name !== 'string') {
    errors.name = { _errors: [typeError('string')] }
  } else if (payload.name.length > THREAD_LIMITS.NAME_MAX) {
    errors.name = { _errors: [maxLengthError(THREAD_LIMITS.NAME_MAX)] }
  }

  return errors
}
