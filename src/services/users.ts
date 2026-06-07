/**
 * User operations service
 *
 * Retrieves user information and provides application information.
 */

import type { Database } from '../db.js'

/** Bot record type retrieved from the DB */
interface BotRow {
  token: string
  user_id: string
  username: string
  discriminator: string
  bot: number
  avatar: string | null
}

/** User object for API responses */
export interface UserObject {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  bot: boolean
  flags?: number
  public_flags?: number
}

/**
 * Retrieves the authenticated bot's (@me) information.
 * @param db - Database
 * @param botToken - Bot token
 * @returns User object, or null
 */
export function getBotUser(db: Database, botToken: string): UserObject | null {
  const bot = db.prepare('SELECT * FROM bots WHERE token = ?').get(botToken) as
    | BotRow
    | undefined
  if (!bot) return null

  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(bot.user_id) as
    | {
        id: string
        username: string
        discriminator: string
        avatar: string | null
        bot: number
      }
    | undefined

  if (!user) return null

  return {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    avatar: user.avatar,
    bot: true,
    flags: 0,
    public_flags: 0,
  }
}

/**
 * Retrieves a user by ID.
 * @param db - Database
 * @param userId - User ID
 * @returns User object, or null
 */
export function getUser(db: Database, userId: string): UserObject | null {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | {
        id: string
        username: string
        discriminator: string
        avatar: string | null
        bot: number
      }
    | undefined

  if (!user) return null

  return {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    avatar: user.avatar,
    bot: user.bot === 1,
    public_flags: 0,
  }
}

/**
 * Retrieves application information (@applications/@me).
 * @param db - Database
 * @param botToken - Bot token
 * @returns Application information object, or null
 */
export function getApplication(
  db: Database,
  botToken: string
): {
  id: string
  name: string
  icon: null
  description: string
  bot_public: boolean
  bot_require_code_grant: boolean
  owner: UserObject
} | null {
  const bot = db.prepare('SELECT * FROM bots WHERE token = ?').get(botToken) as
    | BotRow
    | undefined
  if (!bot) return null

  const user = getUser(db, bot.user_id)
  if (!user) return null

  return {
    id: bot.user_id,
    name: bot.username,
    icon: null,
    description: '',
    bot_public: true,
    bot_require_code_grant: false,
    owner: user,
  }
}
