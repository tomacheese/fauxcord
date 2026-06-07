/**
 * Common validation utilities
 *
 * Provides helpers for generating field validation errors.
 */

/** Field error type */
export interface FieldError {
  code: string
  message: string
}

/** Validation error map type */
export type ValidationErrors = Record<string, { _errors: FieldError[] }>

/**
 * Generates a string max-length validation error.
 * @param maxLength - Maximum length
 * @returns Field error object
 */
export function maxLengthError(maxLength: number): FieldError {
  return {
    code: 'BASE_TYPE_MAX_LENGTH',
    message: `Must be ${maxLength} or fewer in length.`,
  }
}

/**
 * Generates a required field error.
 * @returns Field error object
 */
export function requiredError(): FieldError {
  return {
    code: 'BASE_TYPE_REQUIRED',
    message: 'This field is required.',
  }
}

/**
 * Generates a type error.
 * @param expectedType - Expected type
 * @returns Field error object
 */
export function typeError(expectedType: string): FieldError {
  return {
    code: 'BASE_TYPE_BAD_TYPE',
    message: `Value must be of type ${expectedType}.`,
  }
}
