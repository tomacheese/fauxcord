/**
 * @file skip.ts
 * @description Contract-test skip list for endpoints or schema validations
 * that cannot pass due to confirmed bugs or deliberate limitations in the
 * Discord OpenAPI spec (`discord/discord-api-spec`), not in the Fauxcord mock.
 *
 * ## Format
 *
 * Each entry must include:
 *   - `specPath` — the spec path template (must match a `MANIFEST` entry)
 *   - `method`   — HTTP method (lowercase)
 *   - `reason`   — A clear explanation of why the test is skipped.
 *                  Must reference a specific spec inconsistency, known bug, or
 *                  deliberate deviation, NOT a laziness justification.
 *
 * ## When to add an entry here vs. fixing the mock
 *
 * - Fix the mock when: the spec is correct and Fauxcord is missing or mistyping a field.
 * - Add a skip here when: the spec itself contains an error (e.g. a field is declared
 *   `required` in the spec but the real Discord API never returns it, or the spec type
 *   is provably wrong against actual Discord behavior).
 *
 * ## Empty by default
 *
 * No entries are needed until a real spec-side issue is confirmed. Keep this list
 * as short as possible — every entry here represents a known gap in spec quality.
 */

/** A skip-list entry for a contract test. */
export interface SkipEntry {
  /** The spec path template (must match a MANIFEST entry). */
  specPath: string
  /** HTTP method (lowercase). */
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  /**
   * Explanation of the confirmed spec bug or deliberate deviation that
   * prevents the contract test from passing. Required; cannot be empty.
   */
  reason: string
}

/**
 * List of contract tests to skip due to confirmed spec bugs or impractical
 * schema requirements. Initially empty.
 */
export const SKIP_LIST: SkipEntry[] = [
  // Example (do not uncomment unless the bug is confirmed):
  // {
  //   specPath: '/some/{path}',
  //   method: 'get',
  //   reason: 'spec declares "foo" as required but the real API never returns it (confirmed 2026-06-01)',
  // },
]
