import { describe, it, expect } from 'vitest'
import type { OpenApiSpec } from './spec-diff.js'
import { runSpecDiff } from './spec-diff.js'

describe('scripts/spec-diff.test.ts wiring', () => {
  it('runs under the scripts/ test glob', () => {
    expect(true).toBe(true)
  })
})

/**
 * Builds a minimal OpenApiSpec fixture for testing.
 * @param opts - Version, paths, and schemas to embed.
 * @returns A minimal but valid OpenApiSpec.
 */
function buildSpec(opts: {
  version?: string
  paths: OpenApiSpec['paths']
  schemas?: OpenApiSpec['components']['schemas']
}): OpenApiSpec {
  return {
    info: { version: opts.version ?? '10.0.0', title: 'Test Spec' },
    paths: opts.paths,
    components: { schemas: opts.schemas ?? {} },
  }
}

/** A minimal manifest.ts source registering GET /widgets/{id}. */
const MANIFEST_SOURCE = `
export const MANIFEST = [
  {
    specPath: '/widgets/{id}',
    method: 'get',
  },
]
`

describe('runSpecDiff (characterization)', () => {
  it('reports no diff for two identical specs', () => {
    const spec = buildSpec({
      paths: {
        '/widgets/{id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { id: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    })
    const result = runSpecDiff(spec, spec, MANIFEST_SOURCE, 'old.json', 'new.json')
    expect(result.hasDiff).toBe(false)
    expect(result.report).toBe(
      'No differences detected between the two spec files.'
    )
  })

  it('detects a version bump and a newly added field on a manifest-registered endpoint', () => {
    const oldSpec = buildSpec({
      version: '10.0.0',
      paths: {
        '/widgets/{id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { id: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    })
    const newSpec = buildSpec({
      version: '10.1.0',
      paths: {
        '/widgets/{id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    const result = runSpecDiff(
      oldSpec,
      newSpec,
      MANIFEST_SOURCE,
      'old.json',
      'new.json'
    )
    expect(result.hasDiff).toBe(true)
    expect(result.report).toContain('🔖 API Version Changed')
    expect(result.report).toContain('name: string')
    expect(result.report).toContain('GET /widgets/{id}')
  })
})
