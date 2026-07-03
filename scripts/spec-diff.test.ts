import { describe, it, expect } from 'vitest'
import type { OpenApiSpec } from './spec-diff'
import { runSpecDiff, isEnumAdditionOnly } from './spec-diff'
import { ENUM_NOISE } from '../spec/enum-noise'

// Guards against vitest.config.ts regressing the `scripts/**/*.test.ts`
// include glob (see Task 1 of the enum-noise plan) — if this file stops
// being picked up by vitest, `pnpm test` would silently report 0 tests
// here instead of failing.
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

/** A minimal manifest registering GET /widgets/{id}. */
const MANIFEST: { specPath: string; method: string }[] = [
  { specPath: '/widgets/{id}', method: 'get' },
]

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
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    const result = runSpecDiff(spec, spec, MANIFEST, 'old.json', 'new.json')
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
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                    },
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
      MANIFEST,
      'old.json',
      'new.json'
    )
    expect(result.hasDiff).toBe(true)
    expect(result.report).toContain('🔖 API Version Changed')
    expect(result.report).toContain('name: string')
    expect(result.report).toContain('GET /widgets/{id}')
  })
})

describe('isEnumAdditionOnly', () => {
  it('returns true when a oneOf choice count increases', () => {
    expect(isEnumAdditionOnly('oneOf(28)', 'oneOf(29)')).toBe(true)
  })

  it('returns false when a oneOf choice count decreases', () => {
    expect(isEnumAdditionOnly('oneOf(29)', 'oneOf(28)')).toBe(false)
  })

  it('returns true when an array-wrapped oneOf choice count increases', () => {
    expect(isEnumAdditionOnly('array<oneOf(28)>', 'array<oneOf(29)>')).toBe(
      true
    )
  })

  it('returns false when array-wrapping differs between old and new', () => {
    expect(isEnumAdditionOnly('oneOf(28)', 'array<oneOf(29)>')).toBe(false)
  })

  it('returns false when the union kind differs (oneOf vs anyOf)', () => {
    expect(isEnumAdditionOnly('oneOf(2)', 'anyOf(3)')).toBe(false)
  })

  it('returns false for a change to a non-union type', () => {
    expect(isEnumAdditionOnly('oneOf(2)', 'string')).toBe(false)
  })

  it('returns false for a half-open array wrapping (no closing bracket)', () => {
    expect(isEnumAdditionOnly('array<oneOf(28)', 'array<oneOf(29)')).toBe(false)
  })

  it('returns false for a stray closing bracket with no array wrapping', () => {
    expect(isEnumAdditionOnly('oneOf(28)>', 'oneOf(29)>')).toBe(false)
  })
})

describe('runSpecDiff — enum-noise suppression', () => {
  /** A minimal manifest registering GET /guilds/{guild_id}. */
  const GUILD_MANIFEST: { specPath: string; method: string }[] = [
    { specPath: '/guilds/{guild_id}', method: 'get' },
  ]

  it('suppresses an enum-addition-only change on an allow-listed field: exit 0, but still shown in the report', () => {
    const oldSpec = buildSpec({
      paths: {
        '/guilds/{guild_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        features: {
                          oneOf: Array.from({ length: 28 }, () => ({
                            type: 'string',
                          })),
                        },
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
    const newSpec = buildSpec({
      paths: {
        '/guilds/{guild_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        features: {
                          oneOf: Array.from({ length: 29 }, () => ({
                            type: 'string',
                          })),
                        },
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
      GUILD_MANIFEST,
      'old.json',
      'new.json'
    )

    expect(result.hasDiff).toBe(false)
    expect(result.report).toContain('🔇 no action needed')
    expect(result.report).toContain('features')
    expect(result.report).toContain('oneOf(28)')
    expect(result.report).toContain('oneOf(29)')
  })

  it('does NOT suppress an enum-addition-only change on a field not in the allow-list (e.g. verification_level)', () => {
    const oldSpec = buildSpec({
      paths: {
        '/guilds/{guild_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        verification_level: {
                          oneOf: Array.from({ length: 5 }, () => ({
                            type: 'integer',
                          })),
                        },
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
    const newSpec = buildSpec({
      paths: {
        '/guilds/{guild_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        verification_level: {
                          oneOf: Array.from({ length: 6 }, () => ({
                            type: 'integer',
                          })),
                        },
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
      GUILD_MANIFEST,
      'old.json',
      'new.json'
    )

    expect(result.hasDiff).toBe(true)
    expect(result.report).toContain('— response schema')
    expect(result.report).toContain('verification_level')
    expect(result.report).not.toContain('🔇 no action needed')
  })

  it('does NOT suppress an enum choice removal on an allow-listed field', () => {
    const oldSpec = buildSpec({
      paths: {
        '/guilds/{guild_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        features: {
                          oneOf: Array.from({ length: 29 }, () => ({
                            type: 'string',
                          })),
                        },
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
    const newSpec = buildSpec({
      paths: {
        '/guilds/{guild_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        features: {
                          oneOf: Array.from({ length: 28 }, () => ({
                            type: 'string',
                          })),
                        },
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
      GUILD_MANIFEST,
      'old.json',
      'new.json'
    )

    expect(result.hasDiff).toBe(true)
    expect(result.report).toContain('— response schema')
    expect(result.report).toContain('features')
    expect(result.report).not.toContain('🔇 no action needed')
  })

  it('does NOT suppress a type-shape change (not a removal) on an allow-listed field', () => {
    const oldSpec = buildSpec({
      paths: {
        '/guilds/{guild_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        features: {
                          oneOf: Array.from({ length: 28 }, () => ({
                            type: 'string',
                          })),
                        },
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
    const newSpec = buildSpec({
      paths: {
        '/guilds/{guild_id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        // Type shape changed from a `oneOf` union to a plain
                        // string — not an enum-choice-count change at all.
                        features: { type: 'string' },
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
      GUILD_MANIFEST,
      'old.json',
      'new.json'
    )

    expect(result.hasDiff).toBe(true)
    expect(result.report).toContain('— response schema')
    expect(result.report).toContain('features')
    expect(result.report).not.toContain('🔇 no action needed')
  })
})

describe('ENUM_NOISE', () => {
  it('has no duplicate specPath+method+field entries', () => {
    const keys = ENUM_NOISE.map((e) => `${e.specPath}|${e.method}|${e.field}`)
    expect(keys.length).toBe(new Set(keys).size)
  })

  it('gives every entry a non-empty reason', () => {
    for (const entry of ENUM_NOISE) {
      expect(entry.reason.length).toBeGreaterThan(0)
    }
  })

  it('includes the guild features/afk_timeout/mfa_level exemptions', () => {
    const keys = new Set(
      ENUM_NOISE.map((e) => `${e.specPath}|${e.method}|${e.field}`)
    )
    expect(keys.has('/guilds/{guild_id}|get|features')).toBe(true)
    expect(keys.has('/guilds/{guild_id}|patch|features')).toBe(true)
    expect(keys.has('/guilds/{guild_id}|get|afk_timeout')).toBe(true)
    expect(keys.has('/guilds/{guild_id}|patch|afk_timeout')).toBe(true)
    expect(keys.has('/guilds/{guild_id}|get|mfa_level')).toBe(true)
    expect(keys.has('/guilds/{guild_id}|patch|mfa_level')).toBe(true)
    expect(keys.has('/users/@me/guilds|get|features')).toBe(true)
  })
})
