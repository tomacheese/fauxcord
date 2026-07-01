/**
 * @file spec-diff.ts
 * @description Compares two Discord OpenAPI spec snapshots and emits a Markdown
 * diff report to stdout.
 *
 * Usage:
 *   pnpm spec:diff                      — compare spec/openapi.json vs spec/openapi.upstream.json
 *   tsx scripts/spec-diff.ts <old> <new> — compare two explicit files
 *
 * Exit codes:
 *   0 — no differences detected (or only suppressed enum-noise changes, see spec/enum-noise.ts)
 *   1 — differences detected (stdout contains the Markdown report)
 *   2 — usage error or file not found
 *
 * Report sections:
 *   1. API version change (info.version)
 *   2. Paths/methods added and removed (full list)
 *   3. For each entry in spec/manifest.ts: detailed request/response schema diff
 *   4. Summary counts for non-manifest paths that changed
 *
 * The pure diffing pipeline (`runSpecDiff` and its helpers) is exported so it
 * can be unit-tested without spawning a process; only the small bottom section
 * of this file reads `process.argv`/writes to stdout/calls `process.exit`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENUM_NOISE } from '../spec/enum-noise.js'

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A string-keyed lookup table whose values may be absent.
 * Mirrors real-world JSON, where `Record<string, T>` alone would let
 * TypeScript assume every key is present (it isn't — this is not-yet-fetched
 * upstream data, not data we control).
 */
type Lookup<T> = Record<string, T | undefined>

/** Minimal OpenAPI 3.1 document shape we care about for diffing. */
export interface OpenApiSpec {
  info: { version: string; title: string }
  paths: Lookup<Record<string, unknown>>
  components: {
    schemas: Lookup<SchemaObject>
  }
}

/** JSON Schema / OpenAPI schema node */
export interface SchemaObject {
  type?: string | string[]
  properties?: Record<string, SchemaObject>
  items?: SchemaObject
  required?: string[]
  $ref?: string
  oneOf?: SchemaObject[]
  anyOf?: SchemaObject[]
  allOf?: SchemaObject[]
  nullable?: boolean
  enum?: unknown[]
  format?: string
  description?: string
}

/** Operation object shape */
interface OperationObject {
  requestBody?: {
    content?: Lookup<{ schema?: SchemaObject }>
  }
  responses?: Lookup<{
    content?: Lookup<{ schema?: SchemaObject }>
  }>
}

/** Field-level diff result */
export interface FieldDiff {
  added: string[]
  removed: string[]
  typeChanged: { field: string; oldType: string; newType: string }[]
  /** Type changes suppressed because they are enum-addition-only noise on an allow-listed field. */
  suppressedTypeChanged: { field: string; oldType: string; newType: string }[]
}

/** Result of diffing a single manifest-registered operation. */
export interface OperationDiffResult {
  lines: string[]
  hasRealDiff: boolean
}

/** Result of running the full old-vs-new spec diff. */
export interface SpecDiffResult {
  report: string
  hasDiff: boolean
}

/** Set of `specPath|method|field` keys eligible for enum-addition-only suppression. */
const enumNoiseSet = new Set(
  ENUM_NOISE.map((e) => `${e.specPath}|${e.method}|${e.field}`)
)

/**
 * Determines whether a type-string change represents a pure enum-choice
 * addition: both sides are `oneOf(N)`/`anyOf(N)` (optionally wrapped in
 * `array<...>`), the wrapping and union kind match, and the new count is
 * strictly greater than the old count.
 * @param oldType - Old type description string.
 * @param newType - New type description string.
 * @returns true if this is a pure choice-count increase.
 */
export function isEnumAdditionOnly(
  oldType: string,
  newType: string
): boolean {
  const pattern = /^(array<)?(oneOf|anyOf)\((\d+)\)>?$/
  const oldMatch = pattern.exec(oldType)
  const newMatch = pattern.exec(newType)
  if (!oldMatch || !newMatch) return false
  const [, oldWrap, oldKind, oldCount] = oldMatch
  const [, newWrap, newKind, newCount] = newMatch
  if (oldWrap !== newWrap || oldKind !== newKind) return false
  return Number(newCount) > Number(oldCount)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Loads and parses a JSON file.
 * @param filePath - Path to the JSON file.
 * @returns Parsed object.
 */
function loadSpec(filePath: string): OpenApiSpec {
  const text = readFileSync(filePath, 'utf8')
  return JSON.parse(text) as OpenApiSpec
}

/**
 * Resolves a `$ref` reference to a schema object within the same spec document.
 * @param ref - The `$ref` string (e.g. "#/components/schemas/Foo").
 * @param spec - The full spec document.
 * @param visited - Set of refs already visited to prevent infinite recursion.
 * @returns Resolved schema object, or undefined if not found.
 */
function resolveRef(
  ref: string,
  spec: OpenApiSpec,
  visited = new Set<string>()
): SchemaObject | undefined {
  if (visited.has(ref)) return undefined
  visited.add(ref)

  if (!ref.startsWith('#/components/schemas/')) return undefined
  const name = ref.slice('#/components/schemas/'.length)
  const schema = spec.components.schemas[name]
  if (!schema) return undefined
  if (schema.$ref) return resolveRef(schema.$ref, spec, visited)
  return schema
}

/**
 * Resolves a schema node, following `$ref` if present.
 * @param schema - Schema node.
 * @param spec - Full spec document.
 * @param visited - Visited refs for cycle detection.
 * @returns Resolved schema.
 */
function resolve(
  schema: SchemaObject,
  spec: OpenApiSpec,
  visited = new Set<string>()
): SchemaObject {
  if (schema.$ref) {
    return resolveRef(schema.$ref, spec, visited) ?? schema
  }
  return schema
}

/**
 * Returns a short human-readable type description for a schema node.
 * @param schema - Schema node.
 * @param spec - Full spec document.
 * @returns Type string (e.g. "string", "integer", "array<string>", "#Ref").
 */
function describeType(schema: SchemaObject, spec: OpenApiSpec): string {
  if (schema.$ref) {
    return schema.$ref.split('/').pop() ?? schema.$ref
  }
  if (schema.oneOf) return `oneOf(${schema.oneOf.length})`
  if (schema.anyOf) return `anyOf(${schema.anyOf.length})`
  // For allOf, just return a short summary without recursing into the union branches
  if (schema.allOf) return `allOf(${schema.allOf.length})`
  if (Array.isArray(schema.type)) {
    return schema.type.join(' | ')
  }
  if (schema.type === 'array' && schema.items) {
    const resolved = schema.items.$ref
      ? (resolveRef(schema.items.$ref, spec) ?? schema.items)
      : schema.items
    return `array<${describeType(resolved, spec)}>`
  }
  return schema.type ?? 'unknown'
}

/**
 * Extracts a flat map of `{ field -> type-string }` from a schema's properties.
 * @param schema - Schema to extract from.
 * @param spec - Full spec document for $ref resolution.
 * @returns Map of field name to type description.
 */
export function extractFields(
  schema: SchemaObject,
  spec: OpenApiSpec
): Map<string, string> {
  const result = new Map<string, string>()
  const resolved = resolve(schema, spec)
  const props = resolved.properties ?? {}
  for (const [key, val] of Object.entries(props)) {
    const resolvedVal = resolve(val, spec)
    const typeStr = describeType(resolvedVal, spec)
    result.set(key, typeStr)
  }
  return result
}

/**
 * Diffs two field maps and returns added/removed/changed fields. A type
 * change is routed to `suppressedTypeChanged` instead of `typeChanged` when
 * the field is listed in spec/enum-noise.ts for this specPath/method AND the
 * change is a pure enum-choice-count increase (see isEnumAdditionOnly).
 * @param oldFields - Fields from the old spec.
 * @param newFields - Fields from the new spec.
 * @param specPath - Spec path template these fields belong to.
 * @param method - HTTP method these fields belong to.
 * @returns Diff result.
 */
export function diffFields(
  oldFields: Map<string, string>,
  newFields: Map<string, string>,
  specPath: string,
  method: string
): FieldDiff {
  const added: string[] = []
  const removed: string[] = []
  const typeChanged: { field: string; oldType: string; newType: string }[] = []
  const suppressedTypeChanged: {
    field: string
    oldType: string
    newType: string
  }[] = []

  for (const [key, newType] of newFields) {
    const oldType = oldFields.get(key)
    if (oldType === undefined) {
      added.push(`${key}: ${newType}`)
    } else if (oldType !== newType) {
      const isExempt = enumNoiseSet.has(`${specPath}|${method}|${key}`)
      if (isExempt && isEnumAdditionOnly(oldType, newType)) {
        suppressedTypeChanged.push({ field: key, oldType, newType })
      } else {
        typeChanged.push({ field: key, oldType, newType })
      }
    }
  }
  for (const [key, oldType] of oldFields) {
    if (!newFields.has(key)) {
      removed.push(`${key}: ${oldType}`)
    }
  }

  return { added, removed, typeChanged, suppressedTypeChanged }
}

/**
 * Extracts the success response schema from an operation object.
 * Returns the schema for the first 2xx status code found.
 * @param op - Operation object.
 * @returns Schema object, or undefined.
 */
export function getSuccessSchema(op: OperationObject): SchemaObject | undefined {
  const responses = op.responses ?? {}
  for (const status of ['200', '201', '204']) {
    const content = responses[status]?.content
    if (!content) continue
    const jsonContent = content['application/json']
    if (jsonContent?.schema) return jsonContent.schema
  }
  return undefined
}

/**
 * Diffs an operation's request and response schemas between old and new specs.
 * Real (non-suppressed) changes and suppressed enum-addition-only changes are
 * rendered as two separate Markdown sub-sections; only real changes count
 * toward `hasRealDiff`.
 * @param specPath - Spec path template.
 * @param method - HTTP method.
 * @param oldSpec - Old spec.
 * @param newSpec - New spec.
 * @returns Markdown lines describing the diff, and whether it contains real drift.
 */
export function diffOperation(
  specPath: string,
  method: string,
  oldSpec: OpenApiSpec,
  newSpec: OpenApiSpec
): OperationDiffResult {
  const lines: string[] = []
  const oldOp = (oldSpec.paths[specPath]?.[method] ?? {}) as OperationObject
  const newOp = (newSpec.paths[specPath]?.[method] ?? {}) as OperationObject

  // Response schema diff
  const oldRespSchema = getSuccessSchema(oldOp)
  const newRespSchema = getSuccessSchema(newOp)

  if (!oldRespSchema && !newRespSchema) return { lines, hasRealDiff: false }

  const oldFields = oldRespSchema
    ? extractFields(oldRespSchema, oldSpec)
    : new Map<string, string>()
  const newFields = newRespSchema
    ? extractFields(newRespSchema, newSpec)
    : new Map<string, string>()

  const respDiff = diffFields(oldFields, newFields, specPath, method)
  const hasRealDiff =
    respDiff.added.length > 0 ||
    respDiff.removed.length > 0 ||
    respDiff.typeChanged.length > 0

  if (!hasRealDiff && respDiff.suppressedTypeChanged.length === 0) {
    return { lines, hasRealDiff: false }
  }

  if (hasRealDiff) {
    lines.push(`#### \`${method.toUpperCase()} ${specPath}\` — response schema`)
    for (const f of respDiff.added) lines.push(`- ➕ ${f}`)
    for (const f of respDiff.removed) lines.push(`- ➖ ${f}`)
    for (const c of respDiff.typeChanged)
      lines.push(`- 🔄 \`${c.field}\`: \`${c.oldType}\` → \`${c.newType}\``)
  }

  if (respDiff.suppressedTypeChanged.length > 0) {
    lines.push(
      `#### \`${method.toUpperCase()} ${specPath}\` — 🔇 no action needed (enum choices added only)`
    )
    for (const c of respDiff.suppressedTypeChanged)
      lines.push(
        `- 🔇 \`${c.field}\`: \`${c.oldType}\` → \`${c.newType}\` _(Fauxcord always returns a fixed value for this field — see spec/enum-noise.ts)_`
      )
  }

  return { lines, hasRealDiff }
}

/**
 * Returns a canonical `path|method` key for a set of operations.
 * @param spec - OpenAPI spec.
 * @returns Set of "path|method" strings.
 */
export function getPathMethodSet(spec: OpenApiSpec): Set<string> {
  const result = new Set<string>()
  for (const [specPath, ops] of Object.entries(spec.paths)) {
    if (!ops) continue
    for (const method of Object.keys(ops)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        result.add(`${specPath}|${method}`)
      }
    }
  }
  return result
}

/**
 * Runs the full old-vs-new spec diff and produces a Markdown report.
 * Pure with respect to the process: does not read `process.argv`, does not
 * print, does not call `process.exit`.
 * @param oldSpec - Old spec document.
 * @param newSpec - New spec document.
 * @param manifestSource - Raw source text of spec/manifest.ts (parsed with a
 *   regex rather than imported, since the manifest contains function values
 *   that are impractical to load outside the app's own module graph).
 * @param oldPath - Display path for the old spec, used in the report header.
 * @param newPath - Display path for the new spec, used in the report header.
 * @returns The Markdown report text and whether real (non-suppressed) drift exists.
 */
export function runSpecDiff(
  oldSpec: OpenApiSpec,
  newSpec: OpenApiSpec,
  manifestSource: string,
  oldPath: string,
  newPath: string
): SpecDiffResult {
  // Extract specPath/method pairs by matching each MANIFEST entry block.
  // A trailing comma is required after the method value to distinguish the
  // concrete entry assignments (method: 'get',) from the TypeScript interface
  // union definition (method: 'get' | 'post' | ...) which lacks a trailing comma.
  const specPathRe = /specPath:\s*'([^']+)'/g
  const methodRe = /method:\s*'(get|post|put|patch|delete)',/g
  const spMatches = [...manifestSource.matchAll(specPathRe)]
  const mMatches = [...manifestSource.matchAll(methodRe)]

  const implementedSet = new Set<string>()
  for (let i = 0; i < Math.min(spMatches.length, mMatches.length); i++) {
    const specPath = spMatches[i][1]
    const method = mMatches[i][1]
    if (specPath && method) {
      implementedSet.add(`${specPath}|${method}`)
    }
  }

  const oldPaths = getPathMethodSet(oldSpec)
  const newPaths = getPathMethodSet(newSpec)

  // Paths/methods added in the new spec
  const added = [...newPaths].filter((k) => !oldPaths.has(k))
  // Paths/methods removed from the old spec
  const removed = [...oldPaths].filter((k) => !newPaths.has(k))
  // Paths/methods present in both (potentially changed)
  const common = [...oldPaths].filter((k) => newPaths.has(k))

  // Check for version change
  const versionChanged = oldSpec.info.version !== newSpec.info.version

  // Collect implemented endpoint diffs
  const implementedDiffs: string[] = []
  let anyImplementedRealDiff = false
  for (const key of common) {
    const [specPath, method] = key.split('|') as [string, string]
    if (!implementedSet.has(key)) continue
    const result = diffOperation(specPath, method, oldSpec, newSpec)
    implementedDiffs.push(...result.lines)
    if (result.hasRealDiff) anyImplementedRealDiff = true
  }

  // Non-implemented path changes
  const nonImplementedChanged = common.filter((k) => {
    if (implementedSet.has(k)) return false
    const [specPath, method] = k.split('|') as [string, string]
    const oldOp = (oldSpec.paths[specPath]?.[method] ?? {}) as OperationObject
    const newOp = (newSpec.paths[specPath]?.[method] ?? {}) as OperationObject
    const oldSchema = getSuccessSchema(oldOp)
    const newSchema = getSuccessSchema(newOp)
    const oldFields = oldSchema
      ? extractFields(oldSchema, oldSpec)
      : new Map<string, string>()
    const newFields = newSchema
      ? extractFields(newSchema, newSpec)
      : new Map<string, string>()
    const diff = diffFields(oldFields, newFields, specPath, method)
    return (
      diff.added.length > 0 ||
      diff.removed.length > 0 ||
      diff.typeChanged.length > 0
    )
  })

  const hasDiff =
    versionChanged ||
    added.length > 0 ||
    removed.length > 0 ||
    anyImplementedRealDiff ||
    nonImplementedChanged.length > 0

  const hasAnythingToShow =
    hasDiff || implementedDiffs.length > 0 || nonImplementedChanged.length > 0

  if (!hasAnythingToShow) {
    return {
      report: 'No differences detected between the two spec files.',
      hasDiff: false,
    }
  }

  // ── Emit Markdown report ────────────────────────────────────────────────────

  const lines: string[] = [
    '## Discord API Spec Drift Report',
    '',
    `Comparing \`${oldPath}\` → \`${newPath}\``,
    '',
  ]

  if (versionChanged) {
    lines.push(
      `### 🔖 API Version Changed`,
      '',
      `- **Old**: \`${oldSpec.info.version}\``,
      `- **New**: \`${newSpec.info.version}\``,
      ''
    )
  }

  if (added.length > 0) {
    lines.push('### ➕ Paths/Methods Added', '')
    for (const k of added.toSorted()) {
      const [specPath, method] = k.split('|') as [string, string]
      const isImpl = implementedSet.has(k)
      lines.push(
        `- \`${method.toUpperCase()} ${specPath}\`${isImpl ? '' : ' ⚠️ _not yet in mock_'}`
      )
    }
    lines.push('')
  }

  if (removed.length > 0) {
    lines.push('### ➖ Paths/Methods Removed', '')
    for (const k of removed.toSorted()) {
      const [specPath, method] = k.split('|') as [string, string]
      const isImpl = implementedSet.has(k)
      lines.push(
        `- \`${method.toUpperCase()} ${specPath}\`${isImpl ? ' ⚠️ _implemented in mock_' : ''}`
      )
    }
    lines.push('')
  }

  if (implementedDiffs.length > 0) {
    lines.push(
      '### 🔍 Implemented Endpoint Schema Changes',
      '',
      '_Detailed field-level diff for Fauxcord-implemented endpoints:_',
      '',
      ...implementedDiffs,
      ''
    )
  }

  if (nonImplementedChanged.length > 0) {
    lines.push(
      '### 📊 Other Changed Endpoints (not implemented in Fauxcord)',
      '',
      `${nonImplementedChanged.length} non-implemented endpoint(s) have schema changes:`,
      ''
    )
    for (const k of nonImplementedChanged.toSorted()) {
      const [specPath, method] = k.split('|') as [string, string]
      lines.push(`- \`${method.toUpperCase()} ${specPath}\``)
    }
    lines.push('')
  }

  lines.push(
    '---',
    '',
    '**Next steps:**',
    '1. Review the changes above.',
    '2. Run `pnpm spec:update` on a new branch to update the committed snapshot.',
    '3. Open a PR — the contract tests in `src/spec-contract.test.ts` will show which',
    '   mock responses need to be updated to match the new spec.',
    ''
  )

  return { report: lines.join('\n'), hasDiff }
}

// ── CLI ────────────────────────────────────────────────────────────────────────
// Only runs when this file is executed directly (`tsx scripts/spec-diff.ts`),
// not when it is imported by tests.

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const oldArg = process.argv.at(2)
  const newArg = process.argv.at(3)
  const cwd = process.cwd()
  const oldPath = path.resolve(cwd, oldArg ?? 'spec/openapi.json')
  const newPath = path.resolve(cwd, newArg ?? 'spec/openapi.upstream.json')

  let oldSpec: OpenApiSpec
  let newSpec: OpenApiSpec

  try {
    oldSpec = loadSpec(oldPath)
    newSpec = loadSpec(newPath)
  } catch (err) {
    console.error(`Error loading spec files: ${String(err)}`)
    process.exit(2)
  }

  const manifestSource = readFileSync(
    path.resolve(cwd, 'spec/manifest.ts'),
    'utf8'
  )

  const result = runSpecDiff(oldSpec, newSpec, manifestSource, oldPath, newPath)
  console.log(result.report)
  process.exit(result.hasDiff ? 1 : 0)
}
