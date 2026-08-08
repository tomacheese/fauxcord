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
 * ## Now contract-tested (previously excluded)
 *
 * `GET /guilds/{guild_id}`, `PATCH /guilds/{guild_id}`, `GET /applications/@me`,
 * and `GET /oauth2/applications/@me` are now mapped in the manifest and
 * contract-tested. The mock returns fixed null/default values for fields it does
 * not model (guild: splash/banner/nsfw_level/stickers/incidents_data etc.;
 * application: verify_key/team/flags/redirect_uris etc.), so their responses
 * fully satisfy `GuildWithCountsResponse` / `GuildResponse` /
 * `PrivateApplicationResponse`.
 *
 * ## responseSchemaOverride
 *
 * When the spec response is a `oneOf` and the mock always returns a specific branch,
 * set `responseSchemaOverride` to the `#/components/schemas/<Name>` schema name. This
 * lets contract tests validate against that exact branch rather than the ambiguous union.
 */

import type { Database } from '../src/db'

/** Seeded test data available to manifest request builders. */
export interface ContractFixture {
  /** Isolated datastore used to verify operation-specific state changes. */
  db: Database
  /** Bot token used for Authorization header (e.g. "Bot testtoken") */
  token: string
  /** Bot user ID */
  userId: string
  /** Local OAuth2 Bearer token without the scheme prefix. */
  bearerToken: string
  /** Seeded guild ID */
  guildId: string
  /** Seeded text channel ID */
  channelId: string
  /** Seeded text channel without searchable threads. */
  unindexedChannelId: string
  /** Seeded announcement channel ID. */
  announcementChannelId: string
  /** Seeded announcement-channel message ID. */
  announcementMessageId: string
  /** Seeded voice channel ID. */
  voiceChannelId: string
  /** Seeded group-DM channel ID. */
  groupDmChannelId: string
  /**
   * Seeded message ID — authored by the bot user.
   * Used for GET/PATCH on channel message endpoints where the bot must own the message.
   */
  messageId: string
  /** Message reserved for destructive request branches. */
  deletableMessageId: string
  /** Message pinned before destructive pin-removal branches. */
  pinnedMessageId: string
  /** Message with a seeded bot reaction for destructive reaction branches. */
  reactedMessageId: string
  /** Message containing a seeded poll. */
  pollMessageId: string
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
  /** Seeded role reserved for role deletion. */
  deletableRoleId: string
  /** Seeded role already assigned to the member. */
  assignedRoleId: string
  /** Seeded permission overwrite reserved for deletion. */
  deletableOverwriteId: string
  /** Seeded member user ID (a second user who is a member of the guild) */
  memberId: string
  /** Seeded emoji ID */
  emojiId: string
  /** Seeded invite code */
  inviteCode: string
  /**
   * A second, disposable invite code used exclusively by the destructive
   * DELETE /invites/{code} contract test so it does not consume the
   * inviteCode fixture that GET /invites/{code} relies on.
   */
  deletableInviteCode: string
  /** Seeded banned user ID (a user with a ban record in the guild) */
  bannedUserId: string
  /** Seeded unbanned user used by the ban-creation branch. */
  banTargetUserId: string
  /** Seeded thread (channel type 11) ID, archived, with the bot as a member */
  threadId: string
  /** Seeded thread that the bot has not joined. */
  joinableThreadId: string
  /** Seeded thread containing the secondary member. */
  memberThreadId: string
  /** Existing group-DM recipient reserved for removal. */
  removableRecipientId: string
  /** Seeded global application command ID */
  commandId: string
  /** Seeded guild-scoped application command ID */
  guildCommandId: string
  /** Seeded interaction ID (guild-scoped, channel-bound) */
  interactionId: string
  /** Seeded interaction token */
  interactionToken: string
  /** Interaction ID with an existing original response. */
  originalInteractionId: string
  /** Interaction token with an existing original response. */
  originalInteractionToken: string
}

/** Authentication mechanism required by an operation. */
export type ContractAuthentication = 'bot' | 'bearer' | 'webhook' | 'public'

/** Response body handling used by contract and network tests. */
export type ContractBodyMode = 'json' | 'empty' | 'png' | 'csv'

/** Concrete HTTP request produced for a success branch. */
export interface ContractRequest {
  path: string
  init?: RequestInit
}

/** Factory supplied by a contract runner for isolated operation state. */
export interface ContractFixtureFactory {
  create: () => Promise<ContractFixture>
}

/** Context supplied after a real HTTP request finishes. */
export interface NetworkAssertionContext {
  baseUrl: string
  fixture: ContractFixture
  response: Response
}

/** One OpenAPI success response branch for an operation. */
export interface SpecSuccessBranch {
  status: number
  contentType: string | null
  body: ContractBodyMode
  responseSchemaOverride?: string
  request: (fixture: ContractFixture) => ContractRequest
  assert: (context: NetworkAssertionContext) => Promise<void>
}

/** A single unique OpenAPI operation entry. */
export interface SpecEndpoint {
  /**
   * The spec path template, using `{param}` notation.
   * @example "/channels/{channel_id}/messages"
   */
  specPath: string
  /** HTTP method (lowercase). */
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  authentication: ContractAuthentication
  createFixture: (
    factory: ContractFixtureFactory
  ) => Promise<ContractFixture>
  successBranches: SpecSuccessBranch[]
}

interface LegacySpecEndpoint {
  specPath: string
  method: SpecEndpoint['method']
  successStatus: number
  responseSchemaOverride?: string
  request: (fixture: ContractFixture) => ContractRequest
}

/** All implemented Fauxcord endpoints mapped to their spec paths. */
const LEGACY_MANIFEST: LegacySpecEndpoint[] = [
  // ─── Channels ───────────────────────────────────────────────────────────────

  {
    specPath: '/channels/{channel_id}',
    method: 'get',
    successStatus: 200,
    responseSchemaOverride: 'GuildChannelResponse',
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}` }),
  },
  {
    specPath: '/channels/{channel_id}',
    method: 'patch',
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
    specPath: '/channels/{channel_id}',
    method: 'delete',
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
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}/messages` }),
  },
  {
    specPath: '/channels/{channel_id}/messages',
    method: 'post',
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
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}',
    method: 'patch',
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
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.deletableMessageId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/bulk-delete',
    method: 'post',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/bulk-delete`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [f.messageId, f.deletableMessageId],
        }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/pins',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/pins`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/typing',
    method: 'post',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/typing`,
      init: { method: 'POST' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/pins/{message_id}',
    method: 'put',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/pins/${f.messageId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/pins/{message_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/pins/${f.pinnedMessageId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions/%F0%9F%91%8D`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me',
    method: 'put',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions/%F0%9F%91%8D/@me`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.reactedMessageId}/reactions/%F0%9F%91%8D/@me`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.reactedMessageId}/reactions/%F0%9F%91%8D/${f.userId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/messages/{message_id}/reactions',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.reactedMessageId}/reactions`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/pins',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}/pins` }),
  },
  {
    specPath: '/channels/{channel_id}/pins/{message_id}',
    method: 'put',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/pins/${f.messageId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/pins/{message_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/pins/${f.pinnedMessageId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/webhooks',
    method: 'get',
    // Response is an array of oneOf webhook types; the mock only ever returns
    // the incoming-webhook branch, so pin the schema to validate each item.
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}/webhooks` }),
  },
  {
    specPath: '/channels/{channel_id}/webhooks',
    method: 'post',
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
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/permissions/${f.deletableOverwriteId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    // Response is an array of oneOf invite types; the mock only ever returns
    // the guild-invite branch, so pin the schema to validate each item.
    specPath: '/channels/{channel_id}/invites',
    method: 'get',
    responseSchemaOverride: 'GuildInviteResponse',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/channels/${f.channelId}/invites` }),
  },
  {
    specPath: '/channels/{channel_id}/invites',
    method: 'post',
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
    successStatus: 200,
    responseSchemaOverride: 'GuildInviteResponse',
    request: (f) => ({ path: `/api/v10/invites/${f.inviteCode}` }),
  },
  {
    // DELETE returns the deleted invite (200). It uses a dedicated disposable
    // invite fixture so deleting it does not break the GET /invites/{code}
    // contract test that runs against the shared inviteCode fixture.
    specPath: '/invites/{code}',
    method: 'delete',
    successStatus: 200,
    responseSchemaOverride: 'GuildInviteResponse',
    request: (f) => ({
      path: `/api/v10/invites/${f.deletableInviteCode}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    // Response is an array of oneOf invite types; the mock only ever returns
    // the guild-invite branch, so pin the schema to validate each item (same
    // pattern as the existing /channels/{channel_id}/invites entry above).
    specPath: '/guilds/{guild_id}/invites',
    method: 'get',
    responseSchemaOverride: 'GuildInviteResponse',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/invites` }),
  },
  {
    // Response body is a raw CSV file (text/csv), not JSON. The contract
    // test harness always calls res.json() on non-204 responses, so a
    // CSV body is impractical to validate via Ajv here; covered instead by
    // the route-level tests in src/routes/invites.test.ts.
    specPath: '/invites/{code}/target-users',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/invites/${f.inviteCode}/target-users`,
    }),
  },
  {
    // 204 response, only the status code is asserted.
    specPath: '/invites/{code}/target-users',
    method: 'put',
    successStatus: 204,
    request: (f) => {
      const formData = new FormData()
      formData.set(
        'target_users_file',
        new File(['user_id\n999999999999999999\n'], 'target_users.csv', {
          type: 'text/csv',
        })
      )
      return {
        path: `/api/v10/invites/${f.inviteCode}/target-users`,
        init: { method: 'PUT', body: formData },
      }
    },
  },
  {
    specPath: '/invites/{code}/target-users/job-status',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/invites/${f.inviteCode}/target-users/job-status`,
    }),
  },

  // ─── Guilds ─────────────────────────────────────────────────────────────────

  {
    specPath: '/guilds/{guild_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}` }),
  },
  {
    specPath: '/guilds/{guild_id}',
    method: 'patch',
    successStatus: 200,
    responseSchemaOverride: 'GuildResponse',
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
    successStatus: 200,
    responseSchemaOverride: 'GuildChannelResponse',
    // spec says array of GuildChannelResponse — validate each item
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/channels` }),
  },
  {
    specPath: '/guilds/{guild_id}/channels',
    method: 'post',
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
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/members` }),
  },
  {
    specPath: '/guilds/{guild_id}/members/{user_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/members/@me',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/@me`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: 'SelfNick' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/members/{user_id}',
    method: 'patch',
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
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/roles',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/roles` }),
  },
  {
    specPath: '/guilds/{guild_id}/roles',
    method: 'post',
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
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/roles/${f.deletableRoleId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/emojis',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/emojis` }),
  },
  {
    specPath: '/guilds/{guild_id}/emojis',
    method: 'post',
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
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/emojis/${f.emojiId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/emojis/{emoji_id}',
    method: 'patch',
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
    specPath: '/guilds/{guild_id}/emojis/{emoji_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/emojis/${f.emojiId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/bans',
    method: 'get',
    // spec response is type ["array","null"] of GuildBanResponse — validated per-item
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/bans` }),
  },
  {
    specPath: '/guilds/{guild_id}/bans/{user_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/bans/${f.bannedUserId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/bans/{user_id}',
    method: 'put',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/bans/${f.banTargetUserId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/bans/{user_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/bans/${f.bannedUserId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    // (consistent with the other 204 role endpoint above).
    specPath: '/guilds/{guild_id}/members/{user_id}/roles/{role_id}',
    method: 'put',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}/roles/${f.roleId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    // (consistent with the other 204 role endpoint above).
    specPath: '/guilds/{guild_id}/members/{user_id}/roles/{role_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.memberId}/roles/${f.assignedRoleId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/webhooks',
    method: 'get',
    // Same as channel webhooks: mock returns only the incoming-webhook branch.
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/webhooks` }),
  },

  // ─── Gateway ────────────────────────────────────────────────────────────────

  {
    specPath: '/gateway',
    method: 'get',
    successStatus: 200,
    request: () => ({ path: '/api/v10/gateway' }),
  },
  {
    specPath: '/gateway/bot',
    method: 'get',
    successStatus: 200,
    request: () => ({ path: '/api/v10/gateway/bot' }),
  },

  // ─── Soundboard ─────────────────────────────────────────────────────────────

  {
    specPath: '/soundboard-default-sounds',
    method: 'get',
    successStatus: 200,
    request: () => ({ path: '/api/v10/soundboard-default-sounds' }),
  },

  // ─── Users ──────────────────────────────────────────────────────────────────

  {
    specPath: '/users/@me',
    method: 'get',
    successStatus: 200,
    responseSchemaOverride: 'UserPIIResponse',
    request: () => ({ path: '/api/v10/users/@me' }),
  },
  {
    specPath: '/users/@me',
    method: 'patch',
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
    successStatus: 200,
    responseSchemaOverride: 'UserResponse',
    request: (f) => ({ path: `/api/v10/users/${f.userId}` }),
  },
  {
    specPath: '/users/@me/guilds',
    method: 'get',
    successStatus: 200,
    responseSchemaOverride: 'MyGuildResponse',
    // Returns an array; each item validated against MyGuildResponse
    request: () => ({ path: '/api/v10/users/@me/guilds' }),
  },

  // ─── OAuth2 ─────────────────────────────────────────────────────────────────

  {
    specPath: '/oauth2/applications/@me',
    method: 'get',
    successStatus: 200,
    responseSchemaOverride: 'PrivateApplicationResponse',
    request: () => ({ path: '/api/v10/oauth2/applications/@me' }),
  },
  {
    // Implemented and present in the upstream spec; mapped here so it is both
    // drift-detected and contract-tested (previously missing from the manifest).
    specPath: '/applications/@me',
    method: 'get',
    successStatus: 200,
    responseSchemaOverride: 'PrivateApplicationResponse',
    request: () => ({ path: '/api/v10/applications/@me' }),
  },
  {
    specPath: '/oauth2/@me',
    method: 'get',
    // Requires a full OAuth2 Authorization Code flow to obtain a Bearer token.
    successStatus: 200,
    request: () => ({ path: '/api/v10/oauth2/@me' }),
  },

  // ─── Webhooks ───────────────────────────────────────────────────────────────

  {
    specPath: '/webhooks/{webhook_id}',
    method: 'get',
    successStatus: 200,
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    request: (f) => ({ path: `/api/v10/webhooks/${f.webhookId}` }),
  },
  {
    specPath: '/webhooks/{webhook_id}',
    method: 'patch',
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
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}',
    method: 'get',
    successStatus: 200,
    responseSchemaOverride: 'GuildIncomingWebhookResponse',
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}`,
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}',
    method: 'post',
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
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}',
    method: 'get',
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
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}/messages/${f.webhookMessageId}`,
      init: { method: 'DELETE' },
    }),
  },

  // ── Application Commands (global) ─────────────────────────────────────
  {
    specPath: '/applications/{application_id}/commands',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/commands`,
    }),
  },
  {
    specPath: '/applications/{application_id}/commands',
    method: 'post',
    successStatus: 201,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/commands`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'contractcreate', description: 'x' }),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}/commands',
    method: 'put',
    // Bulk overwrite is destructive to fixture state shared across tests;
    // covered by src/routes/application-commands.test.ts instead.
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/commands`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ name: 'ping', description: 'x' }]),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}/commands/{command_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/commands/${f.commandId}`,
    }),
  },
  {
    specPath: '/applications/{application_id}/commands/{command_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/commands/${f.commandId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'updated' }),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}/commands/{command_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/commands/${f.commandId}`,
      init: { method: 'DELETE' },
    }),
  },
  // ── Application Commands (guild) ──────────────────────────────────────
  {
    specPath: '/applications/{application_id}/guilds/{guild_id}/commands',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands`,
    }),
  },
  {
    specPath: '/applications/{application_id}/guilds/{guild_id}/commands',
    method: 'post',
    successStatus: 201,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'guildcreate', description: 'x' }),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}/guilds/{guild_id}/commands',
    method: 'put',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ name: 'guildping', description: 'x' }]),
      },
    }),
  },
  {
    specPath:
      '/applications/{application_id}/guilds/{guild_id}/commands/{command_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands/${f.guildCommandId}`,
    }),
  },
  {
    specPath:
      '/applications/{application_id}/guilds/{guild_id}/commands/{command_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands/${f.guildCommandId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'updated' }),
      },
    }),
  },
  {
    specPath:
      '/applications/{application_id}/guilds/{guild_id}/commands/{command_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands/${f.guildCommandId}`,
      init: { method: 'DELETE' },
    }),
  },
  // ── Command Permissions ────────────────────────────────────────────────
  {
    specPath:
      '/applications/{application_id}/guilds/{guild_id}/commands/permissions',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands/permissions`,
    }),
  },
  {
    specPath:
      '/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands/${f.guildCommandId}/permissions`,
    }),
  },
  {
    specPath:
      '/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions',
    method: 'put',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.userId}/guilds/${f.guildId}/commands/${f.guildCommandId}/permissions`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissions: [{ id: f.roleId, type: 1, permission: true }],
        }),
      },
    }),
  },
  // ── Interactions ────────────────────────────────────────────────────────
  {
    specPath: '/interactions/{interaction_id}/{interaction_token}/callback',
    method: 'post',
    // 204 No Content — no response body schema to validate.
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/interactions/${f.interactionId}/${f.interactionToken}/callback`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 5 }),
      },
    }),
  },
  {
    // Followup messages reuse the Webhook execute endpoint — Discord treats
    // application_id/interaction_token as webhook_id/webhook_token, so the
    // spec path is the same `webhook_token` template as the regular webhook
    // execute entry above (there is no distinct openapi path for this).
    specPath: '/webhooks/{webhook_id}/{webhook_token}',
    method: 'post',
    successStatus: 200,
    responseSchemaOverride: 'MessageResponse',
    request: (f) => ({
      path: `/api/v10/webhooks/${f.userId}/${f.interactionToken}?wait=true`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Followup message' }),
      },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}',
    method: 'get',
    // Depends on a message created by the followup POST above, whose ID is
    // not deterministic ahead of time within this fixture; covered by
    // src/routes/webhooks.test.ts instead.
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/webhooks/${f.userId}/${f.interactionToken}/messages/${f.webhookMessageId}`,
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}/messages/@original',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/webhooks/${f.userId}/${f.originalInteractionToken}/messages/@original`,
    }),
  },

  // ─── Threads ─────────────────────────────────────────────────────────────
  {
    specPath: '/channels/{channel_id}/threads',
    method: 'post',
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
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/{user_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members/${f.userId}`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/@me',
    method: 'put',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.joinableThreadId}/thread-members/@me`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/@me',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members/@me`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/{user_id}',
    method: 'put',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.threadId}/thread-members/${f.memberId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/thread-members/{user_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.memberThreadId}/thread-members/${f.memberId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/threads/archived/public',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/threads/archived/public`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/threads/archived/private',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/threads/archived/private`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/users/@me/threads/archived/private',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/users/@me/threads/archived/private`,
    }),
  },
  {
    specPath: '/channels/{channel_id}/threads/search',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/threads/search`,
    }),
  },

  // ─── Issue #136 ─────────────────────────────────────────────────────────────

  {
    specPath: '/channels/{channel_id}/messages/{message_id}/crosspost',
    method: 'post',
    successStatus: 200,
    request: (f: ContractFixture) => ({
      path: `/api/v10/channels/${f.announcementChannelId}/messages/${f.announcementMessageId}/crosspost`,
      init: { method: 'POST' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/followers',
    method: 'post',
    successStatus: 200,
    request: (f: ContractFixture) => ({
      path: `/api/v10/channels/${f.announcementChannelId}/followers`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_channel_id: f.channelId }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/voice-status',
    method: 'put',
    successStatus: 204,
    request: (f: ContractFixture) => ({
      path: `/api/v10/channels/${f.voiceChannelId}/voice-status`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contract test' }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/recipients/{user_id}',
    method: 'put',
    successStatus: 204,
    request: (f: ContractFixture) => ({
      path: `/api/v10/channels/${f.groupDmChannelId}/recipients/${f.memberId}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/recipients/{user_id}',
    method: 'delete',
    successStatus: 204,
    request: (f: ContractFixture) => ({
      path: `/api/v10/channels/${f.groupDmChannelId}/recipients/${f.removableRecipientId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/users/@me/channels',
    method: 'post',
    successStatus: 200,
    request: (f: ContractFixture) => ({
      path: '/api/v10/users/@me/channels',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: f.memberId }),
      },
    }),
  },
  {
    specPath: '/channels/{channel_id}/polls/{message_id}/answers/{answer_id}',
    method: 'get',
    successStatus: 200,
    request: (f: ContractFixture) => ({
      path: `/api/v10/channels/${f.channelId}/polls/${f.pollMessageId}/answers/1`,
      init: {},
    }),
  },
  {
    specPath: '/channels/{channel_id}/polls/{message_id}/expire',
    method: 'post',
    successStatus: 200,
    request: (f: ContractFixture) => ({
      path: `/api/v10/channels/${f.channelId}/polls/${f.pollMessageId}/expire`,
      init: { method: 'POST' },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}/github',
    method: 'post',
    successStatus: 204,
    request: (f: ContractFixture) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}/github`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: { login: 'octocat' } }),
      },
    }),
  },
  {
    specPath: '/webhooks/{webhook_id}/{webhook_token}/slack',
    method: 'post',
    successStatus: 200,
    request: (f: ContractFixture) => ({
      path: `/api/v10/webhooks/${f.webhookId}/${f.webhookToken}/slack`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'contract test' }),
      },
    }),
  },
]

const MULTI_SUCCESS_STATUSES: Readonly<Record<string, readonly number[]>> = {
  'post /channels/{channel_id}/typing': [200, 204],
  'post /channels/{channel_id}/invites': [200, 204],
  'patch /guilds/{guild_id}/members/{user_id}': [200, 204],
  'post /applications/{application_id}/commands': [200, 201],
  'post /applications/{application_id}/guilds/{guild_id}/commands': [200, 201],
  'post /interactions/{interaction_id}/{interaction_token}/callback': [200, 204],
  'get /channels/{channel_id}/threads/search': [200, 202],
  'put /channels/{channel_id}/recipients/{user_id}': [201, 204],
  'post /webhooks/{webhook_id}/{webhook_token}': [200, 204],
}

function authenticationFor(entry: LegacySpecEndpoint): ContractAuthentication {
  if (entry.specPath === '/gateway') return 'public'
  if (entry.specPath === '/oauth2/@me') return 'bearer'
  if (
    entry.specPath.startsWith('/webhooks/{webhook_id}/{webhook_token}') ||
    entry.specPath ===
      '/interactions/{interaction_id}/{interaction_token}/callback'
  ) {
    return 'webhook'
  }
  return 'bot'
}

function responseContract(
  entry: LegacySpecEndpoint,
  status: number
): Pick<SpecSuccessBranch, 'body' | 'contentType'> {
  if (status === 204) return { body: 'empty', contentType: null }
  if (entry.specPath.endsWith('/widget.png')) {
    return { body: 'png', contentType: 'image/png' }
  }
  if (entry.specPath.endsWith('/target-users')) {
    return { body: 'csv', contentType: 'text/csv' }
  }
  return { body: 'json', contentType: 'application/json' }
}

function alternateRequest(
  entry: LegacySpecEndpoint,
  status: number,
  fixture: ContractFixture
): ContractRequest {
  const request = entry.request(fixture)
  const key = `${entry.method} ${entry.specPath}`
  if (key === 'post /channels/{channel_id}/typing' && status === 200) {
    return {
      ...request,
      path: `/api/v10/channels/${fixture.groupDmChannelId}/typing`,
    }
  }
  if (key === 'post /channels/{channel_id}/invites' && status === 204) {
    const body = new FormData()
    body.set('payload_json', JSON.stringify({ max_age: 3600 }))
    body.set(
      'target_users_file',
      new File([`user_id\n${fixture.memberId}\n`], 'targets.csv', {
        type: 'text/csv',
      })
    )
    return { ...request, init: { method: 'POST', body } }
  }
  if (
    key === 'patch /guilds/{guild_id}/members/{user_id}' &&
    status === 204
  ) {
    return {
      ...request,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [fixture.roleId], mute: false }),
      },
    }
  }
  if (key === 'post /applications/{application_id}/commands' && status === 200) {
    return {
      ...request,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'contractcmd',
          description: 'replaced global command',
        }),
      },
    }
  }
  if (
    key ===
      'post /applications/{application_id}/guilds/{guild_id}/commands' &&
    status === 200
  ) {
    return {
      ...request,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'guildcontractcmd',
          description: 'replaced guild command',
        }),
      },
    }
  }
  if (
    key === 'post /interactions/{interaction_id}/{interaction_token}/callback' &&
    status === 200
  ) {
    return {
      ...request,
      path: `${request.path}?with_response=true`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 4,
          data: { content: 'contract callback response' },
        }),
      },
    }
  }
  if (key === 'get /channels/{channel_id}/threads/search' && status === 202) {
    return {
      ...request,
      path: `/api/v10/channels/${fixture.unindexedChannelId}/threads/search`,
    }
  }
  if (key === 'put /channels/{channel_id}/recipients/{user_id}' && status === 201) {
    return {
      ...request,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: 'contract-user-token', nick: 'member' }),
      },
    }
  }
  if (key === 'post /webhooks/{webhook_id}/{webhook_token}' && status === 204) {
    return { ...request, path: request.path.replace('?wait=true', '') }
  }
  return request
}

const mutationBaselines = new WeakMap<ContractFixture, Map<string, string>>()

function mutationTables(entry: LegacySpecEndpoint): string[] {
  const path = entry.specPath
  const key = `${entry.method} ${path}`
  if (entry.method === 'get') return []
  if (path.includes('/reactions')) return ['reactions']
  if (path.includes('/messages/pins') || path.includes('/pins/')) {
    return ['pins', 'messages']
  }
  if (path.includes('/messages/bulk-delete')) return ['messages']
  if (path.includes('/messages/{message_id}/threads')) {
    return ['channels', 'thread_members']
  }
  if (path.includes('/messages/{message_id}/crosspost')) return ['messages']
  if (path.includes('/messages/{message_id}')) return ['messages']
  if (path === '/channels/{channel_id}/messages') return ['messages']
  if (path.endsWith('/typing') || path.endsWith('/voice-status')) {
    return ['channels']
  }
  if (path.endsWith('/permissions/{overwrite_id}')) {
    return ['channel_overwrites']
  }
  if (path === '/channels/{channel_id}/invites') {
    return entry.successStatus === 204
      ? ['invites', 'invite_target_users']
      : ['invites']
  }
  if (path === '/invites/{code}') return ['invites']
  if (path === '/invites/{code}/target-users') {
    return ['invite_target_users']
  }
  if (path === '/channels/{channel_id}/webhooks') return ['webhooks']
  if (path.includes('/thread-members/')) return ['thread_members']
  if (path === '/channels/{channel_id}/threads') {
    return ['channels', 'thread_members']
  }
  if (path.endsWith('/followers')) return ['webhooks']
  if (path.endsWith('/recipients/{user_id}')) return ['channel_recipients']
  if (path === '/channels/{channel_id}') return ['channels']
  if (path === '/guilds/{guild_id}') return ['guilds']
  if (path === '/guilds/{guild_id}/channels') return ['channels']
  if (path.includes('/members/{user_id}/roles/{role_id}')) {
    return ['member_roles']
  }
  if (path.includes('/members/')) return ['guild_members', 'member_roles']
  if (path.includes('/roles')) return ['roles']
  if (path.includes('/emojis')) return ['emojis']
  if (path.includes('/bans/')) return ['guild_bans', 'guild_members']
  if (path === '/users/@me') return ['bots', 'users']
  if (path === '/users/@me/channels') {
    return ['channels', 'channel_recipients']
  }
  if (path.includes('/commands/{command_id}/permissions')) {
    return ['application_command_permissions']
  }
  if (path.includes('/commands')) return ['application_commands']
  if (path.includes('/interactions/')) return ['interactions', 'messages']
  if (path.includes('/polls/{message_id}/expire')) return ['polls']
  if (path.startsWith('/webhooks/')) {
    if (
      key.endsWith('/github') ||
      key.endsWith('/slack') ||
      entry.method === 'post'
    ) {
      return ['messages', 'embeds']
    }
    return path.includes('/messages/') ? ['messages'] : ['webhooks']
  }
  throw new Error(`No mutation state domain declared for ${key}`)
}

function snapshotTables(db: Database, tables: string[]): string {
  return JSON.stringify(
    tables.map((table) => ({
      table,
      rows: db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    }))
  )
}

function captureMutationBaseline(
  entry: LegacySpecEndpoint,
  status: number,
  fixture: ContractFixture
): void {
  const tables = mutationTables(entry)
  if (tables.length === 0) return
  const key = `${entry.method} ${entry.specPath} ${status}`
  const baselines = mutationBaselines.get(fixture) ?? new Map<string, string>()
  baselines.set(key, snapshotTables(fixture.db, tables))
  mutationBaselines.set(fixture, baselines)
}

function createOperationAssertion(
  entry: LegacySpecEndpoint,
  status: number
): SpecSuccessBranch['assert'] {
  return async ({ baseUrl, fixture, response }) => {
    const label = `${entry.method.toUpperCase()} ${entry.specPath} ${status}`
    if (response.status !== status) {
      throw new Error(`${label} returned ${response.status}`)
    }
    if (new URL(response.url).origin !== baseUrl) {
      throw new Error(`${label} did not use the real contract server`)
    }

    const tables = mutationTables(entry)
    if (tables.length === 0) return
    const baseline = mutationBaselines
      .get(fixture)
      ?.get(`${entry.method} ${entry.specPath} ${status}`)
    if (baseline === undefined) {
      throw new Error(`${label} did not capture its state baseline`)
    }
    if (snapshotTables(fixture.db, tables) === baseline) {
      throw new Error(
        `${label} did not change its operation state: ${tables.join(', ')}`
      )
    }
  }
}

const uniqueLegacyEntries = new Map<string, LegacySpecEndpoint>()
for (const entry of LEGACY_MANIFEST) {
  const key = `${entry.method} ${entry.specPath}`
  if (!uniqueLegacyEntries.has(key)) uniqueLegacyEntries.set(key, entry)
}

/** All currently implemented Fauxcord operations in unique OpenAPI-key form. */
export const MANIFEST: SpecEndpoint[] = [...uniqueLegacyEntries.values()].map(
  (entry) => {
    const key = `${entry.method} ${entry.specPath}`
    const statuses = MULTI_SUCCESS_STATUSES[key] ?? [entry.successStatus]
    return {
      specPath: entry.specPath,
      method: entry.method,
      authentication: authenticationFor(entry),
      createFixture: (factory) => factory.create(),
      successBranches: statuses.map((status) => ({
        status,
        ...responseContract(entry, status),
        responseSchemaOverride: entry.responseSchemaOverride,
        request: (fixture) => {
          const request = alternateRequest(entry, status, fixture)
          captureMutationBaseline(entry, status, fixture)
          return request
        },
        assert: createOperationAssertion(entry, status),
      })),
    }
  }
)
