import type { Database } from '../db'
import { generateSnowflake } from '../snowflake'

export interface ProvisionalToken {
  token_type: string
  access_token: string
  expires_in: number
  scope: string
  id_token: string
  refresh_token: string | null
  scopes: string[]
  expires_at_s: number
}

export function issueProvisionalToken(
  db: Database,
  clientId: string,
  externalUserId: string
): ProvisionalToken {
  const userId = generateSnowflake()
  db.prepare(
    "INSERT INTO users (id, username, discriminator, bot) VALUES (?, ?, '0', 0)"
  ).run(userId, `provisional-${externalUserId.slice(0, 24)}`)
  const accessToken = `provisional_${generateSnowflake()}`
  const expiresAt = new Date(Date.now() + 3_600_000)
  db.prepare(
    `INSERT INTO oauth2_access_tokens (token, client_id, user_id, scope, expires_at)
     VALUES (?, ?, ?, 'identify', ?)`
  ).run(accessToken, clientId, userId, expiresAt.toISOString())
  return {
    token_type: 'Bearer',
    access_token: accessToken,
    expires_in: 3600,
    scope: 'identify',
    id_token: `provisional-id-${userId}`,
    refresh_token: null,
    scopes: ['identify'],
    expires_at_s: Math.floor(expiresAt.getTime() / 1000),
  }
}

export function acceptsPartnerClient(
  db: Database,
  clientId: string,
  clientSecret: string | null
): boolean {
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM oauth2_clients WHERE client_id = ? AND (? IS NULL OR client_secret = ?)'
      )
      .get(clientId, clientSecret, clientSecret)
  )
}
