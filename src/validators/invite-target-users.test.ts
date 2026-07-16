import { describe, it, expect } from 'vitest'
import { parseTargetUsersCsv } from './invite-target-users'

describe('parseTargetUsersCsv', () => {
  it('parses a valid CSV into a list of user IDs', () => {
    const result = parseTargetUsersCsv(
      'user_id\n111111111111111111\n222222222222222222\n'
    )
    expect(result).toEqual({
      userIds: ['111111111111111111', '222222222222222222'],
    })
  })

  it('accepts CRLF line endings and ignores blank lines', () => {
    const result = parseTargetUsersCsv(
      'user_id\r\n111111111111111111\r\n\r\n222222222222222222\r\n'
    )
    expect(result).toEqual({
      userIds: ['111111111111111111', '222222222222222222'],
    })
  })

  it('accepts a header-only file (zero target users)', () => {
    const result = parseTargetUsersCsv('user_id\n')
    expect(result).toEqual({ userIds: [] })
  })

  it('rejects an empty file', () => {
    const result = parseTargetUsersCsv('')
    expect('errors' in result).toBe(true)
  })

  it('rejects a file with the wrong header', () => {
    const result = parseTargetUsersCsv('id\n111111111111111111\n')
    expect('errors' in result).toBe(true)
  })

  it('rejects a file with a non-Snowflake user ID', () => {
    const result = parseTargetUsersCsv('user_id\nnot-a-snowflake\n')
    expect('errors' in result).toBe(true)
  })
})
