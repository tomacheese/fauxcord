import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { versionMiddleware } from './version.js'

describe('versionMiddleware', () => {
  const app = new Hono()
  app.use('*', versionMiddleware)
  app.get('/api/v10/channels/:id', (c) => c.json({ ok: true }))
  app.get('/api/channels/:id', (c) => c.json({ ok: true }))

  it('handles v10 paths correctly', async () => {
    const res = await app.request('/api/v10/channels/123')
    expect(res.status).toBe(200)
  })

  it('handles paths without an explicit version', async () => {
    const res = await app.request('/api/channels/123')
    expect(res.status).toBe(200)
  })

  it('returns 400 for v9 paths', async () => {
    const res = await app.request('/api/v9/channels/123')
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe(50_041)
  })

  it('returns 400 for v6 paths', async () => {
    const res = await app.request('/api/v6/channels/123')
    expect(res.status).toBe(400)
  })
})
