/**
 * Message validation
 *
 * Provides validation conforming to Discord API v10 message limits.
 */

import { maxLengthError, type ValidationErrors } from './common'

/** Message creation request type */
export interface MessageCreatePayload {
  content?: string
  tts?: boolean
  /** Discord clients may send null (e.g. discordgo). null is treated the same as an empty array */
  embeds?: EmbedPayload[] | null
  message_reference?: { message_id?: string }
  components?: unknown[]
  flags?: number
  attachments?: unknown[]
}

/** Embed type */
export interface EmbedPayload {
  title?: string
  description?: string
  fields?: { name: string; value: string; inline?: boolean }[]
  footer?: { text: string; icon_url?: string }
  author?: { name: string; url?: string; icon_url?: string }
  url?: string
  color?: number
  timestamp?: string
  image?: { url: string }
  thumbnail?: { url: string }
}

/** Message limit values */
export const MESSAGE_LIMITS = {
  CONTENT_MAX: 2000,
  EMBEDS_MAX: 10,
  EMBED_TOTAL_CHARS: 6000,
  ATTACHMENTS_MAX: 10,
  EMBED_TITLE_MAX: 256,
  EMBED_DESCRIPTION_MAX: 4096,
  EMBED_FIELDS_MAX: 25,
  EMBED_FIELD_NAME_MAX: 256,
  EMBED_FIELD_VALUE_MAX: 1024,
  EMBED_FOOTER_TEXT_MAX: 2048,
  EMBED_AUTHOR_NAME_MAX: 256,
} as const

/**
 * Validates a message creation payload.
 * @param payload - Payload to validate
 * @param _hasAttachments - Whether attachments are present (currently unused)
 * @returns Validation error map (empty object if no errors)
 */
export function validateMessageCreate(
  payload: MessageCreatePayload,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _hasAttachments = false
): ValidationErrors {
  const errors: ValidationErrors = {}

  // Check content length (treat null like undefined; type-safely verify it is a string)
  if (
    typeof payload.content === 'string' &&
    payload.content.length > MESSAGE_LIMITS.CONTENT_MAX
  ) {
    errors.content = {
      _errors: [maxLengthError(MESSAGE_LIMITS.CONTENT_MAX)],
    }
  }

  // Check embeds count (null is treated the same as an empty array; discordgo etc. always send null)
  if (
    Array.isArray(payload.embeds) &&
    payload.embeds.length > MESSAGE_LIMITS.EMBEDS_MAX
  ) {
    errors.embeds = {
      _errors: [
        {
          code: 'BASE_TYPE_MAX_LENGTH',
          message: `Must be ${MESSAGE_LIMITS.EMBEDS_MAX} or fewer in length.`,
        },
      ],
    }
  }

  // Validate each embed field (Array.isArray safely skips null/undefined)
  if (Array.isArray(payload.embeds)) {
    for (let index = 0; index < payload.embeds.length; index++) {
      const embed = payload.embeds[index]
      if (embed.title && embed.title.length > MESSAGE_LIMITS.EMBED_TITLE_MAX) {
        errors[`embeds.${index}.title`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_TITLE_MAX)],
        }
      }
      if (
        embed.description &&
        embed.description.length > MESSAGE_LIMITS.EMBED_DESCRIPTION_MAX
      ) {
        errors[`embeds.${index}.description`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_DESCRIPTION_MAX)],
        }
      }
      if (
        embed.fields &&
        embed.fields.length > MESSAGE_LIMITS.EMBED_FIELDS_MAX
      ) {
        errors[`embeds.${index}.fields`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_FIELDS_MAX)],
        }
      }
      if (
        embed.footer &&
        embed.footer.text.length > MESSAGE_LIMITS.EMBED_FOOTER_TEXT_MAX
      ) {
        errors[`embeds.${index}.footer.text`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_FOOTER_TEXT_MAX)],
        }
      }
      if (
        embed.author &&
        embed.author.name.length > MESSAGE_LIMITS.EMBED_AUTHOR_NAME_MAX
      ) {
        errors[`embeds.${index}.author.name`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_AUTHOR_NAME_MAX)],
        }
      }
    }
  }

  return errors
}

/**
 * Checks whether a message is empty.
 * @param payload - Payload to check
 * @param hasAttachments - Whether attachments are present
 * @returns true if empty
 */
export function isEmptyMessage(
  payload: MessageCreatePayload,
  hasAttachments: boolean
): boolean {
  const hasContent = Boolean(payload.content && payload.content.length > 0)
  const hasEmbeds = Array.isArray(payload.embeds) && payload.embeds.length > 0
  return !hasContent && !hasEmbeds && !hasAttachments
}
