import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createSoundboardRoutes } from './soundboard'
import type { AppEnv } from '../middleware/auth'

describe('Soundboard API', () => {
  describe('GET /soundboard-default-sounds', () => {
    it('returns an empty array', async () => {
      const app = new Hono<AppEnv>()
      app.route('/', createSoundboardRoutes())

      const res = await app.request('/soundboard-default-sounds', {
        headers: { Authorization: 'Bot testtoken' },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(body).toEqual([])
    })
  })
})
