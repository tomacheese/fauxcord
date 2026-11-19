import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/spec-drift.yml', 'utf8')
const step = workflow
  .split('      - name: Run spec diff\n')[1]
  .split('      - name:')[0]
  .split('        run: |\n')[1]
  .replaceAll(/^ {10}/gm, '')

describe('spec drift workflow comparison', () => {
  it.each([
    { code: 0, status: 0, changed: 'false' },
    { code: 1, status: 0, changed: 'true' },
    { code: 2, status: 2, changed: undefined },
  ])('handles comparison exit code $code', ({ code, status, changed }) => {
    const script = step.replace(
      'pnpm --silent spec:diff',
      `bash -c 'echo comparison-diagnostic >&2; exit ${code}'`
    )
    const directory = mkdtempSync(join(tmpdir(), 'spec-drift-test-'))
    const output = join(directory, 'output')
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output },
    })

    expect(result.status).toBe(status)
    if (changed === undefined) {
      expect(result.stderr).toContain('comparison-diagnostic')
      expect(existsSync(output)).toBe(false)
    } else {
      const contents = readFileSync(output, 'utf8')
      expect(contents).toContain(`changed=${changed}`)
      expect(contents).toContain('comparison-diagnostic')
    }
    rmSync(directory, { recursive: true, force: true })
  })
})
