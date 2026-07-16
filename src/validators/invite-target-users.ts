/**
 * Invite target-users CSV validation
 *
 * Validates the CSV payload accepted by PUT /invites/{code}/target-users.
 * The expected format matches the real Discord API: a header line of
 * `user_id`, followed by one Snowflake user ID per line.
 */

/** Matches a Discord Snowflake ID (17-20 digits). */
const SNOWFLAKE_PATTERN = /^\d{17,20}$/

/** The required CSV header line. */
export const TARGET_USERS_CSV_HEADER = 'user_id'

/** Successfully parsed target-users CSV. */
export interface ParsedTargetUsers {
  userIds: string[]
}

/**
 * Builds a `validationError`-compatible error map for a `target_users_file` problem.
 * @param message - Human-readable error message
 * @returns Field-keyed error map
 */
function fileError(message: string): { errors: Record<string, unknown> } {
  return {
    errors: {
      target_users_file: {
        _errors: [{ code: 'INVALID_FORM_BODY', message }],
      },
    },
  }
}

/**
 * Parses and validates a target-users CSV body.
 * @param text - Raw CSV file content
 * @returns The validated user IDs, or a field-keyed error map
 */
export function parseTargetUsersCsv(
  text: string
): ParsedTargetUsers | { errors: Record<string, unknown> } {
  const lines = text
    .split(/\r\n|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return fileError('File must not be empty.')
  }

  const [header, ...dataLines] = lines
  if (header !== TARGET_USERS_CSV_HEADER) {
    return fileError(
      `Expected CSV header "${TARGET_USERS_CSV_HEADER}", got "${header}".`
    )
  }

  const invalid = dataLines.filter((line) => !SNOWFLAKE_PATTERN.test(line))
  if (invalid.length > 0) {
    return fileError(`Invalid user ID(s): ${invalid.join(', ')}`)
  }

  return { userIds: dataLines }
}
