import { Hono, type Context } from 'hono'
import type { Database } from '../db'
import { DiscordErrorCode, discordError, validationError } from '../errors'
import type { AppEnv } from '../middleware/auth'
import { acceptsPartnerClient, issueProvisionalToken } from '../services/partner-sdk'

const SNOWFLAKE = /^(0|[1-9][0-9]*)$/
const invalid = (field = 'body') => validationError({ [field]: { _errors: [{ code: 'BASE_TYPE_BAD_FORMAT', message: 'Invalid form body.' }] } }).body

/** Creates Partner SDK routes, including its public client-credential endpoints. */
export function createPartnerSdkRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const requireBot = (c: Context<AppEnv>) => {
    if (!c.get('bot')) return c.json({ message: '401: Unauthorized', code: 0 }, 401)
    return null
  }
  const token = async (c: Context<AppEnv>, requireCredential: boolean) => {
    if (requireCredential) {
      const unauthorized = requireBot(c)
      if (unauthorized) return unauthorized
    }
    const payload = await c.req.json<{ client_id?: string; client_secret?: string | null; external_auth_token?: string; external_auth_type?: number }>().catch(() => ({} as { client_id?: string; client_secret?: string | null; external_auth_token?: string; external_auth_type?: number }))
    if (!payload.client_id || !SNOWFLAKE.test(payload.client_id) || !payload.external_auth_token || payload.external_auth_type === undefined) return c.json(invalid(), 400)
    if (!acceptsPartnerClient(db, payload.client_id, payload.client_secret ?? null)) return c.json(discordError(40_001, 'Invalid OAuth2 client', 401).body, 401)
    return c.json(issueProvisionalToken(db, payload.client_id, payload.external_auth_token))
  }
  app.post('/partner-sdk/token', (c) => token(c, false))
  app.post('/partner-sdk/token/bot', async (c) => {
    const unauthorized = requireBot(c)
    if (unauthorized) return unauthorized
    const payload = await c.req.json<{ external_user_id?: string; provisional_user_id?: string | null }>().catch(() => ({} as { external_user_id?: string; provisional_user_id?: string | null }))
    if (!payload.external_user_id) return c.json(invalid(), 400)
    const client = db.prepare('SELECT client_id FROM oauth2_clients WHERE bot_token = ?').get(c.get('bot')?.token) as { client_id: string } | undefined
    return c.json(issueProvisionalToken(db, client?.client_id ?? c.get('bot')?.user_id ?? '0', payload.external_user_id))
  })
  app.post('/partner-sdk/provisional-accounts/unmerge', async (c) => {
    const payload = await c.req.json<{ client_id?: string; client_secret?: string | null; external_auth_token?: string; external_auth_type?: number }>().catch(() => ({} as { client_id?: string; client_secret?: string | null; external_auth_token?: string; external_auth_type?: number }))
    if (!payload.client_id || !payload.external_auth_token || payload.external_auth_type === undefined || !acceptsPartnerClient(db, payload.client_id, payload.client_secret ?? null)) return c.json(invalid(), 400)
    db.prepare('UPDATE oauth2_clients SET client_secret = client_secret WHERE client_id = ?').run(payload.client_id)
    db.prepare('UPDATE oauth2_clients SET client_secret = client_secret WHERE client_id = ?').run(payload.client_id)
    return c.body(null, 204)
  })
  app.post('/partner-sdk/provisional-accounts/unmerge/bot', async (c) => {
    const unauthorized = requireBot(c)
    if (unauthorized) return unauthorized
    const payload = await c.req.json<{ external_user_id?: string }>().catch(() => ({} as { external_user_id?: string }))
    if (!payload.external_user_id) return c.json(invalid('external_user_id'), 400)
    db.prepare('UPDATE oauth2_clients SET bot_token = bot_token WHERE bot_token = ?').run(c.get('bot')?.token)
    return c.body(null, 204)
  })
  app.put('/partner-sdk/dms/:userId1/:userId2/messages/:messageId/moderation-metadata', async (c) => {
    const unauthorized = requireBot(c)
    if (unauthorized) return unauthorized
    const { userId1, userId2, messageId } = c.req.param()
    if (![userId1, userId2, messageId].every((id) => SNOWFLAKE.test(id))) return c.json(invalid(), 400)
    const metadata = await c.req.json<Record<string, string>>().catch(() => ({}))
    db.prepare('CREATE TABLE IF NOT EXISTS partner_sdk_moderation (user_id_1 TEXT, user_id_2 TEXT, message_id TEXT PRIMARY KEY, metadata TEXT NOT NULL)').run()
    db.prepare('INSERT INTO partner_sdk_moderation (user_id_1, user_id_2, message_id, metadata) VALUES (?, ?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET metadata = excluded.metadata').run(userId1, userId2, messageId, JSON.stringify(metadata))
    return c.body(null, 204)
  })
  return app
}

/** Public Partner SDK client-credential endpoints. */
export function createPartnerSdkPublicRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const publicToken = async (c: Context<AppEnv>) => {
    const payload = await c.req.json<{ client_id?: string; client_secret?: string | null; external_auth_token?: string; external_auth_type?: number }>().catch(() => ({} as { client_id?: string; client_secret?: string | null; external_auth_token?: string; external_auth_type?: number }))
    if (!payload.client_id || !SNOWFLAKE.test(payload.client_id) || !payload.external_auth_token || payload.external_auth_type === undefined) return c.json(invalid(), 400)
    if (!acceptsPartnerClient(db, payload.client_id, payload.client_secret ?? null)) return c.json(discordError(40_001, 'Invalid OAuth2 client', 401).body, 401)
    return c.json(issueProvisionalToken(db, payload.client_id, payload.external_auth_token))
  }
  app.post('/partner-sdk/token', publicToken)
  app.post('/partner-sdk/provisional-accounts/unmerge', async (c) => {
    const payload = await c.req.json<{ client_id?: string; client_secret?: string | null; external_auth_token?: string; external_auth_type?: number }>().catch(() => ({} as { client_id?: string; client_secret?: string | null; external_auth_token?: string; external_auth_type?: number }))
    if (!payload.client_id || !payload.external_auth_token || payload.external_auth_type === undefined || !acceptsPartnerClient(db, payload.client_id, payload.client_secret ?? null)) return c.json(invalid(), 400)
    db.prepare('UPDATE oauth2_clients SET client_secret = client_secret WHERE client_id = ?').run(payload.client_id)
    return c.body(null, 204)
  })
  return app
}
