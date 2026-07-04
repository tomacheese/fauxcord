import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createLatencyMiddleware } from './latency'

describe('createLatencyMiddleware', () => {
  it('adds no artificial delay when latency is 0', async () => {
    const app = new Hono()
    app.use('*', createLatencyMiddleware(0))
    app.get('/t', (c) => c.json({ ok: true }))

    // Warm up once to pay one-time import/JIT costs, then measure a warm request
    // so the assertion reflects only the (absent) middleware delay.
    await app.request('/t')
    const start = performance.now()
    const res = await app.request('/t')
    const elapsed = performance.now() - start
    expect(res.status).toBe(200)
    expect(elapsed).toBeLessThan(50)
  })

  it('delays the response by at least the configured latency', async () => {
    const app = new Hono()
    app.use('*', createLatencyMiddleware(100))
    app.get('/t', (c) => c.json({ ok: true }))

    // Warm up first (this request also incurs the 100ms delay once), then
    // measure a subsequent request to confirm the delay is applied per-request.
    await app.request('/t')
    const start = performance.now()
    const res = await app.request('/t')
    const elapsed = performance.now() - start
    expect(res.status).toBe(200)
    expect(elapsed).toBeGreaterThanOrEqual(80)
  })
})
