/**
 * @file enum-noise.ts
 * @description Declares response fields where an upstream spec change that only
 * adds `oneOf` enum choices is known to be harmless, because Fauxcord always
 * returns a fixed value for that field regardless of how many choices the
 * upstream enum has.
 *
 * Unlike spec/skip.ts (which documents cases where the spec itself is wrong),
 * this file documents cases where the spec is correct but structurally
 * irrelevant to the mock's fixed-value implementation.
 *
 * Only entries listed here are eligible for enum-addition-only suppression in
 * scripts/spec-diff.ts — and only when the detected change is a pure choice-count
 * increase (see isEnumAdditionOnly in scripts/spec-diff.ts). Choice removals or
 * type-shape changes are never suppressed, even for fields listed here.
 */

/** A single enum-noise exemption entry. */
export interface EnumNoiseEntry {
  /** The spec path template (matches spec/manifest.ts specPath). */
  specPath: string
  /** HTTP method (lowercase). */
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  /** Response field name (top-level property name in the response schema). */
  field: string
  /** Why this field is exempt (must reference the fixed value Fauxcord returns). */
  reason: string
}

/** Fields exempt from enum-addition-only drift detection. */
export const ENUM_NOISE: EnumNoiseEntry[] = [
  {
    specPath: '/guilds/{guild_id}',
    method: 'get',
    field: 'features',
    reason:
      'src/services/guilds.ts always returns features: [] (fixed empty array).',
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'patch',
    field: 'features',
    reason:
      'src/services/guilds.ts always returns features: [] (fixed empty array).',
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'get',
    field: 'afk_timeout',
    reason: 'src/services/guilds.ts always returns afk_timeout: 300 (fixed).',
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'patch',
    field: 'afk_timeout',
    reason: 'src/services/guilds.ts always returns afk_timeout: 300 (fixed).',
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'get',
    field: 'mfa_level',
    reason: 'src/services/guilds.ts always returns mfa_level: 0 (fixed).',
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'patch',
    field: 'mfa_level',
    reason: 'src/services/guilds.ts always returns mfa_level: 0 (fixed).',
  },
  {
    specPath: '/users/@me/guilds',
    method: 'get',
    field: 'features',
    reason:
      'src/services/guilds.ts (getBotGuilds) always returns features: [] (fixed empty array).',
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'get',
    field: 'nsfw_level',
    reason: 'src/services/guilds.ts always returns nsfw_level: 0 (fixed).',
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'patch',
    field: 'nsfw_level',
    reason: 'src/services/guilds.ts always returns nsfw_level: 0 (fixed).',
  },
  {
    specPath: '/oauth2/applications/@me',
    method: 'get',
    field: 'explicit_content_filter',
    reason:
      'src/services/users.ts (getApplication) always returns explicit_content_filter: 0 (fixed).',
  },
  {
    specPath: '/applications/@me',
    method: 'get',
    field: 'explicit_content_filter',
    reason:
      'src/services/users.ts (getApplication) always returns explicit_content_filter: 0 (fixed).',
  },
]
