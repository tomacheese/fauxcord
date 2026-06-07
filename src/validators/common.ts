/**
 * 共通バリデーションユーティリティ
 *
 * フィールドのバリデーションエラー生成ヘルパーを提供します。
 */

/** フィールドエラーの型 */
export interface FieldError {
  code: string
  message: string
}

/** バリデーションエラーマップの型 */
export type ValidationErrors = Record<string, { _errors: FieldError[] }>

/**
 * 文字列の最大長バリデーションエラーを生成します。
 * @param maxLength - 最大文字数
 * @returns フィールドエラーオブジェクト
 */
export function maxLengthError(maxLength: number): FieldError {
  return {
    code: 'BASE_TYPE_MAX_LENGTH',
    message: `Must be ${maxLength} or fewer in length.`,
  }
}

/**
 * 必須フィールドエラーを生成します。
 * @returns フィールドエラーオブジェクト
 */
export function requiredError(): FieldError {
  return {
    code: 'BASE_TYPE_REQUIRED',
    message: 'This field is required.',
  }
}

/**
 * 型エラーを生成します。
 * @param expectedType - 期待する型
 * @returns フィールドエラーオブジェクト
 */
export function typeError(expectedType: string): FieldError {
  return {
    code: 'BASE_TYPE_BAD_LENGTH',
    message: `Value must be of type ${expectedType}.`,
  }
}
