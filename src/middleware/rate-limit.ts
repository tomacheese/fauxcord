/**
 * Rate Limitダミーヘッダーミドルウェア
 *
 * Discord API互換のRate Limitヘッダーを全レスポンスに付与します。
 * モックサーバは実際にはレート制限を行いません。
 */

import type { Context, Next } from 'hono'

/**
 * Rate Limitダミーヘッダーを付与するミドルウェアを返します。
 */
export const rateLimitMiddleware = async (
  c: Context,
  next: Next
): Promise<void> => {
  await next()

  const resetTime = Math.floor(Date.now() / 1000) + 1
  const pathParts = c.req.path.split('/')
  const bucketKey = pathParts[2] ?? 'global'
  const bucket = `mock-${c.req.method.toLowerCase()}-${bucketKey}`

  c.header('X-RateLimit-Limit', '5')
  c.header('X-RateLimit-Remaining', '4')
  c.header('X-RateLimit-Reset', resetTime.toString())
  c.header('X-RateLimit-Reset-After', '1.000')
  c.header('X-RateLimit-Bucket', bucket)
  c.header('X-RateLimit-Scope', 'user')
}
