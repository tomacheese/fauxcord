/**
 * @file manifest.ts
 * @description Single source of truth that maps every implemented Fauxcord endpoint
 * to its corresponding Discord OpenAPI spec path and method.
 *
 * This file is used by two tools simultaneously:
 *   1. scripts/spec-diff.ts  — determines which endpoints get a *detailed* structural diff
 *      vs. a count-only summary when comparing spec snapshots.
 *   2. src/spec-contract.test.ts — drives Ajv-based contract tests against the committed
 *      spec snapshot.
 *
 * When you add a new endpoint to the mock, add an entry here too.
 *
 * ## Deliberately excluded routes (no manifest entry)
 *
 * The following implemented routes are intentionally absent from this manifest:
 *
 * - `DELETE /guilds/{guild_id}` — Discord does not expose guild deletion through its
 *   REST API. The mock implements it as a convenience but there is no spec path to map to.
 *
 * - `/_test/*` and `/_mock/*` — These are Fauxcord-specific test-control and health-check
 *   routes that do not exist in the Discord spec.
 *
 * - `GET /channels/{channel_id}/pins` (legacy) and
 *   `PUT/DELETE /channels/{channel_id}/pins/{message_id}` (legacy) — The legacy flat-array
 *   pin API is included in the spec and in the manifest below. The newer
 *   `/channels/{channel_id}/messages/pins` API is the primary variant.
 *
 * - OAuth2 token endpoints (`POST /oauth2/token`, `POST /oauth2/token/revoke`,
 *   `GET/POST /oauth2/authorize`) — These are documented separately from the main
 *   OpenAPI spec and are not present in `specs/openapi.json`.
 *
 * - `GET /oauth2/@me` — Requires a full OAuth2 Authorization Code flow to obtain a valid
 *   Bearer token; impractical to exercise in an isolated unit test without significant
 *   test harness work.
 *
 * - `GET /oauth2/applications/@me` and `GET /applications/@me` — The
 *   `PrivateApplicationResponse` schema requires ~20+ fields that the mock intentionally
 *   omits (Fauxcord is not an application hosting platform). Included in drift detection
 *   only (`contractTested: false`).
 *
 * - `GET /guilds/{guild_id}` — `GuildWithCountsResponse` → `GuildResponse` requires
 *   ~40 fields the mock does not fully implement. Included in drift detection only.
 *
 * ## responseSchemaOverride
 *
 * When the spec response is a `oneOf` and the mock always returns a specific branch,
 * set `responseSchemaOverride` to the `#/components/schemas/<Name>` schema name. This
 * lets contract tests validate against that exact branch rather than the ambiguous union.
 */

/** Seeded test data available to manifest request builders. */
export interface ContractFixture {
  /** Bot token used for Authorization header (e.g. "Bot testtoken") */
  token: string
  /** Bot user ID */
  userId: string
  /** Seeded guild ID */
  guildId: string
  /** Seeded text channel ID */
  channelId: string
  /**
   * Seeded message ID — authored by the bot user.
   * Used for GET/PATCH on channel message endpoints where the bot must own the message.
   */
  messageId: string
  /**
   * Seeded webhook message ID — authored by the webhook user.
   * Used for GET/PATCH on webhook message endpoints.
   */
  webhookMessageId: string
  /** Seeded webhook ID */
  webhookId: string
  /** Seeded webhook token */
  webhookToken: string
  /** Seeded role ID (non-@everyone) */
  roleId: string
  /** Seeded member user ID (a second user who is a member of the guild) */
  memberId: string
  /** Seeded emoji ID */
  emojiId: string
  /** Seeded invite code */
  inviteCode: string
  /** Seeded thread (channel type 11) ID, archived, with the bot as a member */
  threadId: string
}

/** A single entry in the endpoint manifest. */
export interface SpecEndpoint {
  /**
   * The spec path template, using `{param}` notation.
   * @example "/channels/{channel_id}/messages"
   */
  specPath: string
  /** HTTP method (lowercase). */
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  /**
   * Whether this entry has an Ajv contract test in src/spec-contract.test.ts.
   * Set to false for 204 responses, complex OAuth2 flows, or endpoints where
   * the response schema is too permissive or impractical to seed.
   */
  contractTested: boolean
  /**
   * The HTTP status code the mock returns for the happy path.
   * Used by contract tests to assert the correct status before validating the body.
   */
  successStatus: number
  /**
   * Optional override for the response schema to validate against.
   * When set to a `components/schemas/<Name>` key, the contract test validates
   * against that schema directly instead of deriving it from the spec path/method.
   * Use this to pin a specific `oneOf` branch.
   */
  responseSchemaOverride?: string
  /**
   * Builds the HTTP request for the contract test.
   * @param fixture - Seeded test data
   * @returns Object with `path` (under /api/v10) and optional `init` (RequestInit)
   */
  request: (fixture: ContractFixture) => { path: string; init?: RequestInit }
}

/** All implemented Fauxcord endpoints mapped to their spec paths. */
export const MANIFEST: SpecEndpoint[] = [
  // ─── Channels ───────────────────────────────────────────────────────────────

  {
    specPath: '/channels/{channel_id}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildChannelResponse',
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}` }),
  },
  {
    specPath: '/channels/{channel_id}',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildChannelResponse',
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated-channel' }),
      },
    }),
  },
  {
    // DELETE returns the deleted channel (200), but is excluded from contract tests
    // because it is destructive: deleting the shared fixture channel cascades to delete
    // all messages and webhooks in that channel, breaking subsequent tests in the same run.
    specPath: '/channels/{channel_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 200,
    responseSchemaOverride: 'GuildChannelResponse',
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}/messages` }),
  },
  {
    specPath: '/channels/{channel_id}/messages',
    method: 'post',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello, world!' }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Edited message' }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/bulk-delete',
    method: 'post',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/bulk-delete`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [f.messageId] }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/pins',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/pins`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/typing',
    method: 'post',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/typing`,
      init: { method: 'POST' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/pins/{message_id}',
    method: 'put',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/pins/${f.messageId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/pins/{message_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/pins/${f.messageId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions/%F0%9F%91%8D`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me',
    method: 'put',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions/%F0%9F%91%8D/@me`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions/%F0%9F%91%8D/@me`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions/%F0%9F%91%8D/${f.userId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/pins',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}/pins` }),
  },
  {
    specPath: '/channels/{channel_id}/pins/{message_id}',
    method: 'put',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/pins/${f.messageId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/pins/{message_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/pins/${f.messageId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/webhooks',
    method: 'get',
    contractTested: false,
    // Response is an array of oneOf webhook types — too ambiguous to validate
    // without knowing which branch each item belongs to.
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}/webhooks` }),
  },
  {
    specPath: '/channels/{channel_id}/webhooks',
    method: 'post',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/webhooks`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Webhook' }),
      },
    }),
  },
  {
    // 204 response, nothing to validate against the schema.
    specPath: '/channels/{channel_id}/permissions/{overwrite_id}',
    method: 'put',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/permissions/${f.roleId}`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 0, allow: '0', deny: '0' }),
      },
    }),
  },
  {
    // 204 response, nothing to validate against the schema.
    specPath: '/channels/{channel_id}/permissions/{overwrite_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/permissions/${f.roleId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    // Response is an array of oneOf invite types. Following the
    // GET /channels/{channel_id}/webhooks precedent, this is drift-detection
    // only (contractTested: false) rather than validated per-item.
    specPath: '/channels/{channel_id}/invites',
    method: 'get',
    contractTested: false,
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}/invites` }),
  },
  {
    specPath: '/channels/{channel_id}/invites',
    method: 'post',
    contractTested: true,
    successStatus: 200,
    // The spec response is a oneOf; the mock always returns the guild-invite
    // branch, so pin the schema to GuildInviteResponse.
    responseSchemaOverride: 'GuildInviteResponse',
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/invites`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_age: 3600 }),
      },
    }),
  },

  // ─── Invites ──────────────────────────────────────────────────────────────

  {
    specPath: '/invites/{code}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildInviteResponse',
    request: (f) => ({ path: `/api/v10/invites/${f.inviteCode}` }),
  },
  {
    // DELETE returns the deleted invite (200), but is excluded from contract
    // tests because it is destructive: deleting the fixture invite would break
    // the GET /invites/{code} contract test in the same run.
    specPath: '/invites/{code}',
    method: 'delete',
    contractTested: false,
    successStatus: 200,
    responseSchemaOverride: 'GuildInviteResponse',
    request: (f) => ({
      path: `/api/v10/invites/${f.inviteCode}`,
      init: { method: 'DELETE' },
    }),
  },

  // ─── Guilds ─────────────────────────────────────────────────────────────────

  {
    // GuildWithCountsResponse → GuildResponse requires ~40 required fields.
    // Drift detection only; contract test skipped.
    specPath: '/guilds/{guild_id}',
    method: 'get',
    contractTested: false,
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}` }),
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'patch',
    contractTested: false,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Guild' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/channels',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildChannelResponse',
    // spec says array of GuildChannelResponse — validate each item
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/channels` }),
  },
  {
    specPath: '/guilds/{guild_id}/channels',
    method: 'post',
    contractTested: true,
    successStatus: 201,
    responseSchemaOverride: 'GuildChannelResponse',
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/channels`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-channel', type: 0 }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/members',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/members` }),
  },
  {
    specPath: '/guilds/{guild_id}/members/{user_id}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/members/{user_id}',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: 'TestNick' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/members/{user_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/roles',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/roles` }),
  },
  {
    specPath: '/guilds/{guild_id}/roles',
    method: 'post',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/roles`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-role' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/roles/{role_id}',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/roles/${f.roleId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated-role' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/roles/{role_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/roles/${f.roleId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/emojis',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/emojis` }),
  },
  {
    specPath: '/guilds/{guild_id}/emojis',
    method: 'post',
    contractTested: true,
    successStatus: 201,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/emojis`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'new_emoji',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/emojis/{emoji_id}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/emojis/${f.emojiId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/emojis/{emoji_id}',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/emojis/${f.emojiId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'renamed_emoji' }),
      },
    }),
  },
  {
    // contractTested: false — 204 response, nothing to validate against the schema
    specPath: '/guilds/{guild_id}/emojis/{emoji_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/emojis/${f.emojiId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    // contractTested: false — 204 response, nothing to validate against the schema
    // (consistent with the other 204 role endpoint above).
    specPath: '/guilds/{guild_id}/members/{user_id}/roles/{role_id}',
    method: 'put',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}/roles/${f.roleId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    // contractTested: false — 204 response, nothing to validate against the schema
    // (consistent with the other 204 role endpoint above).
    specPath: '/guilds/{guild_id}/members/{user_id}/roles/{role_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}/roles/${f.roleId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/webhooks',
    method: 'get',
    contractTested: false,
    // Array of oneOf webhook types — too ambiguous without branch pinning
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/webhooks` }),
  },

  // ─── Gateway ────────────────────────────────────────────────────────────────

  {
    specPath: '/gateway',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: () => ({ path: '/api/v10/gateway' }),
  },
  {
    specPath: '/gateway/bot',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: () => ({ path: '/api/v10/gateway/bot' }),
  },

  // ─── Users ──────────────────────────────────────────────────────────────────

  {
    specPath: '/users/@me',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'UserPIIResponse',
    request: () => ({ path: '/api/v10/users/@me' }),
  },
  {
    specPath: '/users/@me',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'UserPIIResponse',
    request: () => ({
      path: '/api/v10/users/@me',
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'UpdatedBot' }),
      },
    }),
  },
  {
    specPath: '/users/{user_id}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'UserResponse',
    request: (f) => ({ path: `/api/v10/users/${f.userId}` }),
  },
  {
    specPath: '/users/@me/guilds',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'MyGuildResponse',
    // Returns an array; each item validated against MyGuildResponse
    request: () => ({ path: '/api/v10/users/@me/guilds' }),
  },

  // ─── OAuth2 ─────────────────────────────────────────────────────────────────

  {
    // PrivateApplicationResponse requires ~20 fields the mock omits intentionally.
    // Drift detection only; contract test skipped.
    specPath: '/oauth2/applications/@me',
    method: 'get',
    contractTested: false,
    successStatus: 200,
    request: () => ({ path: '/api/v10/oauth2/applications/@me' }),
  },
  {
    specPath: '/oauth2/@me',
    method: 'get',
    contractTested: false,
    // Requires a full OAuth2 Authorization Code flow to obtain a Bearer token.
    successStatus: 200,
    request: () => ({ path: '/api/v10/oauth2/@me' }),
  },

  // ─── Webhooks ───────────────────────────────────────────────────────────────

  {
    specPath: '/webhooks/{webhook_id}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    request: (f) => ({ path: `/api/v10/webhooks/${f.webhookId}` }),
  },
  {
    specPath: '/webhooks/{webhook_id}',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Webhook' }),
      },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}`,
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}',
    method: 'post',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'MessageResponse',
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}?wait=true`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Webhook message' }),
      },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Token Updated Webhook' }),
      },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'MessageResponse',
    // webhookMessageId is authored by the webhook user (required for webhook message routes)
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}/messages/${f.webhookMessageId}`,
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}',
    method: 'patch',
    contractTested: true,
    successStatus: 200,
    responseSchemaOverride: 'MessageResponse',
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}/messages/${f.webhookMessageId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Edited webhook message' }),
      },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}/messages/${f.webhookMessageId}`,
      init: { method: 'DELETE' },
    }),
  },

  // ─── Threads ─────────────────────────────────────────────────────────────
  {
    specPath: '/channels/{channel_id}/threads',
    method: 'post',
    contractTested: true,
    successStatus: 201,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/threads`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-thread', type: 11 }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/threads',
    method: 'post',
    contractTested: true,
    successStatus: 201,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/threads`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'msg-thread' }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/{user_id}',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members/${f.userId}`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/@me',
    method: 'put',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members/@me`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/@me',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members/@me`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/{user_id}',
    method: 'put',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members/${f.memberId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/{user_id}',
    method: 'delete',
    contractTested: false,
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members/${f.memberId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/threads/archived/public',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/threads/archived/public`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/threads/archived/private',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/threads/archived/private`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/users/@me/threads/archived/private',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/users/@me/threads/archived/private`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/threads/search',
    method: 'get',
    contractTested: true,
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/threads/search`,
    }),
  },
]

/**
 * Returns only the manifest entries that should be contract-tested
 * (i.e. have a non-empty response body and a mapped schema to validate against).
 */
export function getContractTestedEntries(): SpecEndpoint[] {
  return MANIFEST.filter((e) => e.contractTested)
}
