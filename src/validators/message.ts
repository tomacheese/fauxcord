/**
 * メッセージバリデーション
 *
 * Discord API v10のメッセージ制限に準拠したバリデーションを提供します。
 */

import { maxLengthError, type ValidationErrors } from './common.js'

/** メッセージ送信リクエストの型 */
export interface MessageCreatePayload {
  content?: string
  tts?: boolean
  /** Discord クライアントは null を送ることがある（discordgo 等）。null は空配列と同等に扱う */
  embeds?: EmbedPayload[] | null
  message_reference?: { message_id?: string }
  components?: unknown[]
  flags?: number
  attachments?: unknown[]
}

/** Embedの型 */
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

/** メッセージ制限値 */
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
 * メッセージ送信ペイロードをバリデーションします。
 * @param payload - バリデーション対象のペイロード
 * @param _hasAttachments - 添付ファイルがあるか（現在未使用）
 * @returns バリデーションエラーマップ（エラーなしの場合は空オブジェクト）
 */
export function validateMessageCreate(
  payload: MessageCreatePayload,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _hasAttachments = false
): ValidationErrors {
  const errors: ValidationErrors = {}

  // content の長さチェック
  if (
    payload.content !== undefined &&
    payload.content.length > MESSAGE_LIMITS.CONTENT_MAX
  ) {
    errors.content = {
      _errors: [maxLengthError(MESSAGE_LIMITS.CONTENT_MAX)],
    }
  }

  // embeds 数チェック（null は空配列と同等に扱う。discordgo 等は常に null を送る）
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

  // embed 各フィールドのバリデーション（Array.isArray で null/undefined を安全にスキップ）
  if (Array.isArray(payload.embeds)) {
    for (let i = 0; i < payload.embeds.length; i++) {
      const embed = payload.embeds[i]
      if (embed.title && embed.title.length > MESSAGE_LIMITS.EMBED_TITLE_MAX) {
        errors[`embeds.${i}.title`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_TITLE_MAX)],
        }
      }
      if (
        embed.description &&
        embed.description.length > MESSAGE_LIMITS.EMBED_DESCRIPTION_MAX
      ) {
        errors[`embeds.${i}.description`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_DESCRIPTION_MAX)],
        }
      }
      if (
        embed.fields &&
        embed.fields.length > MESSAGE_LIMITS.EMBED_FIELDS_MAX
      ) {
        errors[`embeds.${i}.fields`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_FIELDS_MAX)],
        }
      }
      if (
        embed.footer &&
        embed.footer.text.length > MESSAGE_LIMITS.EMBED_FOOTER_TEXT_MAX
      ) {
        errors[`embeds.${i}.footer.text`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_FOOTER_TEXT_MAX)],
        }
      }
      if (
        embed.author &&
        embed.author.name.length > MESSAGE_LIMITS.EMBED_AUTHOR_NAME_MAX
      ) {
        errors[`embeds.${i}.author.name`] = {
          _errors: [maxLengthError(MESSAGE_LIMITS.EMBED_AUTHOR_NAME_MAX)],
        }
      }
    }
  }

  return errors
}

/**
 * メッセージが空かどうかをチェックします。
 * @param payload - チェック対象のペイロード
 * @param hasAttachments - 添付ファイルがあるか
 * @returns 空の場合true
 */
export function isEmptyMessage(
  payload: MessageCreatePayload,
  hasAttachments: boolean
): boolean {
  const hasContent = payload.content && payload.content.length > 0
  const hasEmbeds = Array.isArray(payload.embeds) && payload.embeds.length > 0
  return !hasContent && !hasEmbeds && !hasAttachments
}
