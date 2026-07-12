import { describe, it, expect } from 'vitest'
import { generateSnowflake, snowflakeToTimestamp } from './snowflake'

describe('generateSnowflake', () => {
  it('returns a string', () => {
    const id = generateSnowflake()
    expect(typeof id).toBe('string')
  })

  it('consists of digits only', () => {
    const id = generateSnowflake()
    expect(/^\d+$/.test(id)).toBe(true)
  })

  it('generates unique IDs on successive calls', () => {
    const ids = Array.from({ length: 10 }, () => generateSnowflake())
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(10)
  })

  it('IDs are monotonically increasing', () => {
    const ids = Array.from({ length: 5 }, () => generateSnowflake())
    for (let index = 1; index < ids.length; index++) {
      expect(BigInt(ids[index])).toBeGreaterThan(BigInt(ids[index - 1]))
    }
  })

  it('contains a timestamp after the Discord Epoch (2015-01-01)', () => {
    const DISCORD_EPOCH = 1_420_070_400_000n
    const id = BigInt(generateSnowflake())
    const timestamp = (id >> 22n) + DISCORD_EPOCH
    expect(timestamp).toBeGreaterThan(DISCORD_EPOCH)
  })
})

describe('snowflakeToTimestamp', () => {
  it('returns a Date object from a Snowflake ID', () => {
    const id = generateSnowflake()
    const date = snowflakeToTimestamp(id)
    expect(date).toBeInstanceOf(Date)
  })

  it('returns a timestamp close to the current time', () => {
    const before = Date.now()
    const id = generateSnowflake()
    const after = Date.now()
    const ts = snowflakeToTimestamp(id).getTime()
    // Allow a 1-second margin
    expect(ts).toBeGreaterThanOrEqual(before - 1000)
    expect(ts).toBeLessThanOrEqual(after + 1000)
  })
})
