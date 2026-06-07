/**
 * Users API ルーティング
 *
 * /users/*, /applications/* エンドポイントを実装します。
 */

import { Hono } from 'hono'
import type { Database } from '../db.js'
import { DiscordErrorCode, discordError } from '../errors.js'
import { getBotUser, getUser, getApplication } from '../services/users.js'
import { getBotGuilds } from '../services/guilds.js'
import type { AppEnv } from '../middleware/auth.js'

/**
 * Users APIルートを作成します。
 * @param db - データベース
 * @returns Honoルーターインスタンス
 */
export function createUserRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // GET /users/@me — 認証中のBotユーザー情報を取得
  app.get('/users/@me', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const user = getBotUser(db, bot.token)
    if (!user) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(user)
  })

  // GET /users/:userId — 指定ユーザー情報を取得
  // discord.js など一部ライブラリは @ を percent-encode して %40me で送るため、
  // パラメータとして受け取った "@me"（デコード済み）も @me 扱いにする
  app.get('/users/:userId', (c) => {
    const rawUserId = c.req.param('userId')
    // Hono はパスパラメータを自動デコードするため %40me → @me になる
    const userId = decodeURIComponent(rawUserId)

    if (userId === '@me') {
      const bot = c.get('bot')
      if (!bot) {
        return c.json({ message: '401: Unauthorized', code: 0 }, 401)
      }
      const user = getBotUser(db, bot.token)
      if (!user) {
        return c.json({ message: '401: Unauthorized', code: 0 }, 401)
      }
      return c.json(user)
    }

    const user = getUser(db, userId)
    if (!user) {
      const err = discordError(
        DiscordErrorCode.UNKNOWN_USER,
        'Unknown User',
        404
      )
      return c.json(err.body, 404)
    }
    return c.json(user)
  })

  // GET /users/@me/guilds — 参加中のGuild一覧を取得
  app.get('/users/@me/guilds', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const guilds = getBotGuilds(db, bot.token)
    return c.json(guilds)
  })

  // GET /applications/@me — アプリケーション情報を取得
  app.get('/applications/@me', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const app_ = getApplication(db, bot.token)
    if (!app_) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(app_)
  })

  // GET /oauth2/applications/@me — アプリケーション情報を取得（Discord.Net互換エイリアス）
  // Get Current Bot Application Information（旧エンドポイント）。
  // Discord.Net などのライブラリがログイン時に呼び出すため、
  // /applications/@me と同じレスポンスを返すエイリアスとして実装する
  app.get('/oauth2/applications/@me', (c) => {
    const bot = c.get('bot')
    if (!bot) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }

    const app_ = getApplication(db, bot.token)
    if (!app_) {
      return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    }
    return c.json(app_)
  })

  return app
}
