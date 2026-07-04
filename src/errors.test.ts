import { describe, it, expect } from 'vitest'
import { DiscordErrorCode, discordError, validationError } from './errors'

describe('DiscordErrorCode', () => {
  it('UNKNOWN_CHANNEL equals 10003', () => {
    expect(DiscordErrorCode.UNKNOWN_CHANNEL).toBe(10_003)
  })

  it('UNKNOWN_GUILD equals 10004', () => {
    expect(DiscordErrorCode.UNKNOWN_GUILD).toBe(10_004)
  })

  it('INVALID_FORM_BODY equals 50035', () => {
    expect(DiscordErrorCode.INVALID_FORM_BODY).toBe(50_035)
  })
})

describe('discordError', () => {
  it('returns an object with message, code, and status', () => {
    const err = discordError(10_003, 'Unknown Channel', 404)
    expect(err).toEqual({
      body: { message: 'Unknown Channel', code: 10_003 },
      status: 404,
    })
  })
})

describe('validationError', () => {
  it('returns a 50035 error containing an errors field', () => {
    const errors = {
      content: {
        _errors: [
          {
            code: 'BASE_TYPE_MAX_LENGTH',
            message: 'Must be 2000 or fewer in length.',
          },
        ],
      },
    }
    const err = validationError(errors)
    expect(err).toEqual({
      body: {
        message: 'Invalid Form Body',
        code: 50_035,
        errors,
      },
      status: 400,
    })
  })
})
