import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MANIFEST } from './manifest'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

interface OpenApiOperation {
  responses?: Record<string, unknown>
}

interface OpenApiDocument {
  paths: Record<string, Partial<Record<(typeof HTTP_METHODS)[number], OpenApiOperation>>>
}

const spec = JSON.parse(
  readFileSync(new URL('./openapi.json', import.meta.url), 'utf8')
) as OpenApiDocument

const operationKey = (method: string, specPath: string): string =>
  `${method.toUpperCase()} ${specPath}`

const specOperations = Object.entries(spec.paths).flatMap(([specPath, path]) =>
  HTTP_METHODS.flatMap((method) =>
    path[method] ? [operationKey(method, specPath)] : []
  )
)

describe('OpenAPI operation manifest', () => {
  it('contains each operation key exactly once', () => {
    const counts = new Map<string, number>()
    for (const entry of MANIFEST) {
      expect(entry, operationKey(entry.method, entry.specPath)).not.toHaveProperty(
        'contractTested'
      )
      const key = operationKey(entry.method, entry.specPath)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    expect(
      [...counts.entries()]
        .filter(([, count]) => count !== 1)
        .map(([key, count]) => `${key} (${count})`)
        .sort()
    ).toEqual([])
  })

  it('matches the committed OpenAPI operation inventory', () => {
    const manifestKeys = new Set(
      MANIFEST.map((entry) => operationKey(entry.method, entry.specPath))
    )
    const specKeys = new Set(specOperations)
    const missing = [...specKeys].filter((key) => !manifestKeys.has(key)).sort()
    const extra = [...manifestKeys].filter((key) => !specKeys.has(key)).sort()

    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it('defines an isolated fixture and network contract for every success branch', () => {
    for (const entry of MANIFEST) {
      expect(entry.authentication, operationKey(entry.method, entry.specPath)).toBeTruthy()
      expect(entry.createFixture, operationKey(entry.method, entry.specPath)).toBeTypeOf(
        'function'
      )
      expect(entry.successBranches.length, operationKey(entry.method, entry.specPath)).toBeGreaterThan(
        0
      )

      for (const branch of entry.successBranches) {
        const label = `${operationKey(entry.method, entry.specPath)} ${branch.status}`
        expect(branch.request, label).toBeTypeOf('function')
        if (branch.body === 'empty') {
          expect(branch.contentType, label).toBeNull()
        } else {
          expect(branch.contentType, label).toBeTypeOf('string')
        }
        expect(['json', 'empty', 'png', 'csv'], label).toContain(branch.body)
        expect(branch.assert, label).toBeTypeOf('function')
      }
    }
  })

  it('covers every declared OpenAPI success status once per operation', () => {
    for (const entry of MANIFEST) {
      const operation = spec.paths[entry.specPath]?.[entry.method]
      const expectedStatuses = Object.keys(operation?.responses ?? {})
        .filter((status) => /^2\d\d$/.test(status))
        .map(Number)
        .sort((a, b) => a - b)
      const actualStatuses = entry.successBranches
        .map((branch) => branch.status)
        .sort((a, b) => a - b)

      expect(
        actualStatuses,
        operationKey(entry.method, entry.specPath)
      ).toEqual(expectedStatuses)
    }
  })

  it('models application-command create as one operation with 200 and 201 branches', () => {
    const entries = MANIFEST.filter(
      (entry) =>
        entry.method === 'post' &&
        entry.specPath === '/applications/{application_id}/commands'
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.successBranches.map((branch) => branch.status).sort()).toEqual([
      200,
      201,
    ])
  })
})
