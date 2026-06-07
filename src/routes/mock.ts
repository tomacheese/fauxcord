/**
 * インフラ API ルーティング
 *
 * /_mock/* インフラエンドポイントを実装します。
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { getAttachment, guessContentType } from '../services/attachments.js'

/** サーバー起動時刻 */
const START_TIME = Date.now()

/**
 * インフラ APIルートを作成します。
 * @param db - データベース
 * @param uploadPath - 添付ファイル保存先
 * @returns Honoルーターインスタンス
 */
export function createMockRoutes(db: Database, uploadPath: string): Hono {
  const app = new Hono()

  // GET /_mock/health
  app.get('/_mock/health', (c) => {
    let dbStatus = 'ok'
    try {
      db.prepare('SELECT 1').get()
    } catch {
      dbStatus = 'error'
    }

    if (dbStatus === 'error') {
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

  // GET /_mock/attachments/:channelId/:messageId/:filename
  app.get('/_mock/attachments/:channelId/:messageId/:filename', async (c) => {
    const { channelId, messageId, filename } = c.req.param()

    const data = await getAttachment(uploadPath, channelId, messageId, filename)
    if (!data) {
      return c.json({ message: '404: Not Found', code: 0 }, 404)
    }

    const contentType = guessContentType(filename)
    c.header('Content-Type', contentType)
    c.header('Content-Length', String(data.length))
    return c.body(data as unknown as ReadableStream)
  })

  return app
}
