/** Application profile, asset, emoji, entitlement, and role metadata routes. */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import type { AppEnv } from '../middleware/auth'
import {
  consumeEntitlement,
  createApplicationEmoji,
  createEntitlement,
  deleteApplicationEmoji,
  deleteEntitlement,
  getActivityInstance,
  getApplication,
  getApplicationEmoji,
  getEntitlement,
  getRoleConnectionMetadata,
  listApplicationEmojis,
  listEntitlements,
  replaceRoleConnectionMetadata,
  saveApplicationAttachment,
  updateApplication,
  updateApplicationEmoji,
  type EntitlementCreatePayload,
  type RoleConnectionMetadataItem,
} from '../services/applications'
import { parseJsonBody } from '../lib/route-helpers'

const UNKNOWN_APPLICATION = 10_002
const UNKNOWN_ENTITLEMENT = 10_029
const SNOWFLAKE_PATTERN = /^(0|[1-9]\d*)$/

/** Returns a validation error field entry. */
function fieldError(message: string): {
  _errors: { code: string; message: string }[]
} {
  return {
    _errors: [{ code: 'BASE_TYPE_BAD_LENGTH', message }],
  }
}

/** Returns a Discord-compatible unknown application response. */
function unknownApplication(c: Context<AppEnv>): Response {
  return c.json(
    discordError(UNKNOWN_APPLICATION, 'Unknown Application', 404).body,
    404
  )
}

/** Returns a Discord-compatible unknown emoji response. */
function unknownEmoji(c: Context<AppEnv>): Response {
  return c.json(
    discordError(DiscordErrorCode.UNKNOWN_EMOJI, 'Unknown Emoji', 404).body,
    404
  )
}

/** Returns a Discord-compatible unknown entitlement response. */
function unknownEntitlement(c: Context<AppEnv>): Response {
  return c.json(
    discordError(UNKNOWN_ENTITLEMENT, 'Unknown Entitlement', 404).body,
    404
  )
}

/** Validates a path snowflake and returns an HTTP response on failure. */
function validateSnowflake(
  c: Context<AppEnv>,
  field: string,
  value: string
): Response | undefined {
  if (SNOWFLAKE_PATTERN.test(value)) return undefined
  return c.json(
    validationError({ [field]: fieldError('Value is not a valid snowflake.') })
      .body,
    400
  )
}

/** Requires the authenticated principal to own the requested application. */
function requireApplicationAccess(
  c: Context<AppEnv>,
  db: Database,
  applicationId: string,
  requiredScope?: string
): Response | undefined {
  const bot = c.get('bot')
  if (bot?.user_id === applicationId) return undefined

  const accessToken = c.get('accessToken')
  if (accessToken) {
    const row = db
      .prepare('SELECT client_id FROM oauth2_access_tokens WHERE token = ?')
      .get(accessToken.token) as { client_id: string } | undefined
    const scopes = new Set(accessToken.scope.split(' ').filter(Boolean))
    if (
      row?.client_id === applicationId &&
      (!requiredScope || scopes.has(requiredScope))
    ) {
      return undefined
    }
  }

  return c.json(
    discordError(DiscordErrorCode.MISSING_ACCESS, 'Missing Access', 403).body,
    403
  )
}

/** Validates the mutable application profile fields used by the mock. */
function validateApplicationUpdate(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const errors: Record<string, unknown> = {}
  const description = payload.description
  if (
    description !== undefined &&
    description !== null &&
    (typeof description !== 'object' ||
      typeof (description as { default?: unknown }).default !== 'string' ||
      (description as { default: string }).default.length > 400)
  ) {
    errors.description = fieldError(
      'Description must contain a default string.'
    )
  }
  const tags = payload.tags
  if (
    tags !== undefined &&
    tags !== null &&
    (!Array.isArray(tags) ||
      tags.length > 5 ||
      tags.some((tag) => typeof tag !== 'string' || tag.length > 20) ||
      new Set(tags).size !== tags.length)
  ) {
    errors.tags = fieldError('Tags must contain up to 5 unique strings.')
  }
  const maxParticipants = payload.max_participants
  if (
    maxParticipants !== undefined &&
    maxParticipants !== null &&
    (!Number.isSafeInteger(maxParticipants) || (maxParticipants as number) < -1)
  ) {
    errors.max_participants = fieldError(
      'Max participants must be an integer greater than or equal to -1.'
    )
  }
  return errors
}

/** Validates an application emoji name. */
function validateEmojiName(name: unknown): boolean {
  return typeof name === 'string' && name.length >= 2 && name.length <= 32
}

/** Parses a boolean query value without accepting arbitrary truthy strings. */
function parseBooleanQuery(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/** Validates one application role connection metadata item. */
function validateMetadataItem(
  item: unknown
): item is RoleConnectionMetadataItem {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const value = item as Record<string, unknown>
  return (
    Number.isSafeInteger(value.type) &&
    (value.type as number) >= 1 &&
    (value.type as number) <= 8 &&
    typeof value.key === 'string' &&
    value.key.length > 0 &&
    value.key.length <= 50 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name.length <= 100 &&
    typeof value.description === 'string' &&
    value.description.length > 0 &&
    value.description.length <= 200
  )
}

/** Creates the application-domain API router. */
export function createApplicationRoutes(
  db: Database,
  baseUrl: string,
  uploadPath = '/data/uploads'
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.patch('/applications/@me', async (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    const payload = await parseJsonBody(c)
    const errors = validateApplicationUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }
    const application = updateApplication(db, bot.user_id, payload)
    return application ? c.json(application) : unknownApplication(c)
  })

  app.get('/applications/:applicationId', (c) => {
    const { applicationId } = c.req.param()
    const invalid = validateSnowflake(c, 'application_id', applicationId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    const application = getApplication(db, applicationId)
    return application ? c.json(application) : unknownApplication(c)
  })

  app.patch('/applications/:applicationId', async (c) => {
    const { applicationId } = c.req.param()
    const invalid = validateSnowflake(c, 'application_id', applicationId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    const payload = await parseJsonBody(c)
    const errors = validateApplicationUpdate(payload)
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }
    const application = updateApplication(db, applicationId, payload)
    return application ? c.json(application) : unknownApplication(c)
  })

  app.get(
    '/applications/:applicationId/activity-instances/:instanceId',
    (c) => {
      const { applicationId, instanceId } = c.req.param()
      const invalid = validateSnowflake(c, 'application_id', applicationId)
      if (invalid) return invalid
      const denied = requireApplicationAccess(c, db, applicationId)
      if (denied) return denied
      const instance = getActivityInstance(db, applicationId, instanceId)
      return instance ? c.json(instance) : unknownApplication(c)
    }
  )

  app.post('/applications/:applicationId/attachment', async (c) => {
    const { applicationId } = c.req.param()
    const invalid = validateSnowflake(c, 'application_id', applicationId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    if (!getApplication(db, applicationId)) return unknownApplication(c)
    const contentType = c.req.header('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      return c.json(
        validationError({ file: fieldError('A multipart file is required.') })
          .body,
        400
      )
    }
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return c.json(
        validationError({ file: fieldError('A multipart file is required.') })
          .body,
        400
      )
    }
    const attachment = await saveApplicationAttachment(
      uploadPath,
      baseUrl,
      applicationId,
      file.name,
      file.type || 'application/octet-stream',
      await file.arrayBuffer()
    )
    return c.json({ attachment })
  })

  app.get('/applications/:applicationId/emojis', (c) => {
    const { applicationId } = c.req.param()
    const invalid = validateSnowflake(c, 'application_id', applicationId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    if (!getApplication(db, applicationId)) return unknownApplication(c)
    return c.json({ items: listApplicationEmojis(db, applicationId) })
  })

  app.post('/applications/:applicationId/emojis', async (c) => {
    const { applicationId } = c.req.param()
    const invalid = validateSnowflake(c, 'application_id', applicationId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    if (!getApplication(db, applicationId)) return unknownApplication(c)
    const payload = await parseJsonBody(c)
    const errors: Record<string, unknown> = {}
    if (!validateEmojiName(payload.name)) {
      errors.name = fieldError('Name must be between 2 and 32 characters.')
    }
    if (typeof payload.image !== 'string' || payload.image.length === 0) {
      errors.image = fieldError('Image is required.')
    }
    if (Object.keys(errors).length > 0) {
      return c.json(validationError(errors).body, 400)
    }
    const bot = c.get('bot')
    const accessToken = c.get('accessToken')
    const userId = bot?.user_id ?? accessToken?.user_id
    if (!userId) {
      return c.json(
        discordError(DiscordErrorCode.MISSING_ACCESS, 'Missing Access', 403)
          .body,
        403
      )
    }
    return c.json(
      createApplicationEmoji(db, applicationId, userId, payload.name as string),
      201
    )
  })

  app.get('/applications/:applicationId/emojis/:emojiId', (c) => {
    const { applicationId, emojiId } = c.req.param()
    const invalid =
      validateSnowflake(c, 'application_id', applicationId) ??
      validateSnowflake(c, 'emoji_id', emojiId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    const emoji = getApplicationEmoji(db, applicationId, emojiId)
    return emoji ? c.json(emoji) : unknownEmoji(c)
  })

  app.patch('/applications/:applicationId/emojis/:emojiId', async (c) => {
    const { applicationId, emojiId } = c.req.param()
    const invalid =
      validateSnowflake(c, 'application_id', applicationId) ??
      validateSnowflake(c, 'emoji_id', emojiId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    const payload = await parseJsonBody(c)
    if (!validateEmojiName(payload.name)) {
      return c.json(
        validationError({
          name: fieldError('Name must be between 2 and 32 characters.'),
        }).body,
        400
      )
    }
    const emoji = updateApplicationEmoji(
      db,
      applicationId,
      emojiId,
      payload.name as string
    )
    return emoji ? c.json(emoji) : unknownEmoji(c)
  })

  app.delete('/applications/:applicationId/emojis/:emojiId', (c) => {
    const { applicationId, emojiId } = c.req.param()
    const invalid =
      validateSnowflake(c, 'application_id', applicationId) ??
      validateSnowflake(c, 'emoji_id', emojiId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    return deleteApplicationEmoji(db, applicationId, emojiId)
      ? c.body(null, 204)
      : unknownEmoji(c)
  })

  app.get('/applications/:applicationId/entitlements', (c) => {
    const { applicationId } = c.req.param()
    const invalid = validateSnowflake(c, 'application_id', applicationId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(
      c,
      db,
      applicationId,
      'applications.entitlements'
    )
    if (denied) return denied
    if (!getApplication(db, applicationId)) return unknownApplication(c)
    const limitRaw = c.req.query('limit')
    const limit = limitRaw === undefined ? 100 : Number(limitRaw)
    const booleanKeys = [
      'exclude_ended',
      'exclude_deleted',
      'only_active',
    ] as const
    const booleans = Object.fromEntries(
      booleanKeys.map((key) => [key, parseBooleanQuery(c.req.query(key))])
    ) as Record<(typeof booleanKeys)[number], boolean | undefined>
    const invalidBoolean = booleanKeys.find(
      (key) => c.req.query(key) !== undefined && booleans[key] === undefined
    )
    if (
      invalidBoolean ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(limit)
    ) {
      return c.json(
        validationError({
          [invalidBoolean ?? 'limit']: fieldError('Invalid query value.'),
        }).body,
        400
      )
    }
    const skuIds = (c.req.queries('sku_ids') ?? [])
      .flatMap((value) => value.split(','))
      .filter(Boolean)
    if (
      skuIds.length > 100 ||
      skuIds.some((id) => !SNOWFLAKE_PATTERN.test(id))
    ) {
      return c.json(
        validationError({ sku_ids: fieldError('Invalid SKU IDs.') }).body,
        400
      )
    }
    const snowflakeQueries = [
      ['user_id', c.req.query('user_id')],
      ['guild_id', c.req.query('guild_id')],
      ['before', c.req.query('before')],
      ['after', c.req.query('after')],
    ] as const
    const invalidSnowflake = snowflakeQueries.find(
      ([, value]) => value !== undefined && !SNOWFLAKE_PATTERN.test(value)
    )
    if (invalidSnowflake) {
      return c.json(
        validationError({
          [invalidSnowflake[0]]: fieldError('Invalid snowflake query value.'),
        }).body,
        400
      )
    }
    return c.json(
      listEntitlements(db, applicationId, {
        userId: c.req.query('user_id'),
        skuIds,
        guildId: c.req.query('guild_id'),
        before: c.req.query('before'),
        after: c.req.query('after'),
        limit,
        excludeEnded: booleans.exclude_ended,
        excludeDeleted: booleans.exclude_deleted,
        onlyActive: booleans.only_active,
      })
    )
  })

  app.post('/applications/:applicationId/entitlements', async (c) => {
    const { applicationId } = c.req.param()
    const invalid = validateSnowflake(c, 'application_id', applicationId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    if (!getApplication(db, applicationId)) return unknownApplication(c)
    const payload = await parseJsonBody(c)
    if (
      typeof payload.sku_id !== 'string' ||
      !SNOWFLAKE_PATTERN.test(payload.sku_id) ||
      typeof payload.owner_id !== 'string' ||
      !SNOWFLAKE_PATTERN.test(payload.owner_id) ||
      (payload.owner_type !== 1 && payload.owner_type !== 2)
    ) {
      return c.json(
        validationError({
          sku_id: fieldError('A valid SKU ID is required.'),
          owner_id: fieldError('A valid owner ID is required.'),
          owner_type: fieldError('Owner type must be 1 or 2.'),
        }).body,
        400
      )
    }
    const entitlement = createEntitlement(
      db,
      applicationId,
      payload as unknown as EntitlementCreatePayload
    )
    return entitlement ? c.json(entitlement) : unknownEntitlement(c)
  })

  app.get('/applications/:applicationId/entitlements/:entitlementId', (c) => {
    const { applicationId, entitlementId } = c.req.param()
    const invalid =
      validateSnowflake(c, 'application_id', applicationId) ??
      validateSnowflake(c, 'entitlement_id', entitlementId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(
      c,
      db,
      applicationId,
      'applications.entitlements'
    )
    if (denied) return denied
    const entitlement = getEntitlement(db, applicationId, entitlementId)
    return entitlement ? c.json(entitlement) : unknownEntitlement(c)
  })

  app.delete(
    '/applications/:applicationId/entitlements/:entitlementId',
    (c) => {
      const { applicationId, entitlementId } = c.req.param()
      const invalid =
        validateSnowflake(c, 'application_id', applicationId) ??
        validateSnowflake(c, 'entitlement_id', entitlementId)
      if (invalid) return invalid
      const denied = requireApplicationAccess(
        c,
        db,
        applicationId,
        'applications.entitlements'
      )
      if (denied) return denied
      return deleteEntitlement(db, applicationId, entitlementId)
        ? c.body(null, 204)
        : unknownEntitlement(c)
    }
  )

  app.post(
    '/applications/:applicationId/entitlements/:entitlementId/consume',
    (c) => {
      const { applicationId, entitlementId } = c.req.param()
      const invalid =
        validateSnowflake(c, 'application_id', applicationId) ??
        validateSnowflake(c, 'entitlement_id', entitlementId)
      if (invalid) return invalid
      const denied = requireApplicationAccess(
        c,
        db,
        applicationId,
        'applications.entitlements'
      )
      if (denied) return denied
      return consumeEntitlement(db, applicationId, entitlementId)
        ? c.body(null, 204)
        : unknownEntitlement(c)
    }
  )

  app.get('/applications/:applicationId/role-connections/metadata', (c) => {
    const { applicationId } = c.req.param()
    const invalid = validateSnowflake(c, 'application_id', applicationId)
    if (invalid) return invalid
    const denied = requireApplicationAccess(c, db, applicationId)
    if (denied) return denied
    if (!getApplication(db, applicationId)) return unknownApplication(c)
    return c.json(getRoleConnectionMetadata(db, applicationId))
  })

  app.put(
    '/applications/:applicationId/role-connections/metadata',
    async (c) => {
      const { applicationId } = c.req.param()
      const invalid = validateSnowflake(c, 'application_id', applicationId)
      if (invalid) return invalid
      const denied = requireApplicationAccess(c, db, applicationId)
      if (denied) return denied
      if (!getApplication(db, applicationId)) return unknownApplication(c)
      const payload: unknown = await c.req.json().catch(() => undefined)
      const metadata = payload === null ? [] : payload
      if (
        !Array.isArray(metadata) ||
        metadata.length > 5 ||
        metadata.some((item) => !validateMetadataItem(item)) ||
        new Set(
          metadata.map((item) => (item as RoleConnectionMetadataItem).key)
        ).size !== metadata.length
      ) {
        return c.json(
          validationError({
            metadata: fieldError('Invalid role connection metadata.'),
          }).body,
          400
        )
      }
      return c.json(
        replaceRoleConnectionMetadata(
          db,
          applicationId,
          metadata as RoleConnectionMetadataItem[]
        )
      )
    }
  )

  return app
}
