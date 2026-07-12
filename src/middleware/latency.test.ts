import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

// Mock node:timers/promises' setTimeout so the test doesn't depend on real
// wall-clock timing (which is flaky under CI load or timer jitter). This lets
// us assert the middleware's behavior (whether/how it delays) deterministically.
const sleepMock = vi.fn(async (ms: number) => {
  await Promise.resolve(ms)
})
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) => sleepMock(ms),
}))

const { createLatencyMiddleware } = await import('./latency')

describe('createLatencyMiddleware', () => {
  it('skips the delay when latency is 0', async () => {
    sleepMock.mockClear()
    const app = new Hono()
    app.use('*', createLatencyMiddleware(0))
    app.get('/t', (c) => c.json({ ok: true }))

    const resource = await app.request('/t')

    expect(resource.status).toBe(200)
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('delays by the configured duration when latency is set', async () => {
    sleepMock.mockClear()
    const app = new Hono()
    app.use('*', createLatencyMiddleware(100))
    app.get('/t', (c) => c.json({ ok: true }))

    const resource = await app.request('/t')

    expect(resource.status).toBe(200)
    expect(sleepMock).toHaveBeenCalledWith(100)
  })
})
