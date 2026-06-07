/**
 * API version routing middleware
 *
 * /api/v10/ → handled as-is
 * /api/ → handled as v10
 * / → handled as v10
 * /api/v6–v9/ → 400 Bad Request
 */

import type { Context, Next } from 'hono'
import { discordError, DiscordErrorCode } from '../errors.js'

/** Pattern for unsupported API versions (blocks any version other than v10) */
const UNSUPPORTED_VERSION_PATTERN = /^\/api\/v(?!10\/)([0-9]+)\//

/**
 * Middleware that resolves the API version.
 * Requests to unsupported versions return 400.
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
