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

/**
 * Parses the request body as JSON, tolerating a missing/empty/invalid body.
 * Some real Discord library HTTP clients issue PATCH/POST requests with no
 * body at all (e.g. a no-op update); `c.req.json()` throws a raw
 * `SyntaxError` on an empty body, which must not surface as a 500. A literal
 * JSON `null` or a JSON array also parse without error but are not usable as
 * a field bag, so both fall back to an empty object as well.
 * @param c - Hono context
 * @returns the parsed body if it is a JSON object; otherwise an empty object
 */
export async function parseJsonBody(
  c: Context
): Promise<Record<string, unknown>> {
  const parsed: unknown = await c.req.json().catch(() => ({}))
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

/** Fields the mock reads from a Slack-compatible webhook payload */
export interface SlackWebhookBody {
  text?: string
  username?: string
  icon_url?: string
}

/**
 * Parses a Slack-compatible webhook request body. Slack's legacy webhook
 * format is historically sent as `application/json`,
 * `application/x-www-form-urlencoded` (with the JSON payload itself in a
 * `payload` field), or `multipart/form-data` with the same `payload`
 * field — unlike every other endpoint in the mock, which only needs to
 * accept JSON.
 * @param c - Hono context
 * @returns Parsed Slack webhook fields (empty object if the body is absent or unparsable)
 */
export async function parseSlackBody(c: Context): Promise<SlackWebhookBody> {
  const contentType = c.req.header('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return parseJsonBody(c)
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await c.req.formData()
    const raw = formData.get('payload')
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as SlackWebhookBody
      } catch {
        return {}
      }
    }
    return {}
  }

  return parseJsonBody(c)
}

/**
 * Parses a GitHub-compatible webhook request body. Real GitHub webhooks can
 * be configured to deliver as `application/json` or
 * `application/x-www-form-urlencoded` (with the JSON payload itself in a
 * `payload` field), mirroring Slack's legacy webhook format handled by
 * `parseSlackBody` above.
 * @param c - Hono context
 * @returns Parsed GitHub webhook payload (empty object if the body is absent or unparsable)
 */
export async function parseGithubBody<T>(c: Context): Promise<T> {
  const contentType = c.req.header('content-type') ?? ''

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await c.req.formData()
    const raw = formData.get('payload')
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T
      } catch {
        return {} as T
      }
    }
    return {} as T
  }

  return (await parseJsonBody(c)) as unknown as T
}
