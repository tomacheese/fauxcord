/**
 * @file spec-contract.test.ts
 * @description Contract tests that validate Fauxcord's mock responses against the
 * committed Discord OpenAPI spec snapshot (`spec/openapi.json`).
 *
 * These tests use Ajv (JSON Schema 2020-12 mode) to compile and validate the
 * response schema for each endpoint listed in `spec/manifest.ts` with
 * `contractTested: true`.
 *
 * ## How the snapshot update cycle works
 *
 * 1. The weekly GitHub Actions workflow detects a diff in the upstream spec and
 *    opens an issue.
 * 2. A maintainer runs `pnpm spec:update` on a branch to update `spec/openapi.json`.
 * 3. A PR is opened; these tests re-run against the NEW snapshot, surfacing any
 *    mock responses that no longer match the updated spec.
 * 4. The maintainer fixes the mock (or adds a justified skip in `spec/skip.ts`)
 *    until all tests pass, then merges.
 *
 * ## Ajv configuration
 *
 * - Ajv v8 `ajv/dist/2020` — required for OpenAPI 3.1 (JSON Schema 2020-12).
 * - `strict: false` — the Discord spec uses patterns that Ajv strict mode rejects.
 * - `allErrors: true` — report all failures, not just the first.
 * - `validateFormats: true` + ajv-formats — validate date-time, uri, etc.
 * - The entire spec is registered as a single document so `$ref` resolution is
 *   automatic without external dereferencers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { createRequire } from 'node:module'
import type { ValidateFunction } from 'ajv'

// ajv-formats exports a CJS function via module.exports; use createRequire for
// NodeNext-compatible interop without type errors.
const _require = createRequire(import.meta.url)
const addFormats = _require('ajv-formats') as (
  ajv: InstanceType<typeof Ajv2020>
) => void

import { createFullTestApp } from './test-helpers.js'
import {
  seedBot,
  seedGuild,
  seedChannel,
  seedMessage,
  seedWebhook,
  seedRole,
  seedMember,
  seedEmoji,
  seedInvite,
} from './test-helpers.js'
import { getContractTestedEntries } from '../spec/manifest.js'
import type { ContractFixture, SpecEndpoint } from '../spec/manifest.js'
import { SKIP_LIST } from '../spec/skip.js'
import type { Database } from './db.js'
import type { Hono } from 'hono'
import type { AppEnv } from './middleware/auth.js'

// ── Ajv setup ────────────────────────────────────────────────────────────────

/** Full Discord OpenAPI spec (committed snapshot) */
const SPEC_PATH = path.resolve(process.cwd(), 'spec/openapi.json')

/** Parsed OpenAPI spec object */
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  components: { schemas: Record<string, unknown> }
  paths: Record<string, unknown>
}

/** Ajv instance configured for JSON Schema 2020-12 (OpenAPI 3.1 format) */
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: true,
})
addFormats(ajv)

// Register the entire spec document so internal $ref resolution works without
// a separate dereference step. Ajv resolves "#/components/schemas/Foo" automatically.
ajv.addSchema(spec, 'https://discord.com/spec')

/** Cache of compiled validators keyed by schema name */
const validatorCache = new Map<string, ValidateFunction>()

/**
 * Returns a compiled Ajv validator for a named schema component.
 * Results are cached so each schema is compiled only once.
 * @param schemaName - Component schema name (e.g. "MessageResponse").
 * @returns Compiled validator function.
 */
function getValidator(schemaName: string): ValidateFunction {
  const cached = validatorCache.get(schemaName)
  if (cached) {
    return cached
  }
  const validate = ajv.compile({
    $ref: `https://discord.com/spec#/components/schemas/${schemaName}`,
  })
  validatorCache.set(schemaName, validate)
  return validate
}

/**
 * Derives the response schema name from the spec for a given path and method.
 * Returns the `responseSchemaOverride` from the manifest entry if set,
 * otherwise extracts the `$ref` name from the operation's 2xx response.
 * @param entry - Manifest entry.
 * @returns Schema name, or null if no schema is found.
 */
function getResponseSchemaName(entry: SpecEndpoint): string | null {
  if (entry.responseSchemaOverride) {
    return entry.responseSchemaOverride
  }

  // Derive from spec paths
  interface OperationType {
    responses?: Record<
      string,
      {
        content?: Record<
          string,
          { schema?: { $ref?: string; items?: { $ref?: string } } }
        >
      }
    >
  }
  const specPaths = spec.paths as Record<
    string,
    Record<string, OperationType> | undefined
  >
  const pathObj = specPaths[entry.specPath]
  if (!pathObj) return null
  const operation = pathObj[entry.method] as OperationType | undefined
  if (!operation) return null

  for (const status of ['200', '201']) {
    const schema =
      operation.responses?.[status]?.content?.['application/json']?.schema
    if (!schema) continue
    if (schema.$ref) {
      return schema.$ref.split('/').pop() ?? null
    }
    // Array responses: validate each item
    if (schema.items?.$ref) {
      return schema.items.$ref.split('/').pop() ?? null
    }
  }
  return null
}

/**
 * Determines whether a response body is an array type in the spec.
 * @param entry - Manifest entry.
 * @returns true if the spec declares the success response as an array.
 */
function isArrayResponse(entry: SpecEndpoint): boolean {
  // These overrides are for items of an array response
  const arrayOverrides = new Set([
    // channels/guilds that return arrays validated per-item
    'GuildChannelResponse', // array of channels
    'MyGuildResponse', // array of guilds
    'UserResponse', // reactions list
    'GuildMemberResponse', // members list (when used as override)
  ])

  if (
    entry.responseSchemaOverride &&
    arrayOverrides.has(entry.responseSchemaOverride)
  ) {
    // Only treat as array for endpoints that actually return arrays
    const arrayEndpoints = new Set([
      '/guilds/{guild_id}/channels|get',
      '/users/@me/guilds|get',
      '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}|get',
      '/guilds/{guild_id}/members|get',
    ])
    return arrayEndpoints.has(`${entry.specPath}|${entry.method}`)
  }

  // Check spec directly
  interface ArrayCheckOperation {
    responses?: Record<
      string,
      { content?: Record<string, { schema?: { type?: string | string[] } }> }
    >
  }
  const specPaths2 = spec.paths as Record<
    string,
    Record<string, ArrayCheckOperation> | undefined
  >
  const pathObj2 = specPaths2[entry.specPath]
  if (!pathObj2) return false
  const operation = pathObj2[entry.method] as ArrayCheckOperation | undefined
  if (!operation) return false

  for (const status of ['200', '201']) {
    const schema =
      operation.responses?.[status]?.content?.['application/json']?.schema
    if (schema) {
      const t = schema.type
      if (t === 'array' || (Array.isArray(t) && t.includes('array'))) {
        return true
      }
    }
  }
  return false
}

// ── Test fixture ─────────────────────────────────────────────────────────────

/** Shared database and app for all contract tests */
let db: Database
let app: Hono<AppEnv>

/** The seeded fixture IDs used by all manifest request builders */
let fixture: ContractFixture

beforeAll(() => {
  ;({ db, app } = createFullTestApp())

  const token = 'Bot contract-test-token'
  const BOT_USER_ID = '555555555555555555'

  // seedBot returns the token, not the userId; capture userId separately
  seedBot(db, token, BOT_USER_ID)
  const guildId = seedGuild(db, token, '666666666666666666')

  // Seed the @everyone role (same as setupTestEnvironment does).
  // This ensures GET /guilds/{guild_id}/roles returns a valid GuildRoleResponse array.
  db.prepare(
    `INSERT OR IGNORE INTO roles (id, guild_id, name, permissions, position, color, hoist, mentionable)
     VALUES (?, ?, '@everyone', '1071698660929', 0, 0, 0, 0)`
  ).run(guildId, guildId)

  const channelId = seedChannel(db, guildId, '777777777777777777')

  // Seed a webhook so webhook-token routes work
  const { webhookId, webhookToken } = seedWebhook(db, channelId, guildId)

  // Seed a webhook user so that the webhook's messages have a valid author
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, 'WebhookUser', '0000', 1)"
  ).run(webhookId)

  // Seed a bot-authored message for GET/PATCH on channel message endpoints.
  // The bot must own the message to be able to edit it (403 otherwise).
  const messageId = seedMessage(db, channelId, BOT_USER_ID, token)

  // Seed a separate webhook-authored message for GET/PATCH on webhook message endpoints.
  const webhookMessageId = seedMessage(db, channelId, webhookId, 'webhook')

  const roleId = seedRole(db, guildId)
  const memberId = seedMember(db, guildId)
  const emojiId = seedEmoji(db, guildId, BOT_USER_ID)
  const inviteCode = seedInvite(db, channelId, guildId, BOT_USER_ID)

  fixture = {
    token,
    userId: BOT_USER_ID,
    guildId,
    channelId,
    messageId,
    webhookMessageId,
    webhookId,
    webhookToken,
    roleId,
    memberId,
    emojiId,
    inviteCode,
  }
})

afterAll(() => {
  db.close()
})

// ── Contract tests ────────────────────────────────────────────────────────────

/**
 * Checks whether an entry is in the skip list.
 * @param entry - Manifest entry to check.
 * @returns true if the entry should be skipped.
 */
function isSkipped(entry: SpecEndpoint): boolean {
  return SKIP_LIST.some(
    (s) => s.specPath === entry.specPath && s.method === entry.method
  )
}

describe('Discord spec contract tests', () => {
  const contractEntries = getContractTestedEntries()

  for (const entry of contractEntries) {
    const label = `${entry.method.toUpperCase()} ${entry.specPath}`

    it(label, async () => {
      if (isSkipped(entry)) {
        console.log(`[SKIP] ${label} — see spec/skip.ts`)
        return
      }

      const schemaName = getResponseSchemaName(entry)
      expect(
        schemaName,
        `No schema name found for ${label}. Add responseSchemaOverride to the manifest entry.`
      ).toBeTruthy()
      // Early return narrows schemaName to string for TypeScript (the expect above throws on null).
      if (!schemaName) return

      const { path, init } = entry.request(fixture)
      const headers: Record<string, string> = {
        Authorization: fixture.token,
        ...(init?.headers as Record<string, string> | undefined),
      }
      const res = await app.request(path, { ...init, headers })

      expect(
        res.status,
        `Expected ${entry.successStatus} but got ${res.status} for ${label}`
      ).toBe(entry.successStatus)

      // 204 responses have no body — nothing to validate
      if (entry.successStatus === 204) return

      const body: unknown = await res.json()

      const validate = getValidator(schemaName)
      const isArray = isArrayResponse(entry)

      if (isArray) {
        // Validate each item in the array individually
        expect(
          Array.isArray(body),
          `Expected array response for ${label}`
        ).toBe(true)
        for (const [i, item] of (body as unknown[]).entries()) {
          const valid = validate(item)
          if (!valid) {
            throw new Error(
              `Schema validation failed for ${label} item[${i}]:\n` +
                JSON.stringify(validate.errors, null, 2)
            )
          }
        }
      } else {
        const valid = validate(body)
        if (!valid) {
          throw new Error(
            `Schema validation failed for ${label}:\n` +
              JSON.stringify(validate.errors, null, 2)
          )
        }
      }
    })
  }
})
