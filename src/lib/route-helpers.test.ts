import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { requireEntity, parseLimitQuery } from './route-helpers'
import { DiscordErrorCode } from '../errors'

describe('requireEntity', () => {
  it('returns the entity when found', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      const result = requireEntity(
        c,
        { id: '1' },
        DiscordErrorCode.UNKNOWN_GUILD,
        'Unknown Guild'
      )
      if (result instanceof Response) return result
      return c.json(result)
    })
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '1' })
  })

  it('returns a 404 Discord error response when null', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      const result = requireEntity(
        c,
        null,
        DiscordErrorCode.UNKNOWN_GUILD,
        'Unknown Guild'
      )
      if (result instanceof Response) return result
      return c.json(result)
    })
    const res = await app.request('/')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { code: number; message: string }
    expect(body.code).toBe(DiscordErrorCode.UNKNOWN_GUILD)
    expect(body.message).toBe('Unknown Guild')
  })

  it('returns a 404 Discord error response when undefined', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      const result = requireEntity(
        c,
        undefined,
        DiscordErrorCode.UNKNOWN_CHANNEL,
        'Unknown Channel'
      )
      if (result instanceof Response) return result
      return c.json(result)
    })
    const res = await app.request('/')
    expect(res.status).toBe(404)
  })
})

describe('parseLimitQuery', () => {
  it('uses the default value when the query parameter is absent', async () => {
    const app = new Hono()
    app.get('/', (c) => c.json({ limit: parseLimitQuery(c, 50, 100) }))
    const res = await app.request('/')
    expect((await res.json()) as { limit: number }).toEqual({ limit: 50 })
  })

  it('parses the query parameter when present', async () => {
    const app = new Hono()
    app.get('/', (c) => c.json({ limit: parseLimitQuery(c, 50, 100) }))
    const res = await app.request('/?limit=10')
    expect((await res.json()) as { limit: number }).toEqual({ limit: 10 })
  })

  it('clamps to the max value', async () => {
    const app = new Hono()
    app.get('/', (c) => c.json({ limit: parseLimitQuery(c, 50, 100) }))
    const res = await app.request('/?limit=500')
    expect((await res.json()) as { limit: number }).toEqual({ limit: 100 })
  })
})
