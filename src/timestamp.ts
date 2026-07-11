/**
 * Discord-compatible ISO 8601 timestamp formatting.
 *
 * The real Discord API emits timestamps as ISO 8601 datetimes with
 * microsecond precision and an explicit `+00:00` UTC offset (e.g.
 * `2021-01-01T01:01:01.010000+00:00`), never the `Z`-suffixed format that
 * `Date.prototype.toISOString()` produces (e.g. `2021-01-01T01:01:01.010Z`).
 * Most client libraries parse both forms leniently, but some (e.g.
 * twilight-rs's `Timestamp::parse`) strictly reject the `Z` suffix, so every
 * Discord-facing timestamp field must go through this helper instead of
 * calling `toISOString()` directly.
 */

/**
 * Formats a `Date` as a Discord-style ISO 8601 timestamp string.
 * @param date - Date to format
 * @returns ISO 8601 string with microsecond precision and a `+00:00` offset
 * (e.g. `2021-01-01T01:01:01.010000+00:00`)
 */
export function toDiscordTimestamp(date: Date): string {
  const [base, fraction] = date.toISOString().split('.')
  // toISOString() always yields exactly 3 fractional digits (milliseconds)
  // followed by "Z"; pad to 6 digits (microseconds) since JS Date has no
  // finer resolution to offer.
  const milliseconds = fraction.slice(0, 3)
  return `${base}.${milliseconds}000+00:00`
}
