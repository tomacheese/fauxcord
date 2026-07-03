import { describe, it, expect } from 'vitest'
import {
  validatePermissionOverwrite,
  normalizePermissionOverwrite,
} from './channel.js'

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
