/**
 * Guild validation
 *
 * Provides validation conforming to Discord API v10 Guild limits.
 */

import {
  maxLengthError,
  requiredError,
  typeError,
  type FieldError,
  type ValidationErrors,
} from './common'

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
    (!Number.isSafeInteger(payload.color) ||
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

/** Emoji limit values */
export const EMOJI_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 32,
} as const

/** Emoji creation request type */
export interface EmojiCreatePayload {
  name?: string
  image?: unknown
  roles?: string[] | null
}

/** Emoji update request type */
export interface EmojiUpdatePayload {
  name?: string
  roles?: string[] | null
}

/**
 * Validates an emoji name: presence and length (2-32).
 * @param name - Emoji name
 * @param isRequired - Whether the name is required (true for creation)
 * @returns Field error array (empty when valid)
 */
function validateEmojiName(name: unknown, isRequired: boolean): FieldError[] {
  if (name === undefined) {
    return isRequired ? [requiredError()] : []
  }
  if (typeof name !== 'string') {
    return [typeError('string')]
  }
  if (
    name.length < EMOJI_LIMITS.NAME_MIN ||
    name.length > EMOJI_LIMITS.NAME_MAX
  ) {
    return [
      {
        code: 'BASE_TYPE_BAD_LENGTH',
        message: `Must be between ${EMOJI_LIMITS.NAME_MIN} and ${EMOJI_LIMITS.NAME_MAX} in length.`,
      },
    ]
  }
  return []
}

/**
 * Validates an emoji `roles` field: when present, it must be an array of
 * Snowflake strings. `null`/`undefined` are treated as "not provided".
 * @param roles - Roles value from the payload (untrusted at runtime)
 * @returns Field error array (empty when valid)
 */
function validateEmojiRoles(roles: unknown): FieldError[] {
  if (roles === undefined || roles === null) {
    return []
  }
  if (!Array.isArray(roles)) {
    return [typeError('array')]
  }
  if (roles.some((role) => typeof role !== 'string')) {
    return [typeError('array[string]')]
  }
  return []
}

/**
 * Validates an emoji creation payload: `name` (required, 2-32), `image`
 * (required), and `roles` (optional array of Snowflake strings).
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validateEmojiCreate(
  payload: EmojiCreatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}
  const nameErrors = validateEmojiName(payload.name, true)
  if (nameErrors.length > 0) errors.name = { _errors: nameErrors }
  if (payload.image === undefined) {
    errors.image = { _errors: [requiredError()] }
  } else if (typeof payload.image !== 'string' || payload.image.length === 0) {
    errors.image = { _errors: [typeError('string')] }
  }
  const roleErrors = validateEmojiRoles(payload.roles)
  if (roleErrors.length > 0) errors.roles = { _errors: roleErrors }
  return errors
}

/**
 * Validates an emoji update payload: `name` (optional, 2-32) and `roles`
 * (optional array of Snowflake strings).
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validateEmojiUpdate(
  payload: EmojiUpdatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}
  const nameErrors = validateEmojiName(payload.name, false)
  if (nameErrors.length > 0) errors.name = { _errors: nameErrors }
  const roleErrors = validateEmojiRoles(payload.roles)
  if (roleErrors.length > 0) errors.roles = { _errors: roleErrors }
  return errors
}

/** Ban creation request type */
export interface BanCreatePayload {
  delete_message_seconds?: number | null
  delete_message_days?: number | null
}

/** Maximum value for delete_message_seconds (7 days in seconds) */
const DELETE_MESSAGE_SECONDS_MAX = 604_800
/** Maximum value for delete_message_days */
const DELETE_MESSAGE_DAYS_MAX = 7

/**
 * Validates a ban creation payload: `delete_message_seconds` and
 * `delete_message_days` ranges. Both fields are optional.
 * @param payload - Payload to validate
 * @returns Validation error map (empty when valid)
 */
export function validateBanCreate(payload: BanCreatePayload): ValidationErrors {
  const errors: ValidationErrors = {}

  const seconds = payload.delete_message_seconds
  if (
    seconds !== undefined &&
    seconds !== null &&
    (!Number.isSafeInteger(seconds) ||
      seconds < 0 ||
      seconds > DELETE_MESSAGE_SECONDS_MAX)
  ) {
    errors.delete_message_seconds = {
      _errors: [
        {
          code: 'NUMBER_TYPE_MAX',
          message: `Must be an integer between 0 and ${DELETE_MESSAGE_SECONDS_MAX}.`,
        },
      ],
    }
  }

  const days = payload.delete_message_days
  if (
    days !== undefined &&
    days !== null &&
    (!Number.isSafeInteger(days) || days < 0 || days > DELETE_MESSAGE_DAYS_MAX)
  ) {
    errors.delete_message_days = {
      _errors: [
        {
          code: 'NUMBER_TYPE_MAX',
          message: `Must be an integer between 0 and ${DELETE_MESSAGE_DAYS_MAX}.`,
        },
      ],
    }
  }

  return errors
}
