/**
 * User operations service
 *
 * Retrieves user information and provides application information.
 */

import type { Database } from '../db'
import type { CurrentUserUpdatePayload } from '../validators/user'
// Used for compile-time type drift detection.
import type { APIUser } from 'discord-api-types/v10'

/**
 * Compile-time guard: ensures the safe-field subset of UserObject is
 * structurally compatible with APIUser.
 * Fails to compile when discord-api-types renames or retypes these fields.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _UserCompatGuard =
  Pick<
    APIUser,
    'id' | 'username' | 'discriminator' | 'avatar' | 'bot' | 'global_name'
  > extends Pick<
    UserObject,
    'id' | 'username' | 'discriminator' | 'avatar' | 'bot' | 'global_name'
  >
    ? true
    : never

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
  /** Display name (always null in the mock) */
  global_name?: string | null
  /** Primary guild info (always null in the mock) */
  primary_guild?: string | null
  /** Whether the user has MFA enabled (always false in the mock) */
  mfa_enabled?: boolean
  /** User locale (always "en-US" in the mock) */
  locale?: string
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
    global_name: null,
    mfa_enabled: false,
    locale: 'en-US',
  }
}

/**
 * Updates the authenticated bot's (@me) profile.
 *
 * Applies a partial update: only fields present in `payload` are changed.
 * `username` and `avatar` each update both the `users` and `bots` tables to
 * keep them in sync (the `users` row backs the user response; the `bots` row
 * backs `getApplication`). `avatar` may be set to null to clear it. `banner`
 * has no backing column and is accepted but not persisted (mock limitation).
 * @param db - Database
 * @param botToken - Bot token
 * @param payload - Validated update payload
 * @returns Updated user object, or null when the bot/user is unknown
 */
export function updateBotUser(
  db: Database,
  botToken: string,
  payload: CurrentUserUpdatePayload
): UserObject | null {
  const bot = db.prepare('SELECT * FROM bots WHERE token = ?').get(botToken) as
    | BotRow
    | undefined
  if (!bot) return null

  // Wrap the users/bots updates in a single transaction so the two tables
  // never end up partially synced if a statement fails mid-way.
  const applyUpdate = db.transaction(() => {
    if (payload.username !== undefined) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(
        payload.username,
        bot.user_id
      )
      db.prepare('UPDATE bots SET username = ? WHERE token = ?').run(
        payload.username,
        botToken
      )
    }

    if (payload.avatar !== undefined) {
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(
        payload.avatar,
        bot.user_id
      )
      db.prepare('UPDATE bots SET avatar = ? WHERE token = ?').run(
        payload.avatar,
        botToken
      )
    }
  })
  applyUpdate()

  return getBotUser(db, botToken)
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
    flags: 0,
    public_flags: 0,
    global_name: null,
    primary_guild: null,
  }
}

/**
 * Retrieves application information (@applications/@me).
 * @param db - Database
 * @param botToken - Bot token
 * @returns Application information object conforming to
 * PrivateApplicationResponse, or null when the bot is unknown
 */
export function getApplication(
  db: Database,
  botToken: string
): {
  id: string
  name: string
  icon: null
  description: string
  type: null
  verify_key: string
  flags: number
  flags_new: string
  redirect_uris: string[]
  interactions_endpoint_url: string | null
  role_connections_verification_url: string | null
  bot_public: boolean
  bot_require_code_grant: boolean
  owner: UserObject
  approximate_guild_count: number
  approximate_user_install_count: number
  approximate_user_authorization_count: number
  explicit_content_filter: number
  team: null
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
    type: null,
    verify_key:
      '0000000000000000000000000000000000000000000000000000000000000000',
    flags: 0,
    flags_new: '0',
    redirect_uris: [],
    interactions_endpoint_url: null,
    role_connections_verification_url: null,
    bot_public: true,
    bot_require_code_grant: false,
    owner: user,
    approximate_guild_count: 0,
    approximate_user_install_count: 0,
    approximate_user_authorization_count: 0,
    explicit_content_filter: 0,
    team: null,
  }
}
