import { beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import { seedBearerCredential } from '../test-helpers'
import { getOpenIdUserInfo, getPublicKeys } from './oauth2'

describe('OAuth2 discovery and OpenID service', () => {
  let db: Database

  beforeEach(() => {
    db = initializeDatabase(':memory:')
  })

  it('returns a deterministic public signing key set', () => {
    expect(getPublicKeys()).toEqual({
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          kid: 'fauxcord-local-key',
          n: 'ZmF1eGNvcmQtbG9jYWwtbW9kdWx1cw',
          e: 'AQAB',
          alg: 'RS256',
        },
      ],
    })
  })

  it('returns seeded user identity for an unexpired openid Bearer token', () => {
    const credential = seedBearerCredential(db)
    db.prepare(
      "UPDATE oauth2_access_tokens SET scope = 'identify openid' WHERE token = ?"
    ).run(credential.bearerToken)

    expect(getOpenIdUserInfo(db, credential.bearerToken)).toEqual({
      sub: credential.userId,
      preferred_username: 'BearerUser',
    })
  })

  it('rejects a token without openid scope or a user principal', () => {
    const credential = seedBearerCredential(db)
    expect(getOpenIdUserInfo(db, credential.bearerToken)).toBeNull()
    db.prepare(
      "UPDATE oauth2_access_tokens SET scope = 'openid', user_id = NULL WHERE token = ?"
    ).run(credential.bearerToken)
    expect(getOpenIdUserInfo(db, credential.bearerToken)).toBeNull()
  })
})
