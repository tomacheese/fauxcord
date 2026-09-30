import { describe, expect, it } from 'vitest'
import { MANIFEST } from '../spec/manifest'
import { createFullTestApp } from './test-helpers'
import {
  generateFullCoveragePlan,
  runFullCoverageExploration,
} from './model-based-full-explorer'

function normalizePath(path: string): string {
  return path
    .replaceAll(/^\/api\/v10(?=\/|$)/g, '')
    .replaceAll(/^\/api(?=\/|$)/g, '')
    .replaceAll(/:[^/]+/g, '{}')
    .replaceAll(/\{[^}]+\}/g, '{}')
}

describe('full model-based API explorer', () => {
  it('plans every manifest success branch plus supplemental public flows', () => {
    const plan = generateFullCoveragePlan(317)
    const replay = generateFullCoveragePlan('317')
    const expectedBranches = MANIFEST.flatMap((endpoint) =>
      endpoint.successBranches.map(
        (branch) =>
          `${endpoint.method.toUpperCase()} ${endpoint.specPath} ${branch.status}`
      )
    )

    expect(plan.map(({ id }) => id)).toEqual(replay.map(({ id }) => id))
    expect(plan).toHaveLength(expectedBranches.length + 3)
    expect(plan.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        ...expectedBranches,
        'DELETE /guilds/{guild_id} 204',
        'OAuth2 authorize/token/revoke flows',
        'Gateway dispatch event catalog',
      ])
    )
  })

  it('accounts for every public HTTP route outside test and mock plumbing', () => {
    const context = createFullTestApp()
    try {
      const implemented = new Set(
        context.app.routes
          .filter(
            ({ method, path }) =>
              method !== 'ALL' &&
              path !== '/' &&
              !path.startsWith('/_test/') &&
              !path.startsWith('/_mock/')
          )
          .map(({ method, path }) => `${method} ${normalizePath(path)}`)
      )
      const covered = new Set([
        ...MANIFEST.map(
          ({ method, specPath }) =>
            `${method.toUpperCase()} ${normalizePath(specPath)}`
        ),
        'DELETE /guilds/{}',
        'GET /oauth2/authorize',
        'POST /oauth2/token',
        'POST /oauth2/token/revoke',
      ])

      expect([...implemented].filter((route) => !covered.has(route))).toEqual(
        []
      )
    } finally {
      context.cleanup()
    }
  })

  it('executes the complete contract-backed public API coverage sweep', async () => {
    const result = await runFullCoverageExploration(317)

    expect(result.passed).toBe(true)
    expect(result.generatedSteps).toBe(261)
    expect(result.executedSteps).toBe(result.generatedSteps)
    expect(result.coverage).toEqual({
      openApiOperations: 246,
      successBranches: 258,
      supplementalScenarios: 3,
    })
    expect(result.trace.every(({ outcome }) => outcome === 'passed')).toBe(true)
  }, 120_000)
})
