/**
 * Soundboard API routing
 *
 * Implements GET /soundboard-default-sounds. Bot-authenticated (via the
 * global auth middleware, same as most other non-public endpoints).
 */

import { Hono } from 'hono'
import type { AppEnvironment } from '../middleware/auth'
import { getDefaultSoundboardSounds } from '../services/soundboard'

/**
 * Creates the Soundboard API routes.
 * @returns Hono router instance
 */
export function createSoundboardRoutes(): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>()

  // GET /soundboard-default-sounds — Requires Bot authentication
  app.get('/soundboard-default-sounds', (c) => {
    return c.json(getDefaultSoundboardSounds())
  })

  return app
}
