/**
 * Dummy rate limit header middleware
 *
 * Adds Discord API-compatible rate limit headers to all responses.
 * The mock server does not actually perform rate limiting.
 */

import type { Context, Next } from 'hono'

/**
 * Returns a middleware that adds dummy rate limit headers.
 */
export const rateLimitMiddleware = async (
  c: Context,
  next: Next
): Promise<void> => {
  await next()

  const resetTime = Math.floor(Date.now() / 1000) + 1

  // Normalize /api/v10/channels/xxx → /channels/xxx and /api/channels/xxx → /channels/xxx
  // so the same bucket ID is generated regardless of the prefix
  let normalizedPath = c.req.path
  if (normalizedPath.startsWith('/api/v10/')) {
    normalizedPath = normalizedPath.slice(8) // Strip "/api/v10"
  } else if (normalizedPath.startsWith('/api/')) {
    normalizedPath = normalizedPath.slice(4) // Strip "/api"
  }
  const pathParts = normalizedPath.split('/')
  const bucketKey = pathParts[1] ?? 'global'
  const bucket = `mock-${c.req.method.toLowerCase()}-${bucketKey}`

  c.header('X-RateLimit-Limit', '5')
  c.header('X-RateLimit-Remaining', '4')
  c.header('X-RateLimit-Reset', resetTime.toString())
  c.header('X-RateLimit-Reset-After', '1.000')
  c.header('X-RateLimit-Bucket', bucket)
  c.header('X-RateLimit-Scope', 'user')
}
