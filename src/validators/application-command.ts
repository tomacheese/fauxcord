/**
 * Application command validation
 *
 * Validates command create/update payloads against the Discord spec:
 * name pattern, type restrictions, and recursive option validation.
 */

import type { FieldError, ValidationErrors } from './common'
import { maxLengthError, requiredError, typeError } from './common'

/** A single choice offered for a STRING/INTEGER/NUMBER option */
export interface ApplicationCommandOptionChoice {
  name: string
  value: string | number
}

/** A single command option (may itself contain nested sub-options) */
export interface ApplicationCommandOption {
  type: number
  name: string
  description: string
  required?: boolean
  choices?: ApplicationCommandOptionChoice[]
  options?: ApplicationCommandOption[]
}

/** Payload accepted by command create/bulk-overwrite endpoints */
export interface ApplicationCommandCreatePayload {
  name: string
  description?: string
  type?: number
  options?: ApplicationCommandOption[]
  default_member_permissions?: string | null
  dm_permission?: boolean | null
  nsfw?: boolean
}

/**
 * CHAT_INPUT command/subcommand name pattern (Discord requires lowercase,
 * `-`/`_`, letters, and digits; Unicode letter/number categories are allowed
 * for non-English names).
 */
const NAME_PATTERN = /^[-_\p{Ll}\p{N}]{1,32}$/u

/**
 * Recursively validates a command's `options` array.
 * @param options - Raw options value from the request payload
 * @param depth - Current nesting depth (0 = top-level options)
 * @returns Field errors found, if any
 */
function validateOptions(options: unknown, depth: number): FieldError[] {
  const errors: FieldError[] = []
  if (!Array.isArray(options)) {
    errors.push(typeError('array'))
    return errors
  }

  let sawOptional = false
  for (const raw of options as Partial<ApplicationCommandOption>[]) {
    if (
      typeof raw.type !== 'number' ||
      raw.type < 1 ||
      raw.type > 11 ||
      !Number.isSafeInteger(raw.type)
    ) {
      errors.push(typeError('integer between 1 and 11'))
      continue
    }
    if (typeof raw.name !== 'string' || !NAME_PATTERN.test(raw.name)) {
      errors.push(requiredError())
    }

    const isGroupOrSubCommand = raw.type === 1 || raw.type === 2
    if (isGroupOrSubCommand) {
      if (depth >= 2) {
        errors.push({
          code: 'APPLICATION_COMMAND_OPTIONS_TOO_DEEP',
          message:
            'Command options may nest at most 2 levels (SUB_COMMAND_GROUP > SUB_COMMAND).',
        })
      } else if (raw.options) {
        errors.push(...validateOptions(raw.options, depth + 1))
      }
      continue
    }

    if (raw.required === true) {
      if (sawOptional) {
        errors.push({
          code: 'APPLICATION_COMMAND_OPTIONS_REQUIRED_INVALID_ORDER',
          message: 'Required options must be listed before optional options.',
        })
      }
    } else {
      sawOptional = true
    }
  }
  return errors
}

/**
 * Validates a command create/bulk-overwrite payload.
 * @param payload - Raw payload from the request body
 * @returns Validation errors keyed by field name (empty object = valid)
 */
export function validateApplicationCommandCreate(
  payload: ApplicationCommandCreatePayload
): ValidationErrors {
  const errors: ValidationErrors = {}
  const type = payload.type ?? 1

  if (![1, 2, 3].includes(type)) {
    errors.type = { _errors: [typeError('integer (1, 2, or 3)')] }
  }

  if (typeof payload.name !== 'string' || payload.name.length === 0) {
    errors.name = { _errors: [requiredError()] }
  } else if (payload.name.length > 32) {
    errors.name = { _errors: [maxLengthError(32)] }
  } else if (type === 1 && !NAME_PATTERN.test(payload.name)) {
    errors.name = {
      _errors: [
        {
          code: 'APPLICATION_COMMAND_INVALID_NAME',
          message: String.raw`CHAT_INPUT command names must be lowercase and match ^[-_\p{Ll}\p{N}]{1,32}$.`,
        },
      ],
    }
  }

  if (type === 1) {
    const description = payload.description ?? ''
    if (description.length === 0) {
      errors.description = { _errors: [requiredError()] }
    } else if (description.length > 100) {
      errors.description = { _errors: [maxLengthError(100)] }
    }
  }

  if (payload.options !== undefined) {
    const optionErrors = validateOptions(payload.options, 0)
    if (optionErrors.length > 0) errors.options = { _errors: optionErrors }
  }

  return errors
}
