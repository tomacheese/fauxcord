import { describe, expect, it } from 'vitest'
import { toDiscordTimestamp } from './timestamp'

describe('toDiscordTimestamp', () => {
  it('formats with microsecond precision and a +00:00 offset', () => {
    const date = new Date('2026-07-07T19:09:03.123Z')
    expect(toDiscordTimestamp(date)).toBe('2026-07-07T19:09:03.123000+00:00')
  })

  it('never emits the Z suffix', () => {
    const date = new Date('2021-01-01T00:00:00.000Z')
    expect(toDiscordTimestamp(date)).not.toMatch(/Z$/)
  })

  it('is parseable by the twilight-model ISO 8601 grammar (offset, not Z)', () => {
    // twilight-model's `Timestamp::parse` accepts
    // "2021-01-01T01:01:01.010000+00:00" but rejects the "Z"-suffixed form
    // (see compat/rust-twilight); this regex mirrors that accepted grammar.
    const date = new Date('2024-12-31T23:59:59.999Z')
    expect(toDiscordTimestamp(date)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/
    )
  })
})
