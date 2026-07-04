import { describe, it, expect } from 'vitest'
import {
  validatePermissionOverwrite,
  normalizePermissionOverwrite,
  validateChannelUpdate,
} from './channel'

describe('validatePermissionOverwrite', () => {
  it('accepts type 0/1 with numeric-string allow/deny', () => {
    expect(
      Object.keys(
        validatePermissionOverwrite({ type: 0, allow: '1024', deny: '0' })
      )
    ).toHaveLength(0)
    expect(Object.keys(validatePermissionOverwrite({ type: 1 }))).toHaveLength(
      0
    )
  })

  it('rejects a missing type', () => {
    expect(validatePermissionOverwrite({}).type).toBeDefined()
  })

  it('rejects a type other than 0 or 1', () => {
    expect(validatePermissionOverwrite({ type: 2 }).type).toBeDefined()
  })

  it('rejects a non-numeric allow string', () => {
    expect(
      validatePermissionOverwrite({ type: 0, allow: 'abc' }).allow
    ).toBeDefined()
  })

  it('rejects a numeric allow above the safe-integer range', () => {
    // 1e21 loses precision and would stringify to exponential notation.
    expect(
      validatePermissionOverwrite({ type: 0, allow: 1e21 }).allow
    ).toBeDefined()
  })

  it('reports an allow/deny error message reflecting both accepted forms', () => {
    const errors = validatePermissionOverwrite({ type: 0, allow: 'abc' })
    expect(errors.allow._errors[0]?.message).toBe(
      'Value must be an integer or a numeric string.'
    )
  })

  it('normalizes numbers and null to strings with "0" defaults', () => {
    expect(
      normalizePermissionOverwrite({ type: 0, allow: 1024, deny: null })
    ).toEqual({ type: 0, allow: '1024', deny: '0' })
    expect(normalizePermissionOverwrite({ type: 1 })).toEqual({
      type: 1,
      allow: '0',
      deny: '0',
    })
  })
})

describe('validateChannelUpdate', () => {
  it('accepts a valid update payload', () => {
    expect(
      Object.keys(
        validateChannelUpdate({
          name: 'general',
          topic: 'chat',
          nsfw: true,
          rate_limit_per_user: 5,
          position: 1,
        })
      )
    ).toHaveLength(0)
  })

  it('reports a required error (not a type error) for an empty name', () => {
    const errors = validateChannelUpdate({ name: '' })
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_REQUIRED')
  })

  it('reports a type error for a non-string name', () => {
    const errors = validateChannelUpdate({ name: 123 })
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_BAD_TYPE')
  })

  it('reports a type error for a non-boolean nsfw', () => {
    const errors = validateChannelUpdate({ nsfw: 'false' })
    expect(errors.nsfw._errors[0].code).toBe('BASE_TYPE_BAD_TYPE')
  })

  it('accepts nsfw omitted or null', () => {
    expect(Object.keys(validateChannelUpdate({}))).toHaveLength(0)
    expect(Object.keys(validateChannelUpdate({ nsfw: null }))).toHaveLength(0)
  })
})
