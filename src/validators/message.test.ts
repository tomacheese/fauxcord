import { describe, it, expect } from 'vitest'
import {
  validateMessageCreate,
  isEmptyMessage,
  MESSAGE_LIMITS,
} from './message'

describe('validateMessageCreate', () => {
  it('accepts a normal message with no errors', () => {
    expect(validateMessageCreate({ content: 'hi' })).toEqual({})
  })

  it('flags content over the limit', () => {
    const errors = validateMessageCreate({
      content: 'a'.repeat(MESSAGE_LIMITS.CONTENT_MAX + 1),
    })
    expect(errors.content).toBeDefined()
    expect(errors.content._errors[0].code).toBe('BASE_TYPE_MAX_LENGTH')
  })

  it('flags too many embeds', () => {
    const embeds = Array.from(
      { length: MESSAGE_LIMITS.EMBEDS_MAX + 1 },
      () => ({
        title: 't',
      })
    )
    const errors = validateMessageCreate({ embeds })
    expect(errors.embeds).toBeDefined()
  })

  it('treats null embeds as empty (no error)', () => {
    expect(validateMessageCreate({ content: 'x', embeds: null })).toEqual({})
  })

  it('flags an over-long embed title', () => {
    const errors = validateMessageCreate({
      embeds: [{ title: 'a'.repeat(MESSAGE_LIMITS.EMBED_TITLE_MAX + 1) }],
    })
    expect(errors['embeds.0.title']).toBeDefined()
  })

  it('flags an over-long embed description', () => {
    const errors = validateMessageCreate({
      embeds: [
        { description: 'a'.repeat(MESSAGE_LIMITS.EMBED_DESCRIPTION_MAX + 1) },
      ],
    })
    expect(errors['embeds.0.description']).toBeDefined()
  })

  it('flags too many embed fields', () => {
    const fields = Array.from(
      { length: MESSAGE_LIMITS.EMBED_FIELDS_MAX + 1 },
      () => ({ name: 'n', value: 'v' })
    )
    const errors = validateMessageCreate({ embeds: [{ fields }] })
    expect(errors['embeds.0.fields']).toBeDefined()
  })

  it('flags over-long footer text', () => {
    const errors = validateMessageCreate({
      embeds: [
        {
          footer: {
            text: 'a'.repeat(MESSAGE_LIMITS.EMBED_FOOTER_TEXT_MAX + 1),
          },
        },
      ],
    })
    expect(errors['embeds.0.footer.text']).toBeDefined()
  })

  it('flags an over-long author name', () => {
    const errors = validateMessageCreate({
      embeds: [
        {
          author: {
            name: 'a'.repeat(MESSAGE_LIMITS.EMBED_AUTHOR_NAME_MAX + 1),
          },
        },
      ],
    })
    expect(errors['embeds.0.author.name']).toBeDefined()
  })
})

describe('isEmptyMessage', () => {
  it('is true for no content, no embeds, no attachments', () => {
    expect(isEmptyMessage({}, false)).toBe(true)
  })

  it('is false when content is present', () => {
    expect(isEmptyMessage({ content: 'hi' }, false)).toBe(false)
  })

  it('is false when embeds are present', () => {
    expect(isEmptyMessage({ embeds: [{ title: 't' }] }, false)).toBe(false)
  })

  it('is false when attachments are present', () => {
    expect(isEmptyMessage({}, true)).toBe(false)
  })
})
