import { describe, it, expect } from 'vitest'
import { validateThreadCreate, THREAD_LIMITS } from './thread'

describe('validateThreadCreate', () => {
  it('accepts a valid name', () => {
    expect(validateThreadCreate({ name: 'my-thread' })).toEqual({})
  })

  it('requires a name (undefined)', () => {
    const errors = validateThreadCreate({})
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_REQUIRED')
  })

  it('requires a name (empty string)', () => {
    const errors = validateThreadCreate({ name: '' })
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_REQUIRED')
  })

  it('flags a non-string name', () => {
    const errors = validateThreadCreate({ name: 42 })
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_BAD_TYPE')
  })

  it('flags an over-long name', () => {
    const errors = validateThreadCreate({
      name: 'a'.repeat(THREAD_LIMITS.NAME_MAX + 1),
    })
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_MAX_LENGTH')
  })
})
