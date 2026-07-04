import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createLatencyMiddleware } from './latency'

describe('createLatencyMiddleware', () => {
  it('adds a delay only when latency is configured', async () => {
    const fast = new Hono()
    fast.use('*', createLatencyMiddleware(0))
    fast.get('/t', (c) => c.json({ ok: true }))

    const slow = new Hono()
    slow.use('*', createLatencyMiddleware(100))
    slow.get('/t', (c) => c.json({ ok: true }))

    // Warm both apps first to pay one-time import/JIT costs, so the measured
    // difference reflects only the middleware behavior.
    await fast.request('/t')
    await slow.request('/t')

    const t0 = performance.now()
    const fastRes = await fast.request('/t')
    const fastElapsed = performance.now() - t0

    const t1 = performance.now()
    const slowRes = await slow.request('/t')
    const slowElapsed = performance.now() - t1

    expect(fastRes.status).toBe(200)
    expect(slowRes.status).toBe(200)
    // Assert the relative difference driven by the configured delay rather than
    // an absolute wall-clock ceiling, so ambient load cannot cause flakes: both
    // requests share the same conditions and only the slow path calls sleep().
    expect(slowElapsed - fastElapsed).toBeGreaterThanOrEqual(80)
  })
})
