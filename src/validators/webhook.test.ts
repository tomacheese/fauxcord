import { describe, it, expect } from 'vitest'
import {
  validateWebhookCreate,
  validateWebhookExecute,
  validateWebhookUpdate,
  isChannelWebhookLimitReached,
  WEBHOOK_LIMITS,
} from './webhook'

describe('validateWebhookCreate', () => {
  it('accepts a valid name', () => {
    expect(validateWebhookCreate({ name: 'My Webhook' })).toEqual({})
  })

  it('requires a name', () => {
    const errors = validateWebhookCreate({ name: '' })
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_REQUIRED')
  })

  it('flags an over-long name', () => {
    const errors = validateWebhookCreate({
      name: 'a'.repeat(WEBHOOK_LIMITS.NAME_MAX + 1),
    })
    expect(errors.name._errors[0].code).toBe('BASE_TYPE_MAX_LENGTH')
  })
})

describe('validateWebhookExecute', () => {
  it('accepts a normal payload', () => {
    expect(validateWebhookExecute({ content: 'hi' })).toEqual({})
  })

  it('flags over-long content', () => {
    const errors = validateWebhookExecute({
      content: 'a'.repeat(WEBHOOK_LIMITS.CONTENT_MAX + 1),
    })
    expect(errors.content).toBeDefined()
  })

  it('flags an over-long username', () => {
    const errors = validateWebhookExecute({
      username: 'a'.repeat(WEBHOOK_LIMITS.USERNAME_MAX + 1),
    })
    expect(errors.username).toBeDefined()
  })

  it('flags too many embeds', () => {
    const embeds = Array.from(
      { length: WEBHOOK_LIMITS.EMBEDS_MAX + 1 },
      () => ({})
    )
    const errors = validateWebhookExecute({ embeds })
    expect(errors.embeds).toBeDefined()
  })
})

describe('validateWebhookUpdate', () => {
  it('accepts a valid update payload', () => {
    expect(
      validateWebhookUpdate({
        name: 'New Name',
        avatar: 'abc123',
        channel_id: '111111111111111111',
      })
    ).toEqual({})
  })

  it('accepts avatar set to null (clearing the avatar)', () => {
    expect(validateWebhookUpdate({ avatar: null })).toEqual({})
  })

  it('flags a non-string avatar', () => {
    const errors = validateWebhookUpdate({ avatar: {} })
    expect(errors.avatar._errors[0].code).toBe('BASE_TYPE_BAD_TYPE')
  })

  it('flags a non-string channel_id', () => {
    const errors = validateWebhookUpdate({ channel_id: 123 })
    expect(errors.channel_id._errors[0].code).toBe('BASE_TYPE_BAD_TYPE')
  })
})

describe('isChannelWebhookLimitReached', () => {
  it('is false below the limit', () => {
    expect(
      isChannelWebhookLimitReached(WEBHOOK_LIMITS.CHANNEL_WEBHOOKS_MAX - 1)
    ).toBe(false)
  })

  it('is true at or above the limit', () => {
    expect(
      isChannelWebhookLimitReached(WEBHOOK_LIMITS.CHANNEL_WEBHOOKS_MAX)
    ).toBe(true)
  })
})
