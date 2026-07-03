/**
 * Guild validation
 *
 * Provides validation conforming to Discord API v10 Guild limits.
 */

import { maxLengthError, typeError, type ValidationErrors } from './common.js'

/** Guild limit values */
export const GUILD_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 100,
  CHANNELS_MAX: 500,
  ROLES_MAX: 250,
  WEBHOOKS_PER_CHANNEL_MAX: 15,
  WEBHOOKS_TOTAL_MAX: 1000,
} as const

/** Channel creation request type */
export interface ChannelCreatePayload {
  name: string
  type?: number
  topic?: string | null
  nsfw?: boolean
  parent_id?: string | null
  position?: number | null
}

/** Role creation request type */
export interface RoleCreatePayload {
  name?: string
  permissions?: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
}

/**
 * Validates a Guild name.
 * @param name - Guild name
 * @returns Validation error map
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
 * Validates a channel creation payload.
 * @param payload - Payload to validate
 * @returns Validation error map
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
  } else if (payload.name.length > GUILD_LIMITS.NAME_MAX) {
    errors.name = { _errors: [maxLengthError(GUILD_LIMITS.NAME_MAX)] }
  }

  return errors
}

/** Role update request type */
export interface RoleUpdatePayload {
  name?: string
  permissions?: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
}

/**
 * Validates a role creation payload: `name` length, `color` range, and
 * `permissions` numeric format.
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validateRoleCreate(
  payload: RoleCreatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (payload.name !== undefined) {
    if (typeof payload.name !== 'string') {
      errors.name = { _errors: [typeError('string')] }
    } else if (payload.name.length > GUILD_LIMITS.NAME_MAX) {
      errors.name = { _errors: [maxLengthError(GUILD_LIMITS.NAME_MAX)] }
    }
  }

  if (
    payload.color !== undefined &&
    (!Number.isInteger(payload.color) ||
      payload.color < 0 ||
      payload.color > 0xff_ff_ff)
  ) {
    errors.color = {
      _errors: [
        {
          code: 'NUMBER_TYPE_MAX',
          message: 'Must be an integer between 0 and 16777215.',
        },
      ],
    }
  }

  if (payload.permissions !== undefined && !/^\d+$/.test(payload.permissions)) {
    errors.permissions = {
      _errors: [
        {
          code: 'BASE_TYPE_BAD_TYPE',
          message: 'Value must be a numeric string.',
        },
      ],
    }
  }

  return errors
}

/**
 * Validates a role update payload. Uses the same rules as role creation.
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validateRoleUpdate(
  payload: RoleUpdatePayload
): ValidationErrors {
  return validateRoleCreate(payload)
}

/** Maximum guild member nickname length (Discord's limit) */
const NICK_MAX = 32

/** Guild member update request type */
export interface GuildMemberUpdatePayload {
  nick?: string | null
  roles?: string[]
}

/**
 * Validates a guild member update payload: `nick` length.
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validateGuildMemberUpdate(
  payload: GuildMemberUpdatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (
    payload.nick !== undefined &&
    payload.nick !== null &&
    payload.nick.length > NICK_MAX
  ) {
    errors.nick = { _errors: [maxLengthError(NICK_MAX)] }
  }

  return errors
}
