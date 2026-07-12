/**
 * Infrastructure API routing
 *
 * Implements the /_mock/* infrastructure endpoints.
 */

import { Hono } from 'hono'
import type { Database } from '../database'
import { getAttachment, guessContentType } from '../services/attachments'

/** Server start time */
const START_TIME = Date.now()

/**
 * Creates the infrastructure API routes.
 * @param database - Database
 * @param uploadPath - Attachment storage directory
 * @returns Hono router instance
 */
export function createMockRoutes(database: Database, uploadPath: string): Hono {
  const app = new Hono()

  // GET /_mock/health — Health check
  app.get('/_mock/health', (c) => {
    let databaseStatus = 'ok'
    try {
      database.prepare('SELECT 1').get()
    } catch {
      databaseStatus = 'error'
    }

    if (databaseStatus === 'error') {
      return c.json(
        {
          status: 'error',
          version: '1.0.0',
          db: 'error',
          uptime: Math.floor((Date.now() - START_TIME) / 1000),
        },
        503
      )
    }

    return c.json({
      status: 'ok',
      version: '1.0.0',
      db: 'ok',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
    })
  })

  // GET /_mock/attachments/:channelId/:messageId/:filename — Serve attachments
  app.get('/_mock/attachments/:channelId/:messageId/:filename', async (c) => {
    const { channelId, messageId, filename } = c.req.param()

    const data = await getAttachment(uploadPath, channelId, messageId, filename)
    if (!data) {
      return c.json({ message: '404: Not Found', code: 0 }, 404)
    }

    const contentType = guessContentType(filename)
    c.header('Content-Type', contentType)
    c.header('Content-Length', String(data.length))
    // Buffer can be returned directly as BodyInit, but Hono's type definitions require ReadableStream,
    // so a type assertion is used reluctantly (it works correctly as a Buffer at runtime)

    return c.body(data as any)
  })

  return app
}
