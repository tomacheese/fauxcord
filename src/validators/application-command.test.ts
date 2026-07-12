import { describe, it, expect } from 'vitest'
import { validateApplicationCommandCreate } from './application-command'

describe('validateApplicationCommandCreate', () => {
  it('accepts a minimal valid CHAT_INPUT command', () => {
    const errors = validateApplicationCommandCreate({
      name: 'ping',
      description: 'Replies with pong',
    })
    expect(errors).toEqual({})
  })

  it('rejects a missing name', () => {
    const errors = validateApplicationCommandCreate({
      name: '',
      description: 'x',
    })
    expect(errors.name).toBeDefined()
  })

  it('rejects an uppercase name for CHAT_INPUT', () => {
    const errors = validateApplicationCommandCreate({
      name: 'Ping',
      description: 'x',
      type: 1,
    })
    expect(errors.name).toBeDefined()
  })

  it('rejects a name longer than 32 characters', () => {
    const errors = validateApplicationCommandCreate({
      name: 'a'.repeat(33),
      description: 'x',
    })
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_MAX_LENGTH')
  })

  it('requires a non-empty description for CHAT_INPUT', () => {
    const errors = validateApplicationCommandCreate({
      name: 'ping',
      description: '',
    })
    expect(errors.description).toBeDefined()
  })

  it('does not require a description for USER commands', () => {
    const errors = validateApplicationCommandCreate({
      name: 'Report User',
      type: 2,
    })
    expect(errors.description).toBeUndefined()
  })

  it('rejects an invalid type', () => {
    const errors = validateApplicationCommandCreate({
      name: 'ping',
      description: 'x',
      type: 99,
    })
    expect(errors.type).toBeDefined()
  })

  it('rejects options nested more than 2 levels deep', () => {
    const errors = validateApplicationCommandCreate({
      name: 'ping',
      description: 'x',
      options: [
        {
          type: 2, // SUB_COMMAND_GROUP
          name: 'group',
          description: 'g',
          options: [
            {
              type: 1, // SUB_COMMAND
              name: 'sub',
              description: 's',
              options: [
                {
                  type: 1, // SUB_COMMAND (too deep)
                  name: 'nested',
                  description: 'n',
                },
              ],
            },
          ],
        },
      ],
    })
    expect(errors.options).toBeDefined()
  })

  it('rejects a required option listed after an optional one', () => {
    const errors = validateApplicationCommandCreate({
      name: 'ping',
      description: 'x',
      options: [
        { type: 3, name: 'opt', description: 'o', required: false },
        { type: 3, name: 'req', description: 'r', required: true },
      ],
    })
    expect(errors.options).toBeDefined()
  })
})
