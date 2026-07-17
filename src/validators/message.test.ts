import { describe, it, expect } from 'vitest'
import {
  validateMessageCreate,
  isEmptyMessage,
  validatePollCreate,
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

describe('validatePollCreate', () => {
  it('accepts a valid poll payload', () => {
    const errors = validatePollCreate({
      question: { text: 'Favorite color?' },
      answers: [
        { poll_media: { text: 'Red' } },
        { poll_media: { text: 'Blue' } },
      ],
    })
    expect(Object.keys(errors)).toHaveLength(0)
  })

  it('rejects a missing question text', () => {
    const errors = validatePollCreate({
      question: { text: '' },
      answers: [{ poll_media: { text: 'Red' } }],
    })
    expect(errors['poll.question.text']).toBeDefined()
  })

  it('rejects zero answers', () => {
    const errors = validatePollCreate({
      question: { text: 'Q' },
      answers: [],
    })
    expect(errors['poll.answers']).toBeDefined()
  })

  it('rejects more than 10 answers', () => {
    const errors = validatePollCreate({
      question: { text: 'Q' },
      answers: Array.from({ length: 11 }, (_, i) => ({
        poll_media: { text: `A${i}` },
      })),
    })
    expect(errors['poll.answers']).toBeDefined()
  })

  it('rejects an answer text longer than 55 characters', () => {
    const errors = validatePollCreate({
      question: { text: 'Q' },
      answers: [{ poll_media: { text: 'a'.repeat(56) } }],
    })
    expect(errors['poll.answers.0.poll_media.text']).toBeDefined()
  })

  it('rejects a duration outside 1-768', () => {
    const errors = validatePollCreate({
      question: { text: 'Q' },
      answers: [{ poll_media: { text: 'A' } }],
      duration: 1000,
    })
    expect(errors['poll.duration']).toBeDefined()
  })
})
