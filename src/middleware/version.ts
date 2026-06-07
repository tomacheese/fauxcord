/**
 * APIバージョンルーティングミドルウェア
 *
 * /api/v10/ → そのまま処理
 * /api/ → v10として処理
 * / → v10として処理
 * /api/v6〜v9/ → 400 Bad Request
 */

import type { Context, Next } from 'hono'
import { discordError, DiscordErrorCode } from '../errors.js'

/** サポートされていないAPIバージョンのパターン（v10以外のバージョン指定をブロック）*/
const UNSUPPORTED_VERSION_PATTERN = /^\/api\/v(?!10\/)([0-9]+)\//

/**
 * APIバージョンを解決するミドルウェア。
 * 未サポートバージョンへのリクエストは400を返します。
 */
export const versionMiddleware = async (
  c: Context,
  next: Next
): Promise<undefined | Response> => {
  const path = c.req.path

  if (UNSUPPORTED_VERSION_PATTERN.test(path)) {
    const err = discordError(
      DiscordErrorCode.INVALID_API_VERSION,
      '400: Bad Request',
      400
    )
    return c.json(err.body, 400)
  }

  await next()
}
