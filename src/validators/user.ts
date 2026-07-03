/**
 * Current user (self) validation
 *
 * Provides validation for the PATCH /users/@me (Modify Current User) payload,
 * conforming to Discord API v10 limits.
 */

import { typeError, type ValidationErrors } from './common.js'

/** Username length limits (Discord's Modify Current User limits) */
export const CURRENT_USER_LIMITS = {
  USERNAME_MIN: 2,
  USERNAME_MAX: 32,
} as const

/** Current user update request payload */
export interface CurrentUserUpdatePayload {
  username?: string
  avatar?: string | null
  banner?: string | null
}

/**
 * Validates a Modify Current User payload.
 *
 * All fields are optional (partial update), matching the real Discord API
 * behavior and how libraries such as discord.js / discord.py send avatar-only
 * updates. When `username` is present it must be a string between 2 and 32
 * characters; `avatar` / `banner` when present must be a string or null.
 * @param payload - Raw request body
 * @returns Validation error map (empty when valid)
 */
export function validateCurrentUserUpdate(
  payload: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (payload.username !== undefined) {
    if (typeof payload.username !== 'string') {
      errors.username = { _errors: [typeError('string')] }
    } else if (
      payload.username.length < CURRENT_USER_LIMITS.USERNAME_MIN ||
      payload.username.length > CURRENT_USER_LIMITS.USERNAME_MAX
    ) {
      errors.username = {
        _errors: [
          {
            code: 'BASE_TYPE_BAD_LENGTH',
            message: `Must be between ${CURRENT_USER_LIMITS.USERNAME_MIN} and ${CURRENT_USER_LIMITS.USERNAME_MAX} in length.`,
          },
        ],
      }
    }
  }

  if (
    payload.avatar !== undefined &&
    payload.avatar !== null &&
    typeof payload.avatar !== 'string'
  ) {
    errors.avatar = { _errors: [typeError('string')] }
  }

  if (
    payload.banner !== undefined &&
    payload.banner !== null &&
    typeof payload.banner !== 'string'
  ) {
    errors.banner = { _errors: [typeError('string')] }
  }

  return errors
}
