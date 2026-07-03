/**
 * Channel-scoped request validators
 *
 * Validation follows the Discord API error format (code 50035).
 */

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
          message: `int value should be between 0 and ${max}.`,
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
