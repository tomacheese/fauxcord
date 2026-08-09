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
  db.prepare(
    `INSERT INTO partner_sdk_provisional_identities
       (client_id, external_auth_token, user_id)
     VALUES (?, ?, ?)
     ON CONFLICT(client_id, external_auth_token) DO UPDATE SET user_id = excluded.user_id`
  ).run(clientId, externalUserId, userId)
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

/** Removes only the provisional identity association, preserving OAuth credentials. */
export function unmergeProvisionalIdentity(
  db: Database,
  clientId: string,
  externalAuthToken: string
): void {
  db.transaction(() => {
    db.prepare(
      `DELETE FROM partner_sdk_provisional_identities
       WHERE client_id = ? AND external_auth_token = ?`
    ).run(clientId, externalAuthToken)
  })()
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
