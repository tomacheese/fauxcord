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

// ajv-formats exports a CJS function via module.exports; use createRequire for
// NodeNext-compatible interop without type errors.
const _require = createRequire(import.meta.url)
const addFormats = _require('ajv-formats') as (
  ajv: InstanceType<typeof Ajv2020>
) => void

import { createFullTestApp } from './test-helpers'
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
  seedBan,
  seedApplicationCommand,
  seedInteraction,
} from './test-helpers'
import { getContractTestedEntries, MANIFEST } from '../spec/manifest'
import type {
  ContractFixture,
  SpecEndpoint,
  SpecSuccessBranch,
} from '../spec/manifest'
import type { Database } from './db'
import type { Hono } from 'hono'
import type { AppEnv } from './middleware/auth'
import '../spec/manifest.test'

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

/**
 * Derives the response schema name from the spec for a given path and method.
 * Returns the `responseSchemaOverride` from the manifest entry if set,
 * otherwise extracts the `$ref` name from the operation's 2xx response.
 * @param entry - Manifest entry.
 * @returns Schema name, or null if no schema is found.
 */
function getResponseSchema(
  entry: SpecEndpoint,
  branch: SpecSuccessBranch
): unknown {
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

  const schema =
    operation.responses?.[String(branch.status)]?.content?.['application/json']
      ?.schema
  if (!schema) return null
  const escapedPath = entry.specPath.replaceAll('~', '~0').replaceAll('/', '~1')
  return {
    $ref:
      `https://discord.com/spec#/paths/${escapedPath}/${entry.method}` +
      `/responses/${branch.status}/content/application~1json/schema`,
  }
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
  // Real Discord always has the bot itself as a member of any guild it is
  // in (see setupTestEnvironment's equivalent insert); needed for the
  // PATCH /guilds/{guild_id}/members/@me contract test below.
  db.prepare(
    'INSERT OR IGNORE INTO guild_members (guild_id, user_id) VALUES (?, ?)'
  ).run(guildId, BOT_USER_ID)

  const memberId = seedMember(db, guildId)
  const emojiId = seedEmoji(db, guildId, BOT_USER_ID)
  const inviteCode = seedInvite(db, channelId, guildId, BOT_USER_ID)
  // A separate invite consumed only by the destructive DELETE contract test.
  // Must use an explicit, distinct code: seedInvite's default code is the
  // same for every call, and INSERT OR REPLACE would silently overwrite the
  // GET fixture above (inviteCode) with this row, making DELETE destroy data
  // the GET tests still depend on.
  const deletableInviteCode = seedInvite(
    db,
    channelId,
    guildId,
    BOT_USER_ID,
    'deletablecode'
  )
  const bannedUserId = seedBan(db, guildId, undefined, 'Contract test ban')

  // Seed an archived public thread (type 11) with the bot as a member so the
  // thread-member and archived-list contract tests have data to validate.
  const threadId = '888888888888888888'
  db.prepare(
    `INSERT INTO channels
       (id, guild_id, type, name, parent_id, owner_id, archived,
        auto_archive_duration, archive_timestamp)
     VALUES (?, ?, 11, 'contract-thread', ?, ?, 1, 1440, datetime('now'))`
  ).run(threadId, guildId, channelId, BOT_USER_ID)
  db.prepare(
    'INSERT INTO thread_members (thread_id, user_id) VALUES (?, ?)'
  ).run(threadId, BOT_USER_ID)

  // Seed application commands (global + guild-scoped) and an interaction for
  // the Application Commands / Interactions contract tests.
  const commandId = seedApplicationCommand(db, BOT_USER_ID, null, 'contractcmd')
  const guildCommandId = seedApplicationCommand(
    db,
    BOT_USER_ID,
    guildId,
    'guildcontractcmd'
  )
  const { interactionId, interactionToken } = seedInteraction(
    db,
    BOT_USER_ID,
    channelId,
    memberId,
    guildCommandId
  )

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
    deletableInviteCode,
    bannedUserId,
    threadId,
    commandId,
    guildCommandId,
    interactionId,
    interactionToken,
    deletableMessageId: messageId,
    deletableOriginalWebhookMessageId: webhookMessageId,
    deletableEntitlementId: '999999999999999991',
    deletableLobbyId: '999999999999999992',
  }
})

afterAll(() => {
  db.close()
})

// ── Contract tests ────────────────────────────────────────────────────────────

describe('Discord spec contract tests', () => {
  const contractEntries = getContractTestedEntries()

  for (const entry of contractEntries) {
    const label = `${entry.method.toUpperCase()} ${entry.specPath}`
    const branch = entry.successBranches[0]

    it(label, async () => {
      const { path, init } = branch.request(fixture)
      const headers: Record<string, string> = {
        Authorization: fixture.token,
        ...(init?.headers as Record<string, string> | undefined),
      }
      const res = await app.request(path, { ...init, headers })

      expect(
        res.status,
        `Expected ${branch.status} but got ${res.status} for ${label}`
      ).toBe(branch.status)

      if (branch.body !== 'json') return

      const responseSchema = getResponseSchema(entry, branch)
      expect(
        responseSchema,
        `No response schema found for ${label}.`
      ).toBeTruthy()
      if (!responseSchema) return

      const body: unknown = await res.json()
      const validate = ajv.compile(responseSchema)
      if (!validate(body)) {
        throw new Error(
          `Schema validation failed for ${label}:\n` +
            JSON.stringify(validate.errors, null, 2)
        )
      }
    })
  }
})

describe('manifest coverage for Issue #136 endpoints', () => {
  const newPaths = [
    '/channels/{channel_id}/messages/{message_id}/crosspost',
    '/channels/{channel_id}/followers',
    '/channels/{channel_id}/voice-status',
    '/channels/{channel_id}/recipients/{user_id}',
    '/users/@me/channels',
    '/channels/{channel_id}/polls/{message_id}/answers/{answer_id}',
    '/channels/{channel_id}/polls/{message_id}/expire',
    '/webhooks/{webhook_id}/{webhook_token}/github',
    '/webhooks/{webhook_id}/{webhook_token}/slack',
  ]

  it('has a manifest entry for every new endpoint', () => {
    for (const path of newPaths) {
      const entry = MANIFEST.find((e) => e.specPath === path)
      expect(entry, `missing manifest entry for ${path}`).toBeDefined()
    }
  })
})
