/**
 * Channel-scoped request validators
 *
 * Validation follows the Discord API error format (code 50035).
 */

import { typeError, type ValidationErrors } from './common.js'

/** Invite creation payload */
export interface InviteCreatePayload {
  max_age?: number | null
  max_uses?: number | null
  temporary?: boolean | null
  unique?: boolean | null
}

/** Invite limit constants (from the Discord spec) */
export const INVITE_LIMITS = {
  MAX_AGE_MAX: 5_184_000,
  MAX_USES_MAX: 100,
} as const

/**
 * Validates that an optional field, when present, is an integer within
 * [0, max]. Non-numeric or out-of-range values add a Discord-format error.
 * The value is typed as `unknown` because it originates from untrusted JSON
 * and may not actually be a number at runtime.
 * @param value - Raw field value (untrusted)
 * @param max - Inclusive upper bound
 * @param field - Field name used as the error key
 * @param errors - Error map to append to
 */
function validateOptionalIntBound(
  value: unknown,
  max: number,
  field: string,
  errors: Record<string, unknown>
): void {
  if (value === undefined || value === null) return
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > max
  ) {
    errors[field] = {
      _errors: [
        {
          code: 'NUMBER_TYPE_MAX',
          message: `Must be an integer between 0 and ${max}.`,
        },
      ],
    }
  }
}

/**
 * Validates an invite creation payload.
 * @param payload - Request payload
 * @returns Field-keyed error map (empty when valid)
 */
export function validateInviteCreate(
  payload: InviteCreatePayload
): Record<string, unknown> {
  const errors: Record<string, unknown> = {}

  validateOptionalIntBound(
    payload.max_age,
    INVITE_LIMITS.MAX_AGE_MAX,
    'max_age',
    errors
  )
  validateOptionalIntBound(
    payload.max_uses,
    INVITE_LIMITS.MAX_USES_MAX,
    'max_uses',
    errors
  )

  return errors
}

/** Permission overwrite request payload (unknown fields until validated) */
export interface PermissionOverwritePayload {
  type?: unknown
  allow?: unknown
  deny?: unknown
}

/**
 * Checks whether a value is an acceptable permission bitfield input:
 * a non-negative integer, a numeric string, null, or undefined.
 * @param value - Value to check
 * @returns True if the value is an acceptable bitfield input
 */
function isValidBitfield(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0
  if (typeof value === 'string') return /^\d+$/.test(value)
  return false
}

/**
 * Validates a channel permission overwrite payload. `type` must be 0 (role)
 * or 1 (member); `allow`/`deny`, when present, must be a non-negative integer
 * or a numeric string.
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validatePermissionOverwrite(
  payload: PermissionOverwritePayload
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (payload.type !== 0 && payload.type !== 1) {
    errors.type = {
      _errors: [
        {
          code: 'BASE_TYPE_CHOICES',
          message: 'Value must be one of (0, 1).',
        },
      ],
    }
  }

  if (!isValidBitfield(payload.allow)) {
    errors.allow = { _errors: [typeError('string')] }
  }
  if (!isValidBitfield(payload.deny)) {
    errors.deny = { _errors: [typeError('string')] }
  }

  return errors
}

/**
 * Normalizes a validated permission overwrite payload into stored form:
 * `type` as a number and `allow`/`deny` as numeric strings (default "0").
 * Call only after validatePermissionOverwrite reports no errors.
 * @param payload - Validated payload
 * @returns Normalized overwrite values
 */
export function normalizePermissionOverwrite(
  payload: PermissionOverwritePayload
): { type: number; allow: string; deny: string } {
  return {
    type: payload.type as number,
    allow: payload.allow == null ? '0' : String(payload.allow),
    deny: payload.deny == null ? '0' : String(payload.deny),
  }
}
