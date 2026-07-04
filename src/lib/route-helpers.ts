/**
 * Shared route helpers
 *
 * Small utilities reused across route handlers to remove duplicated
 * 404-lookup and limit-query-parsing boilerplate.
 */

import type { Context } from 'hono'
import { discordError } from '../errors'

/**
 * Looks up an entity and returns a 404 Discord-error Response if not found.
 * Callers must check `if (result instanceof Response) return result` before
 * using the value.
 * @param c - Hono context, used to build the 404 response
 * @param entity - Result of the lookup (null/undefined if not found)
 * @param errorCode - Discord error code to report on 404
 * @param message - Discord error message to report on 404
 * @returns The entity if found; otherwise a Response representing the 404 body
 */
export function requireEntity<T>(
  c: Context,
  entity: T | undefined | null,
  errorCode: number,
  message: string
): T | Response {
  if (entity === undefined || entity === null) {
    const err = discordError(errorCode, message, 404)
    return c.json(err.body, 404)
  }
  return entity
}

/**
 * Parses and clamps a `limit` query parameter. Mirrors the exact parsing
 * behavior every route used before this helper existed: no NaN guard is
 * added, so an invalid (non-numeric) `limit` value still flows through as
 * `NaN`, matching prior behavior.
 * @param c - Hono context
 * @param defaultValue - Value used when the query parameter is absent
 * @param max - Upper bound to clamp to
 * @returns The parsed, clamped limit
 */
export function parseLimitQuery(
  c: Context,
  defaultValue: number,
  max: number
): number {
  const raw = c.req.query('limit') ?? String(defaultValue)
  return Math.min(Number.parseInt(raw, 10), max)
}
