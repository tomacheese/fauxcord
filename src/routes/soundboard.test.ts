import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createSoundboardRoutes } from './soundboard'
import { createFullTestApp } from '../test-helpers'
import { closeDatabase } from '../database'
import type { AppEnvironment } from '../middleware/auth'

describe('Soundboard API', () => {
  describe('GET /soundboard-default-sounds', () => {
    it('returns an empty array', async () => {
      const app = new Hono<AppEnvironment>()
      app.route('/', createSoundboardRoutes())

      const resource = await app.request('/soundboard-default-sounds', {
        headers: { Authorization: 'Bot testtoken' },
      })
      expect(resource.status).toBe(200)
      const body = (await resource.json()) as unknown[]
      expect(body).toEqual([])
    })

    it('returns 401 when no Authorization header is provided', async () => {
      const { app, db } = createFullTestApp()
      const resource = await app.request('/api/v10/soundboard-default-sounds')
      expect(resource.status).toBe(401)
      closeDatabase(db)
    })
  })
})
