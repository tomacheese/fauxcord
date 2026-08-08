/**
 * @file spec-contract.test.ts
 * @description Contract tests that validate Fauxcord's mock responses against the
 * committed Discord OpenAPI spec snapshot (`spec/openapi.json`).
 *
 * These tests use Ajv (JSON Schema 2020-12 mode) to compile and validate the
 * response schema for every declared success branch in `spec/manifest.ts`.
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

import { describe, it, expect } from 'vitest'
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

import { createContractFixture, createFullTestApp } from './test-helpers'
import { MANIFEST } from '../spec/manifest'
import type { SpecEndpoint, SpecSuccessBranch } from '../spec/manifest'
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

// ── Contract tests ────────────────────────────────────────────────────────────

describe('Discord spec contract tests', () => {
  for (const entry of MANIFEST) {
    for (const branch of entry.successBranches) {
      const label = `${entry.method.toUpperCase()} ${entry.specPath} ${branch.status}`

      it(label, async () => {
        const context = createFullTestApp()
        try {
          const fixture = await entry.createFixture({
            create: () => Promise.resolve(createContractFixture(context.db)),
          })
          const { path, init } = branch.request(fixture)
          const headers = new Headers(init?.headers)
          if (entry.authentication === 'bot') {
            headers.set('Authorization', fixture.token)
          } else if (entry.authentication === 'bearer') {
            headers.set('Authorization', `Bearer ${fixture.bearerToken}`)
          }
          const res = await context.app.request(path, { ...init, headers })

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
        } finally {
          context.cleanup()
        }
      })
    }
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
