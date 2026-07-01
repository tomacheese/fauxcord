/**
 * @file spec-fetch.ts
 * @description Downloads the latest Discord API OpenAPI spec from the official repository.
 *
 * Usage:
 *   pnpm spec:fetch              — downloads to spec/openapi.upstream.json (for diffing)
 *   pnpm spec:update             — downloads to spec/openapi.json (updates the committed snapshot)
 *   tsx scripts/spec-fetch.ts <path>  — downloads to the specified path
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'

const UPSTREAM_URL =
  'https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json'

/**
 * Downloads the latest Discord OpenAPI spec from the official repository.
 * @param outputPath - The file path to write the downloaded spec to.
 */
async function fetchSpec(outputPath: string): Promise<void> {
  console.log(`Fetching Discord API spec from ${UPSTREAM_URL}`)

  const response = await fetch(UPSTREAM_URL)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch spec: ${response.status} ${response.statusText}`
    )
  }

  const body = await response.text()
  writeFileSync(outputPath, body, 'utf8')
  console.log(`Spec written to ${outputPath} (${body.length} bytes)`)
}

const outputPath = process.argv.at(2) ?? 'spec/openapi.upstream.json'
const resolvedPath = path.resolve(process.cwd(), outputPath)

await fetchSpec(resolvedPath)
