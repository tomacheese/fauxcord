import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createLatencyMiddleware } from './latency'

describe('createLatencyMiddleware', () => {
  it('passes through immediately when latency is 0', async () => {
    const app = new Hono()
    app.use('*', createLatencyMiddleware(0))
    app.get('/t', (c) => c.json({ ok: true }))

    const start = Date.now()
    const res = await app.request('/t')
    const elapsed = Date.now() - start
    expect(res.status).toBe(200)
    // No artificial delay should be added
    expect(elapsed).toBeLessThan(50)
  })

  it('delays the response by at least the configured latency', async () => {
    const app = new Hono()
    app.use('*', createLatencyMiddleware(40))
    app.get('/t', (c) => c.json({ ok: true }))

    const start = Date.now()
    const res = await app.request('/t')
    const elapsed = Date.now() - start
    expect(res.status).toBe(200)
    // Allow scheduler slack but confirm a delay occurred
    expect(elapsed).toBeGreaterThanOrEqual(30)
  })
})
