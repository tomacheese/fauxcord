import { describe, it, expect } from 'vitest'
import { validateCurrentUserUpdate, CURRENT_USER_LIMITS } from './user'

describe('validateCurrentUserUpdate', () => {
  it('accepts an empty (no-op) update', () => {
    expect(validateCurrentUserUpdate({})).toEqual({})
  })

  it('accepts a valid username', () => {
    expect(validateCurrentUserUpdate({ username: 'ValidName' })).toEqual({})
  })

  it('flags a non-string username', () => {
    const errors = validateCurrentUserUpdate({ username: 123 })
    expect(errors.username._errors[0].code).toBe('BASE_TYPE_BAD_TYPE')
  })

  it('flags a too-short username', () => {
    const errors = validateCurrentUserUpdate({
      username: 'a'.repeat(CURRENT_USER_LIMITS.USERNAME_MIN - 1),
    })
    expect(errors.username._errors[0].code).toBe('BASE_TYPE_BAD_LENGTH')
  })

  it('flags a too-long username', () => {
    const errors = validateCurrentUserUpdate({
      username: 'a'.repeat(CURRENT_USER_LIMITS.USERNAME_MAX + 1),
    })
    expect(errors.username._errors[0].code).toBe('BASE_TYPE_BAD_LENGTH')
  })

  it('accepts null avatar/banner', () => {
    expect(validateCurrentUserUpdate({ avatar: null, banner: null })).toEqual(
      {}
    )
  })

  it('flags a non-string avatar', () => {
    const errors = validateCurrentUserUpdate({ avatar: 5 })
    expect(errors.avatar._errors[0].code).toBe('BASE_TYPE_BAD_TYPE')
  })
})
