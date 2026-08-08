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
  /** Seeded application ID (equal to the bot user ID in Fauxcord). */
  applicationId: string
  /** Seeded application activity instance ID. */
  activityInstanceId: string
  /** Seeded application emoji ID. */
  applicationEmojiId: string
  /** Application emoji reserved for destructive request branches. */
  deletableApplicationEmojiId: string
  /** Seeded application SKU ID. */
  skuId: string
  /** Seeded stable application entitlement ID. */
  entitlementId: string
  /** Application entitlement reserved for deletion. */
  deletableEntitlementId: string
  /** Application entitlement reserved for consumption. */
  consumableEntitlementId: string
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
  /** Seeded auto-moderation rule ID. */
  autoModerationRuleId: string
  /** User available for the guild member-add operation. */
  addableMemberId: string
  /** Seeded scheduled event ID. */
  scheduledEventId: string
  /** Seeded scheduled event exception ID. */
  scheduledEventExceptionId: string
  /** Seeded guild soundboard sound ID. */
  guildSoundboardSoundId: string
  /** Seeded guild sticker ID. */
  guildStickerId: string
  /** Seeded guild template code. */
  guildTemplateCode: string
  /** Seeded join-request ID. */
  joinRequestId: string
  /** Seeded guild integration ID. */
  guildIntegrationId: string
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
  createFixture: (factory: ContractFixtureFactory) => Promise<ContractFixture>
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
    specPath:
      '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions/%F0%9F%91%8D`,
    }),
  },
  {
    specPath:
      '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me',
    method: 'put',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.messageId}/reactions/%F0%9F%91%8D/@me`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath:
      '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.reactedMessageId}/reactions/%F0%9F%91%8D/@me`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath:
      '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}',
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
    specPath: '/applications/@me',
    method: 'patch',
    successStatus: 200,
    responseSchemaOverride: 'PrivateApplicationResponse',
    request: () => ({
      path: '/api/v10/applications/@me',
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: { default: 'Updated current application' },
        }),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}',
    method: 'get',
    successStatus: 200,
    responseSchemaOverride: 'PrivateApplicationResponse',
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}`,
    }),
  },
  {
    specPath: '/applications/{application_id}',
    method: 'patch',
    successStatus: 200,
    responseSchemaOverride: 'PrivateApplicationResponse',
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: { default: 'Updated application by ID' },
        }),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}/activity-instances/{instance_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/activity-instances/${f.activityInstanceId}`,
    }),
  },
  {
    specPath: '/applications/{application_id}/attachment',
    method: 'post',
    successStatus: 200,
    request: (f) => {
      const form = new FormData()
      form.set(
        'file',
        new File(['contract application attachment'], 'contract.txt', {
          type: 'text/plain',
        })
      )
      return {
        path: `/api/v10/applications/${f.applicationId}/attachment`,
        init: { method: 'POST', body: form },
      }
    },
  },
  {
    specPath: '/applications/{application_id}/emojis',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/emojis`,
    }),
  },
  {
    specPath: '/applications/{application_id}/emojis',
    method: 'post',
    successStatus: 201,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/emojis`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'created_emoji',
          image: 'data:image/png;base64,aGVsbG8=',
        }),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}/emojis/{emoji_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/emojis/${f.applicationEmojiId}`,
    }),
  },
  {
    specPath: '/applications/{application_id}/emojis/{emoji_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/emojis/${f.applicationEmojiId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'renamed_emoji' }),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}/emojis/{emoji_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/emojis/${f.deletableApplicationEmojiId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/applications/{application_id}/entitlements',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/entitlements?user_id=${f.userId}&sku_ids=${f.skuId}`,
    }),
  },
  {
    specPath: '/applications/{application_id}/entitlements',
    method: 'post',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/entitlements`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_id: f.skuId,
          owner_id: f.userId,
          owner_type: 2,
        }),
      },
    }),
  },
  {
    specPath: '/applications/{application_id}/entitlements/{entitlement_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/entitlements/${f.entitlementId}`,
    }),
  },
  {
    specPath: '/applications/{application_id}/entitlements/{entitlement_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/entitlements/${f.deletableEntitlementId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath:
      '/applications/{application_id}/entitlements/{entitlement_id}/consume',
    method: 'post',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/entitlements/${f.consumableEntitlementId}/consume`,
      init: { method: 'POST' },
    }),
  },
  {
    specPath: '/applications/{application_id}/role-connections/metadata',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/role-connections/metadata`,
    }),
  },
  {
    specPath: '/applications/{application_id}/role-connections/metadata',
    method: 'put',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/applications/${f.applicationId}/role-connections/metadata`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            type: 2,
            key: 'score',
            name: 'Score',
            description: 'Contract score',
          },
        ]),
      },
    }),
  },
  {
    specPath: '/oauth2/keys',
    method: 'get',
    successStatus: 200,
    request: () => ({ path: '/api/v10/oauth2/keys' }),
  },
  {
    specPath: '/oauth2/userinfo',
    method: 'get',
    successStatus: 200,
    request: () => ({ path: '/api/v10/oauth2/userinfo' }),
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

  // ─── Advanced guild and channel operations ────────────────────────────────
  {
    specPath:
      '/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/messages/${f.reactedMessageId}/reactions/%F0%9F%91%8D`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/channels/{channel_id}/send-soundboard-sound',
    method: 'post',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/channels/${f.channelId}/send-soundboard-sound`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sound_id: f.guildSoundboardSoundId }),
      },
    }),
  },
  {
    specPath: '/guilds/templates/{code}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/templates/${f.guildTemplateCode}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/audit-logs',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/audit-logs` }),
  },
  {
    specPath: '/guilds/{guild_id}/auto-moderation/rules',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/auto-moderation/rules`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/auto-moderation/rules',
    method: 'post',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/auto-moderation/rules`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Contract rule',
          event_type: 1,
          trigger_type: 4,
          trigger_metadata: { allow_list: [], presets: [1] },
          actions: [{ type: 1, metadata: { custom_message: 'blocked' } }],
        }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/auto-moderation/rules/{rule_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/auto-moderation/rules/${f.autoModerationRuleId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/auto-moderation/rules/{rule_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/auto-moderation/rules/${f.autoModerationRuleId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated contract rule' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/auto-moderation/rules/{rule_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/auto-moderation/rules/${f.autoModerationRuleId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/bulk-ban',
    method: 'post',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/bulk-ban`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: [f.addableMemberId] }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/channels',
    method: 'patch',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/channels`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ id: f.channelId, position: 7 }]),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/incident-actions',
    method: 'put',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/incident-actions`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invites_disabled_until: '2030-01-01T00:00:00.000Z',
          dms_disabled_until: null,
        }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/integrations',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/integrations` }),
  },
  {
    specPath: '/guilds/{guild_id}/integrations/{integration_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/integrations/${f.guildIntegrationId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/members/search',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/search?query=Test&limit=10`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/members/{user_id}',
    method: 'put',
    successStatus: 201,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/members/${f.addableMemberId}`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'local-contract-member',
          nick: 'New contract member',
        }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/messages/search',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/messages/search?content=Test`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/new-member-welcome',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/new-member-welcome`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/onboarding',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/onboarding` }),
  },
  {
    specPath: '/guilds/{guild_id}/onboarding',
    method: 'put',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/onboarding`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompts: [],
          default_channel_ids: [f.channelId],
          enabled: false,
          mode: 1,
        }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/preview',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/preview` }),
  },
  {
    specPath: '/guilds/{guild_id}/prune',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/prune?days=7` }),
  },
  {
    specPath: '/guilds/{guild_id}/prune',
    method: 'post',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/prune`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/regions',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/regions` }),
  },
  {
    specPath: '/guilds/{guild_id}/requests',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/requests` }),
  },
  {
    specPath: '/guilds/{guild_id}/requests/{request_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/requests/${f.joinRequestId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_status: 'APPROVED' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/roles',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/roles`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ id: f.roleId, position: 5 }]),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/roles/member-counts',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/roles/member-counts`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/roles/{role_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/roles/${f.roleId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/scheduled-events',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events?with_user_count=true`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/scheduled-events',
    method: 'post',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Contract external event',
          privacy_level: 2,
          entity_type: 3,
          scheduled_start_time: '2030-02-01T00:00:00.000Z',
          scheduled_end_time: '2030-02-01T01:00:00.000Z',
          entity_metadata: { location: 'Fauxcord' },
        }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}?with_user_count=true`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated contract event' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath:
      '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions',
    method: 'post',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}/exceptions`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduled_start_time: '2030-03-01T00:00:00.000Z',
          scheduled_end_time: '2030-03-01T01:00:00.000Z',
        }),
      },
    }),
  },
  {
    specPath:
      '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions/{exception_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}/exceptions/${f.scheduledEventExceptionId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_canceled: true }),
      },
    }),
  },
  {
    specPath:
      '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions/{exception_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}/exceptions/${f.scheduledEventExceptionId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath:
      '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/users',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}/users?with_member=true`,
    }),
  },
  {
    specPath:
      '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/users/counts',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}/users/counts`,
    }),
  },
  {
    specPath:
      '/guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/{guild_scheduled_event_exception_id}/users',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/scheduled-events/${f.scheduledEventId}/${f.scheduledEventExceptionId}/users?with_member=true`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/soundboard-sounds',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/soundboard-sounds`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/soundboard-sounds',
    method: 'post',
    successStatus: 201,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/soundboard-sounds`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Created contract sound',
          sound_id: '977777777777777777',
        }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/soundboard-sounds/{sound_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/soundboard-sounds/${f.guildSoundboardSoundId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/soundboard-sounds/{sound_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/soundboard-sounds/${f.guildSoundboardSoundId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated contract sound' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/soundboard-sounds/{sound_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/soundboard-sounds/${f.guildSoundboardSoundId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/stickers',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/stickers` }),
  },
  {
    specPath: '/guilds/{guild_id}/stickers',
    method: 'post',
    successStatus: 201,
    request: (f) => {
      const body = new FormData()
      body.set('name', 'created-sticker')
      body.set('description', 'Created sticker')
      body.set('tags', 'created')
      body.set('file', new File(['png'], 'sticker.png', { type: 'image/png' }))
      return {
        path: `/api/v10/guilds/${f.guildId}/stickers`,
        init: { method: 'POST', body },
      }
    },
  },
  {
    specPath: '/guilds/{guild_id}/stickers/{sticker_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/stickers/${f.guildStickerId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/stickers/{sticker_id}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/stickers/${f.guildStickerId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated-sticker' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/stickers/{sticker_id}',
    method: 'delete',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/stickers/${f.guildStickerId}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/templates',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/templates` }),
  },
  {
    specPath: '/guilds/{guild_id}/templates',
    method: 'post',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/templates`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Created contract template' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/templates/{code}',
    method: 'put',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/templates/${f.guildTemplateCode}`,
      init: { method: 'PUT' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/templates/{code}',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/templates/${f.guildTemplateCode}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated contract template' }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/templates/{code}',
    method: 'delete',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/templates/${f.guildTemplateCode}`,
      init: { method: 'DELETE' },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/threads/active',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/threads/active` }),
  },
  {
    specPath: '/guilds/{guild_id}/vanity-url',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/vanity-url` }),
  },
  {
    specPath: '/guilds/{guild_id}/voice-states/@me',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/voice-states/@me` }),
  },
  {
    specPath: '/guilds/{guild_id}/voice-states/@me',
    method: 'patch',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/voice-states/@me`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: f.voiceChannelId, suppress: true }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/voice-states/{user_id}',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/voice-states/${f.memberId}`,
    }),
  },
  {
    specPath: '/guilds/{guild_id}/voice-states/{user_id}',
    method: 'patch',
    successStatus: 204,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/voice-states/${f.memberId}`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: f.voiceChannelId, suppress: true }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/welcome-screen',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/welcome-screen` }),
  },
  {
    specPath: '/guilds/{guild_id}/welcome-screen',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/welcome-screen`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          description: 'Updated contract welcome',
          welcome_channels: [],
        }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/widget',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/widget` }),
  },
  {
    specPath: '/guilds/{guild_id}/widget',
    method: 'patch',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/widget`,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, channel_id: null }),
      },
    }),
  },
  {
    specPath: '/guilds/{guild_id}/widget.json',
    method: 'get',
    successStatus: 200,
    request: (f) => ({ path: `/api/v10/guilds/${f.guildId}/widget.json` }),
  },
  {
    specPath: '/guilds/{guild_id}/widget.png',
    method: 'get',
    successStatus: 200,
    request: (f) => ({
      path: `/api/v10/guilds/${f.guildId}/widget.png?style=shield`,
    }),
  },
]

const MULTI_SUCCESS_STATUSES: Readonly<Record<string, readonly number[]>> = {
  'post /channels/{channel_id}/typing': [200, 204],
  'post /channels/{channel_id}/invites': [200, 204],
  'patch /guilds/{guild_id}/members/{user_id}': [200, 204],
  'put /guilds/{guild_id}/members/{user_id}': [201, 204],
  'get /guilds/{guild_id}/messages/search': [200, 202],
  'get /guilds/{guild_id}/new-member-welcome': [200, 204],
  'post /applications/{application_id}/commands': [200, 201],
  'post /applications/{application_id}/guilds/{guild_id}/commands': [200, 201],
  'post /interactions/{interaction_id}/{interaction_token}/callback': [
    200, 204,
  ],
  'get /channels/{channel_id}/threads/search': [200, 202],
  'put /channels/{channel_id}/recipients/{user_id}': [201, 204],
  'post /webhooks/{webhook_id}/{webhook_token}': [200, 204],
}

function authenticationFor(entry: LegacySpecEndpoint): ContractAuthentication {
  if (
    entry.specPath === '/gateway' ||
    entry.specPath === '/oauth2/keys' ||
    entry.specPath === '/guilds/templates/{code}'
  ) {
    return 'public'
  }
  if (
    entry.specPath === '/oauth2/@me' ||
    entry.specPath === '/oauth2/userinfo'
  ) {
    return 'bearer'
  }
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
  if (key === 'patch /guilds/{guild_id}/members/{user_id}' && status === 204) {
    return {
      ...request,
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [fixture.roleId], mute: false }),
      },
    }
  }
  if (key === 'put /guilds/{guild_id}/members/{user_id}' && status === 204) {
    return {
      ...request,
      path: `/api/v10/guilds/${fixture.guildId}/members/${fixture.memberId}`,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'local-contract-member',
          nick: 'Updated contract member',
        }),
      },
    }
  }
  if (key === 'get /guilds/{guild_id}/messages/search' && status === 202) {
    return {
      ...request,
      path: `/api/v10/guilds/${fixture.guildId}/messages/search?indexing=true`,
    }
  }
  if (key === 'get /guilds/{guild_id}/new-member-welcome' && status === 204) {
    fixture.db
      .prepare(
        'UPDATE guild_welcome_screen_settings SET enabled = 0 WHERE guild_id = ?'
      )
      .run(fixture.guildId)
    return request
  }
  if (
    key === 'post /applications/{application_id}/commands' &&
    status === 200
  ) {
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
    key === 'post /applications/{application_id}/guilds/{guild_id}/commands' &&
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
    key ===
      'post /interactions/{interaction_id}/{interaction_token}/callback' &&
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
  if (
    key === 'put /channels/{channel_id}/recipients/{user_id}' &&
    status === 201
  ) {
    return {
      ...request,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'contract-user-token',
          nick: 'member',
        }),
      },
    }
  }
  if (key === 'post /webhooks/{webhook_id}/{webhook_token}' && status === 204) {
    return { ...request, path: request.path.replace('?wait=true', '') }
  }
  return request
}

type SqlValue = string | number | null

interface MutationEffect {
  description: string
  isApplied: () => boolean
}

const mutationEffects = new WeakMap<
  ContractFixture,
  Map<string, MutationEffect>
>()

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

function readRow(
  db: Database,
  sql: string,
  params: readonly SqlValue[] = []
): unknown {
  return db.prepare(sql).get(...params) ?? null
}

function readRows(
  db: Database,
  sql: string,
  params: readonly SqlValue[] = []
): unknown[] {
  return db.prepare(sql).all(...params)
}

function exactEffect(
  description: string,
  read: () => unknown,
  expected: unknown
): MutationEffect {
  const before = serialize(read())
  const serializedExpected = serialize(expected)
  return {
    description,
    isApplied: () => {
      const after = serialize(read())
      return after !== before && after === serializedExpected
    },
  }
}

function predicateEffect(
  description: string,
  read: () => unknown,
  matches: (after: unknown) => boolean
): MutationEffect {
  const before = serialize(read())
  return {
    description,
    isApplied: () => {
      const after = read()
      return serialize(after) !== before && matches(after)
    },
  }
}

function countIncreaseEffect(
  description: string,
  readCount: () => number
): MutationEffect {
  const before = readCount()
  return {
    description,
    isApplied: () => readCount() === before + 1,
  }
}

function rowEffect(
  fixture: ContractFixture,
  description: string,
  sql: string,
  params: readonly SqlValue[],
  expected: unknown
): MutationEffect {
  return exactEffect(
    description,
    () => readRow(fixture.db, sql, params),
    expected
  )
}

function rowsEffect(
  fixture: ContractFixture,
  description: string,
  sql: string,
  params: readonly SqlValue[],
  expected: unknown[]
): MutationEffect {
  return exactEffect(
    description,
    () => readRows(fixture.db, sql, params),
    expected
  )
}

function matchingRowCreatedEffect(
  fixture: ContractFixture,
  description: string,
  sql: string,
  params: readonly SqlValue[]
): MutationEffect {
  const readCount = () => {
    const row = readRow(fixture.db, sql, params) as { count: number }
    return row.count
  }
  return countIncreaseEffect(description, readCount)
}

function captureMutationEffect(
  entry: LegacySpecEndpoint,
  status: number,
  fixture: ContractFixture
): void {
  if (
    entry.method === 'get' ||
    entry.specPath === '/applications/{application_id}/attachment'
  ) {
    return
  }
  const key = `${entry.method} ${entry.specPath} ${status}`
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- Capture setup stays before the exhaustive effect catalog.
  const effect = mutationEffectFor(key, fixture)
  const effects =
    mutationEffects.get(fixture) ?? new Map<string, MutationEffect>()
  effects.set(key, effect)
  mutationEffects.set(fixture, effects)
}

function mutationEffectFor(
  key: string,
  fixture: ContractFixture
): MutationEffect {
  const f = fixture
  const db = f.db
  switch (key) {
    case 'patch /channels/{channel_id} 200': {
      return rowEffect(
        f,
        'target channel name to equal updated-channel',
        'SELECT name FROM channels WHERE id = ?',
        [f.channelId],
        { name: 'updated-channel' }
      )
    }
    case 'delete /channels/{channel_id} 200': {
      return rowEffect(
        f,
        'target channel to be absent',
        'SELECT id FROM channels WHERE id = ?',
        [f.channelId],
        null
      )
    }
    case 'post /channels/{channel_id}/messages 200': {
      return matchingRowCreatedEffect(
        f,
        'a message with the requested channel and content to be created',
        `SELECT COUNT(*) AS count FROM messages
         WHERE channel_id = ? AND author_id = ? AND content = ?`,
        [f.channelId, f.userId, 'Hello, world!']
      )
    }
    case 'patch /channels/{channel_id}/messages/{message_id} 200': {
      return rowEffect(
        f,
        'target message content to equal Edited message',
        'SELECT content FROM messages WHERE id = ? AND channel_id = ?',
        [f.messageId, f.channelId],
        { content: 'Edited message' }
      )
    }
    case 'delete /channels/{channel_id}/messages/{message_id} 204': {
      return rowEffect(
        f,
        'target message to be absent',
        'SELECT id FROM messages WHERE id = ? AND channel_id = ?',
        [f.deletableMessageId, f.channelId],
        null
      )
    }
    case 'post /channels/{channel_id}/messages/bulk-delete 204': {
      return rowsEffect(
        f,
        'both requested messages to be absent',
        'SELECT id FROM messages WHERE channel_id = ? AND id IN (?, ?) ORDER BY id',
        [f.channelId, f.messageId, f.deletableMessageId],
        []
      )
    }
    case 'post /channels/{channel_id}/typing 200':
    case 'post /channels/{channel_id}/typing 204': {
      const channelId = key.endsWith('200') ? f.groupDmChannelId : f.channelId
      return predicateEffect(
        'target channel typing_at to be populated',
        () =>
          readRow(db, 'SELECT typing_at FROM channels WHERE id = ?', [
            channelId,
          ]),
        (after) =>
          typeof (after as { typing_at?: unknown }).typing_at === 'string'
      )
    }
    case 'put /channels/{channel_id}/messages/pins/{message_id} 204':
    case 'put /channels/{channel_id}/pins/{message_id} 204': {
      return rowEffect(
        f,
        'target message to be pinned in the target channel',
        `SELECT m.pinned, EXISTS(
           SELECT 1 FROM pins p WHERE p.channel_id = ? AND p.message_id = m.id
         ) AS pin_exists FROM messages m WHERE m.id = ?`,
        [f.channelId, f.messageId],
        { pinned: 1, pin_exists: 1 }
      )
    }
    case 'delete /channels/{channel_id}/messages/pins/{message_id} 204':
    case 'delete /channels/{channel_id}/pins/{message_id} 204': {
      return rowEffect(
        f,
        'target message pin to be removed from the target channel',
        `SELECT m.pinned, EXISTS(
           SELECT 1 FROM pins p WHERE p.channel_id = ? AND p.message_id = m.id
         ) AS pin_exists FROM messages m WHERE m.id = ?`,
        [f.channelId, f.pinnedMessageId],
        { pinned: 0, pin_exists: 0 }
      )
    }
    case 'put /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me 204': {
      return rowEffect(
        f,
        'the requested reaction by the bot to exist on the target message',
        'SELECT message_id, user_id, emoji FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [f.messageId, f.userId, '👍'],
        { message_id: f.messageId, user_id: f.userId, emoji: '👍' }
      )
    }
    case 'delete /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me 204':
    case 'delete /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id} 204': {
      return rowEffect(
        f,
        'the requested user reaction to be absent from the target message',
        'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [f.reactedMessageId, f.userId, '👍'],
        null
      )
    }
    case 'delete /channels/{channel_id}/messages/{message_id}/reactions 204': {
      return rowsEffect(
        f,
        'all reactions to be absent from the target message',
        'SELECT id FROM reactions WHERE message_id = ?',
        [f.reactedMessageId],
        []
      )
    }
    case 'post /channels/{channel_id}/webhooks 200': {
      return matchingRowCreatedEffect(
        f,
        'a webhook with the requested channel and name to be created',
        'SELECT COUNT(*) AS count FROM webhooks WHERE channel_id = ? AND name = ?',
        [f.channelId, 'Test Webhook']
      )
    }
    case 'put /channels/{channel_id}/permissions/{overwrite_id} 204': {
      return rowEffect(
        f,
        'the requested overwrite values to exist on the target channel',
        `SELECT type, allow, deny FROM channel_overwrites
         WHERE channel_id = ? AND id = ?`,
        [f.channelId, f.roleId],
        { type: 0, allow: '0', deny: '0' }
      )
    }
    case 'delete /channels/{channel_id}/permissions/{overwrite_id} 204': {
      return rowEffect(
        f,
        'the target channel overwrite to be absent',
        'SELECT id FROM channel_overwrites WHERE channel_id = ? AND id = ?',
        [f.channelId, f.deletableOverwriteId],
        null
      )
    }
    case 'post /channels/{channel_id}/invites 200': {
      return matchingRowCreatedEffect(
        f,
        'an invite with the requested channel and max_age to be created',
        'SELECT COUNT(*) AS count FROM invites WHERE channel_id = ? AND max_age = 3600',
        [f.channelId]
      )
    }
    case 'post /channels/{channel_id}/invites 204': {
      return matchingRowCreatedEffect(
        f,
        'an invite and target-user job for the requested channel to be created',
        `SELECT COUNT(*) AS count FROM invites i
         JOIN invite_target_users t ON t.code = i.code
         WHERE i.channel_id = ? AND i.max_age = 3600 AND t.total_users = 1`,
        [f.channelId]
      )
    }
    case 'delete /invites/{code} 200': {
      return rowEffect(
        f,
        'the target invite code to be absent',
        'SELECT code FROM invites WHERE code = ?',
        [f.deletableInviteCode],
        null
      )
    }
    case 'put /invites/{code}/target-users 204': {
      return rowEffect(
        f,
        'the target invite job to contain the uploaded user',
        `SELECT total_users, raw_csv FROM invite_target_users WHERE code = ?`,
        [f.inviteCode],
        { total_users: 1, raw_csv: 'user_id\n999999999999999999\n' }
      )
    }
    case 'patch /guilds/{guild_id} 200': {
      return rowEffect(
        f,
        'target guild name to equal Updated Guild',
        'SELECT name FROM guilds WHERE id = ?',
        [f.guildId],
        { name: 'Updated Guild' }
      )
    }
    case 'post /guilds/{guild_id}/channels 201': {
      return matchingRowCreatedEffect(
        f,
        'a text channel with the requested guild and name to be created',
        'SELECT COUNT(*) AS count FROM channels WHERE guild_id = ? AND name = ? AND type = 0',
        [f.guildId, 'new-channel']
      )
    }
    case 'patch /guilds/{guild_id}/members/@me 200': {
      return rowEffect(
        f,
        'the bot member nickname to equal SelfNick',
        'SELECT nick FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.userId],
        { nick: 'SelfNick' }
      )
    }
    case 'patch /guilds/{guild_id}/members/{user_id} 200': {
      return rowEffect(
        f,
        'target member nickname to equal TestNick',
        'SELECT nick FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.memberId],
        { nick: 'TestNick' }
      )
    }
    case 'patch /guilds/{guild_id}/members/{user_id} 204': {
      return rowsEffect(
        f,
        'target member mute and role assignment to match the request',
        `SELECT gm.mute, mr.role_id FROM guild_members gm
         JOIN member_roles mr ON mr.guild_id = gm.guild_id AND mr.user_id = gm.user_id
         WHERE gm.guild_id = ? AND gm.user_id = ? ORDER BY mr.role_id`,
        [f.guildId, f.memberId],
        [{ mute: 0, role_id: f.roleId }]
      )
    }
    case 'delete /guilds/{guild_id}/members/{user_id} 204': {
      return rowEffect(
        f,
        'target guild member to be absent',
        'SELECT user_id FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.memberId],
        null
      )
    }
    case 'post /guilds/{guild_id}/roles 200': {
      return matchingRowCreatedEffect(
        f,
        'a role with the requested guild and name to be created',
        'SELECT COUNT(*) AS count FROM roles WHERE guild_id = ? AND name = ?',
        [f.guildId, 'test-role']
      )
    }
    case 'patch /guilds/{guild_id}/roles/{role_id} 200': {
      return rowEffect(
        f,
        'target role name to equal updated-role',
        'SELECT name FROM roles WHERE guild_id = ? AND id = ?',
        [f.guildId, f.roleId],
        { name: 'updated-role' }
      )
    }
    case 'delete /guilds/{guild_id}/roles/{role_id} 204': {
      return rowEffect(
        f,
        'target role to be absent',
        'SELECT id FROM roles WHERE guild_id = ? AND id = ?',
        [f.guildId, f.deletableRoleId],
        null
      )
    }
    case 'post /guilds/{guild_id}/emojis 201': {
      return matchingRowCreatedEffect(
        f,
        'an emoji with the requested guild and name to be created',
        'SELECT COUNT(*) AS count FROM emojis WHERE guild_id = ? AND name = ?',
        [f.guildId, 'new_emoji']
      )
    }
    case 'patch /guilds/{guild_id}/emojis/{emoji_id} 200': {
      return rowEffect(
        f,
        'target emoji name to equal renamed_emoji',
        'SELECT name FROM emojis WHERE guild_id = ? AND id = ?',
        [f.guildId, f.emojiId],
        { name: 'renamed_emoji' }
      )
    }
    case 'delete /guilds/{guild_id}/emojis/{emoji_id} 204': {
      return rowEffect(
        f,
        'target emoji to be absent',
        'SELECT id FROM emojis WHERE guild_id = ? AND id = ?',
        [f.guildId, f.emojiId],
        null
      )
    }
    case 'put /guilds/{guild_id}/bans/{user_id} 204': {
      return rowEffect(
        f,
        'the requested user ban to exist in the target guild',
        'SELECT guild_id, user_id FROM guild_bans WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.banTargetUserId],
        { guild_id: f.guildId, user_id: f.banTargetUserId }
      )
    }
    case 'delete /guilds/{guild_id}/bans/{user_id} 204': {
      return rowEffect(
        f,
        'the target user ban to be absent from the target guild',
        'SELECT user_id FROM guild_bans WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.bannedUserId],
        null
      )
    }
    case 'put /guilds/{guild_id}/members/{user_id}/roles/{role_id} 204': {
      return rowEffect(
        f,
        'the requested role assignment to exist for the target member',
        `SELECT guild_id, user_id, role_id FROM member_roles
         WHERE guild_id = ? AND user_id = ? AND role_id = ?`,
        [f.guildId, f.memberId, f.roleId],
        { guild_id: f.guildId, user_id: f.memberId, role_id: f.roleId }
      )
    }
    case 'delete /guilds/{guild_id}/members/{user_id}/roles/{role_id} 204': {
      return rowEffect(
        f,
        'the target role assignment to be absent from the target member',
        `SELECT role_id FROM member_roles
         WHERE guild_id = ? AND user_id = ? AND role_id = ?`,
        [f.guildId, f.memberId, f.assignedRoleId],
        null
      )
    }
    case 'patch /users/@me 200': {
      return rowEffect(
        f,
        'the authenticated bot and user names to equal UpdatedBot',
        `SELECT b.username AS bot_username, u.username AS user_username
         FROM bots b JOIN users u ON u.id = b.user_id WHERE b.token = ?`,
        [f.token],
        { bot_username: 'UpdatedBot', user_username: 'UpdatedBot' }
      )
    }
    case 'patch /applications/@me 200': {
      return rowEffect(
        f,
        'current application description to equal the requested value',
        'SELECT description FROM applications WHERE id = ?',
        [f.applicationId],
        { description: 'Updated current application' }
      )
    }
    case 'patch /applications/{application_id} 200': {
      return rowEffect(
        f,
        'target application description to equal the requested value',
        'SELECT description FROM applications WHERE id = ?',
        [f.applicationId],
        { description: 'Updated application by ID' }
      )
    }
    case 'post /applications/{application_id}/emojis 201': {
      return matchingRowCreatedEffect(
        f,
        'an application emoji with the requested name to be created',
        `SELECT COUNT(*) AS count FROM application_emojis
         WHERE application_id = ? AND name = ?`,
        [f.applicationId, 'created_emoji']
      )
    }
    case 'patch /applications/{application_id}/emojis/{emoji_id} 200': {
      return rowEffect(
        f,
        'target application emoji name to equal renamed_emoji',
        `SELECT name FROM application_emojis
         WHERE application_id = ? AND id = ?`,
        [f.applicationId, f.applicationEmojiId],
        { name: 'renamed_emoji' }
      )
    }
    case 'delete /applications/{application_id}/emojis/{emoji_id} 204': {
      return rowEffect(
        f,
        'target application emoji to be absent',
        `SELECT id FROM application_emojis
         WHERE application_id = ? AND id = ?`,
        [f.applicationId, f.deletableApplicationEmojiId],
        null
      )
    }
    case 'post /applications/{application_id}/entitlements 200': {
      return matchingRowCreatedEffect(
        f,
        'an application entitlement for the requested SKU and user to be created',
        `SELECT COUNT(*) AS count FROM entitlements
         WHERE application_id = ? AND sku_id = ? AND user_id = ?`,
        [f.applicationId, f.skuId, f.userId]
      )
    }
    case 'delete /applications/{application_id}/entitlements/{entitlement_id} 204': {
      return rowEffect(
        f,
        'target application entitlement to be absent',
        `SELECT id FROM entitlements
         WHERE application_id = ? AND id = ?`,
        [f.applicationId, f.deletableEntitlementId],
        null
      )
    }
    case 'post /applications/{application_id}/entitlements/{entitlement_id}/consume 204': {
      return rowEffect(
        f,
        'target application entitlement to be consumed with a consumption record',
        `SELECT e.consumed,
                EXISTS(SELECT 1 FROM entitlement_consumptions c
                       WHERE c.entitlement_id = e.id) AS consumption_exists
         FROM entitlements e WHERE e.application_id = ? AND e.id = ?`,
        [f.applicationId, f.consumableEntitlementId],
        { consumed: 1, consumption_exists: 1 }
      )
    }
    case 'put /applications/{application_id}/role-connections/metadata 200': {
      return rowEffect(
        f,
        'application role connection metadata to equal the replacement item',
        `SELECT type, key, name, description
         FROM application_role_connection_metadata
         WHERE application_id = ?`,
        [f.applicationId],
        {
          type: 2,
          key: 'score',
          name: 'Score',
          description: 'Contract score',
        }
      )
    }
    case 'patch /webhooks/{webhook_id} 200': {
      return rowEffect(
        f,
        'target webhook name to equal Updated Webhook',
        'SELECT name FROM webhooks WHERE id = ?',
        [f.webhookId],
        { name: 'Updated Webhook' }
      )
    }
    case 'patch /webhooks/{webhook_id}/{webhook_token} 200': {
      return rowEffect(
        f,
        'target webhook name to equal Token Updated Webhook',
        'SELECT name FROM webhooks WHERE id = ? AND token = ?',
        [f.webhookId, f.webhookToken],
        { name: 'Token Updated Webhook' }
      )
    }
    case 'delete /webhooks/{webhook_id} 204':
    case 'delete /webhooks/{webhook_id}/{webhook_token} 204': {
      return rowEffect(
        f,
        'target webhook to be absent',
        'SELECT id FROM webhooks WHERE id = ?',
        [f.webhookId],
        null
      )
    }
    case 'post /webhooks/{webhook_id}/{webhook_token} 200':
    case 'post /webhooks/{webhook_id}/{webhook_token} 204': {
      return matchingRowCreatedEffect(
        f,
        'a target-webhook message with the requested content to be created',
        `SELECT COUNT(*) AS count FROM messages
         WHERE channel_id = ? AND author_id = ? AND content = ?`,
        [f.channelId, f.webhookId, 'Webhook message']
      )
    }
    case 'patch /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} 200': {
      return rowEffect(
        f,
        'target webhook message content to equal Edited webhook message',
        'SELECT content FROM messages WHERE id = ? AND author_id = ?',
        [f.webhookMessageId, f.webhookId],
        { content: 'Edited webhook message' }
      )
    }
    case 'delete /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} 204': {
      return rowEffect(
        f,
        'target webhook message to be absent',
        'SELECT id FROM messages WHERE id = ? AND author_id = ?',
        [f.webhookMessageId, f.webhookId],
        null
      )
    }
    case 'post /applications/{application_id}/commands 200': {
      return rowEffect(
        f,
        'target global command description to equal the replacement value',
        `SELECT description FROM application_commands
         WHERE id = ? AND application_id = ? AND guild_id IS NULL`,
        [f.commandId, f.userId],
        { description: 'replaced global command' }
      )
    }
    case 'post /applications/{application_id}/commands 201': {
      return matchingRowCreatedEffect(
        f,
        'a global command with the requested name and description to be created',
        `SELECT COUNT(*) AS count FROM application_commands
         WHERE application_id = ? AND guild_id IS NULL AND name = ? AND description = ?`,
        [f.userId, 'contractcreate', 'x']
      )
    }
    case 'put /applications/{application_id}/commands 200': {
      return rowsEffect(
        f,
        'the global command set to equal the bulk overwrite payload',
        `SELECT name, description FROM application_commands
         WHERE application_id = ? AND guild_id IS NULL ORDER BY name`,
        [f.userId],
        [{ name: 'ping', description: 'x' }]
      )
    }
    case 'patch /applications/{application_id}/commands/{command_id} 200': {
      return rowEffect(
        f,
        'target global command description to equal updated',
        'SELECT description FROM application_commands WHERE id = ? AND application_id = ?',
        [f.commandId, f.userId],
        { description: 'updated' }
      )
    }
    case 'delete /applications/{application_id}/commands/{command_id} 204': {
      return rowEffect(
        f,
        'target global command to be absent',
        'SELECT id FROM application_commands WHERE id = ? AND application_id = ?',
        [f.commandId, f.userId],
        null
      )
    }
    case 'post /applications/{application_id}/guilds/{guild_id}/commands 200': {
      return rowEffect(
        f,
        'target guild command description to equal the replacement value',
        `SELECT description FROM application_commands
         WHERE id = ? AND application_id = ? AND guild_id = ?`,
        [f.guildCommandId, f.userId, f.guildId],
        { description: 'replaced guild command' }
      )
    }
    case 'post /applications/{application_id}/guilds/{guild_id}/commands 201': {
      return matchingRowCreatedEffect(
        f,
        'a guild command with the requested name and description to be created',
        `SELECT COUNT(*) AS count FROM application_commands
         WHERE application_id = ? AND guild_id = ? AND name = ? AND description = ?`,
        [f.userId, f.guildId, 'guildcreate', 'x']
      )
    }
    case 'put /applications/{application_id}/guilds/{guild_id}/commands 200': {
      return rowsEffect(
        f,
        'the guild command set to equal the bulk overwrite payload',
        `SELECT name, description FROM application_commands
         WHERE application_id = ? AND guild_id = ? ORDER BY name`,
        [f.userId, f.guildId],
        [{ name: 'guildping', description: 'x' }]
      )
    }
    case 'patch /applications/{application_id}/guilds/{guild_id}/commands/{command_id} 200': {
      return rowEffect(
        f,
        'target guild command description to equal updated',
        `SELECT description FROM application_commands
         WHERE id = ? AND application_id = ? AND guild_id = ?`,
        [f.guildCommandId, f.userId, f.guildId],
        { description: 'updated' }
      )
    }
    case 'delete /applications/{application_id}/guilds/{guild_id}/commands/{command_id} 204': {
      return rowEffect(
        f,
        'target guild command to be absent',
        `SELECT id FROM application_commands
         WHERE id = ? AND application_id = ? AND guild_id = ?`,
        [f.guildCommandId, f.userId, f.guildId],
        null
      )
    }
    case 'put /applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions 200': {
      return rowEffect(
        f,
        'target guild command permissions to equal the requested permissions',
        `SELECT permissions FROM application_command_permissions
         WHERE application_id = ? AND guild_id = ? AND command_id = ?`,
        [f.userId, f.guildId, f.guildCommandId],
        {
          permissions: JSON.stringify([
            { id: f.roleId, type: 1, permission: true },
          ]),
        }
      )
    }
    case 'post /interactions/{interaction_id}/{interaction_token}/callback 200': {
      return predicateEffect(
        'target interaction to be responded with the requested message content',
        () =>
          readRow(
            db,
            `SELECT i.responded, i.initial_response_message_id, m.content
             FROM interactions i LEFT JOIN messages m
               ON m.id = i.initial_response_message_id
             WHERE i.id = ? AND i.token = ?`,
            [f.interactionId, f.interactionToken]
          ),
        (after) => {
          const row = after as {
            responded?: unknown
            initial_response_message_id?: unknown
            content?: unknown
          }
          return (
            row.responded === 1 &&
            typeof row.initial_response_message_id === 'string' &&
            row.content === 'contract callback response'
          )
        }
      )
    }
    case 'post /interactions/{interaction_id}/{interaction_token}/callback 204': {
      return rowEffect(
        f,
        'target interaction to be marked responded without a response message',
        `SELECT responded, initial_response_message_id FROM interactions
         WHERE id = ? AND token = ?`,
        [f.interactionId, f.interactionToken],
        { responded: 1, initial_response_message_id: null }
      )
    }
    case 'post /channels/{channel_id}/threads 201': {
      return matchingRowCreatedEffect(
        f,
        'a thread with the requested parent, name, and bot membership to be created',
        `SELECT COUNT(*) AS count FROM channels c JOIN thread_members tm ON tm.thread_id = c.id
         WHERE c.parent_id = ? AND c.name = ? AND c.type = 11 AND tm.user_id = ?`,
        [f.channelId, 'new-thread', f.userId]
      )
    }
    case 'post /channels/{channel_id}/messages/{message_id}/threads 201': {
      return matchingRowCreatedEffect(
        f,
        'a thread with the requested parent, name, and bot membership to be created',
        `SELECT COUNT(*) AS count FROM channels c JOIN thread_members tm ON tm.thread_id = c.id
         WHERE c.parent_id = ? AND c.name = ? AND c.type = 11 AND tm.user_id = ?`,
        [f.channelId, 'msg-thread', f.userId]
      )
    }
    case 'put /channels/{channel_id}/thread-members/@me 204': {
      return rowEffect(
        f,
        'the bot membership to exist in the target thread',
        'SELECT thread_id, user_id FROM thread_members WHERE thread_id = ? AND user_id = ?',
        [f.joinableThreadId, f.userId],
        { thread_id: f.joinableThreadId, user_id: f.userId }
      )
    }
    case 'delete /channels/{channel_id}/thread-members/@me 204': {
      return rowEffect(
        f,
        'the bot membership to be absent from the target thread',
        'SELECT user_id FROM thread_members WHERE thread_id = ? AND user_id = ?',
        [f.threadId, f.userId],
        null
      )
    }
    case 'put /channels/{channel_id}/thread-members/{user_id} 204': {
      return rowEffect(
        f,
        'the requested user membership to exist in the target thread',
        'SELECT thread_id, user_id FROM thread_members WHERE thread_id = ? AND user_id = ?',
        [f.threadId, f.memberId],
        { thread_id: f.threadId, user_id: f.memberId }
      )
    }
    case 'delete /channels/{channel_id}/thread-members/{user_id} 204': {
      return rowEffect(
        f,
        'the requested user membership to be absent from the target thread',
        'SELECT user_id FROM thread_members WHERE thread_id = ? AND user_id = ?',
        [f.memberThreadId, f.memberId],
        null
      )
    }
    case 'post /channels/{channel_id}/messages/{message_id}/crosspost 200': {
      return rowEffect(
        f,
        'target announcement message CROSSPOSTED flag to be set',
        'SELECT flags FROM messages WHERE id = ? AND channel_id = ?',
        [f.announcementMessageId, f.announcementChannelId],
        { flags: 2 }
      )
    }
    case 'post /channels/{channel_id}/followers 200': {
      return matchingRowCreatedEffect(
        f,
        'a follower webhook in the requested destination channel to be created',
        'SELECT COUNT(*) AS count FROM webhooks WHERE channel_id = ? AND name = ?',
        [f.channelId, 'Follower Webhook']
      )
    }
    case 'put /channels/{channel_id}/voice-status 204': {
      return rowEffect(
        f,
        'target voice channel status to equal contract test',
        'SELECT voice_status FROM channels WHERE id = ?',
        [f.voiceChannelId],
        { voice_status: 'contract test' }
      )
    }
    case 'put /channels/{channel_id}/recipients/{user_id} 201':
    case 'put /channels/{channel_id}/recipients/{user_id} 204': {
      return rowEffect(
        f,
        'the requested recipient to exist in the target group DM',
        'SELECT channel_id, user_id FROM channel_recipients WHERE channel_id = ? AND user_id = ?',
        [f.groupDmChannelId, f.memberId],
        { channel_id: f.groupDmChannelId, user_id: f.memberId }
      )
    }
    case 'delete /channels/{channel_id}/recipients/{user_id} 204': {
      return rowEffect(
        f,
        'the target recipient to be absent from the target group DM',
        'SELECT user_id FROM channel_recipients WHERE channel_id = ? AND user_id = ?',
        [f.groupDmChannelId, f.removableRecipientId],
        null
      )
    }
    case 'post /users/@me/channels 200': {
      return matchingRowCreatedEffect(
        f,
        'a two-recipient DM containing the bot and requested user to be created',
        `SELECT COUNT(*) AS count FROM channels c
         WHERE c.type = 1 AND c.guild_id IS NULL
           AND EXISTS (SELECT 1 FROM channel_recipients r WHERE r.channel_id = c.id AND r.user_id = ?)
           AND EXISTS (SELECT 1 FROM channel_recipients r WHERE r.channel_id = c.id AND r.user_id = ?)
           AND (SELECT COUNT(*) FROM channel_recipients r WHERE r.channel_id = c.id) = 2`,
        [f.userId, f.memberId]
      )
    }
    case 'post /channels/{channel_id}/polls/{message_id}/expire 200': {
      return predicateEffect(
        'target poll to be finalized with an expiry timestamp',
        () =>
          readRow(
            db,
            'SELECT finalized, expiry FROM polls WHERE message_id = ?',
            [f.pollMessageId]
          ),
        (after) => {
          const row = after as { finalized?: unknown; expiry?: unknown }
          return row.finalized === 1 && typeof row.expiry === 'string'
        }
      )
    }
    case 'post /webhooks/{webhook_id}/{webhook_token}/github 204': {
      return matchingRowCreatedEffect(
        f,
        'a target-webhook message with a GitHub embed to be created',
        `SELECT COUNT(*) AS count FROM messages m JOIN embeds e ON e.message_id = m.id
         WHERE m.channel_id = ? AND m.author_id = ?`,
        [f.channelId, f.webhookId]
      )
    }
    case 'post /webhooks/{webhook_id}/{webhook_token}/slack 200': {
      return matchingRowCreatedEffect(
        f,
        'a target-webhook message with the requested Slack text to be created',
        `SELECT COUNT(*) AS count FROM messages
         WHERE channel_id = ? AND author_id = ? AND content = ?`,
        [f.channelId, f.webhookId, 'contract test']
      )
    }
    case 'delete /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name} 204': {
      return rowEffect(
        f,
        'all target emoji reactions to be absent',
        'SELECT id FROM reactions WHERE message_id = ? AND emoji = ?',
        [f.reactedMessageId, '👍'],
        null
      )
    }
    case 'post /channels/{channel_id}/send-soundboard-sound 204': {
      return matchingRowCreatedEffect(
        f,
        'a channel soundboard playback to be recorded',
        `SELECT COUNT(*) AS count FROM channel_soundboard_playbacks
         WHERE channel_id = ? AND user_id = ? AND sound_id = ?`,
        [f.channelId, f.userId, f.guildSoundboardSoundId]
      )
    }
    case 'post /guilds/{guild_id}/auto-moderation/rules 200': {
      return matchingRowCreatedEffect(
        f,
        'the requested auto-moderation rule to be created',
        `SELECT COUNT(*) AS count FROM auto_moderation_rules
         WHERE guild_id = ? AND name = ?`,
        [f.guildId, 'Contract rule']
      )
    }
    case 'patch /guilds/{guild_id}/auto-moderation/rules/{rule_id} 200': {
      return rowEffect(
        f,
        'the auto-moderation rule name to be updated',
        'SELECT name FROM auto_moderation_rules WHERE guild_id = ? AND id = ?',
        [f.guildId, f.autoModerationRuleId],
        { name: 'Updated contract rule' }
      )
    }
    case 'delete /guilds/{guild_id}/auto-moderation/rules/{rule_id} 204': {
      return rowEffect(
        f,
        'the auto-moderation rule to be absent',
        'SELECT id FROM auto_moderation_rules WHERE guild_id = ? AND id = ?',
        [f.guildId, f.autoModerationRuleId],
        null
      )
    }
    case 'post /guilds/{guild_id}/bulk-ban 200': {
      return rowEffect(
        f,
        'the requested user to be banned',
        'SELECT guild_id, user_id FROM guild_bans WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.addableMemberId],
        { guild_id: f.guildId, user_id: f.addableMemberId }
      )
    }
    case 'patch /guilds/{guild_id}/channels 204': {
      return rowEffect(
        f,
        'the target channel position to be updated',
        'SELECT position FROM channels WHERE guild_id = ? AND id = ?',
        [f.guildId, f.channelId],
        { position: 7 }
      )
    }
    case 'put /guilds/{guild_id}/incident-actions 200': {
      return rowEffect(
        f,
        'incident actions to be persisted',
        `SELECT invites_disabled_until, dms_disabled_until
         FROM guild_incident_actions WHERE guild_id = ?`,
        [f.guildId],
        {
          invites_disabled_until: '2030-01-01T00:00:00.000Z',
          dms_disabled_until: null,
        }
      )
    }
    case 'delete /guilds/{guild_id}/integrations/{integration_id} 204': {
      return rowEffect(
        f,
        'the target integration to be marked deleted',
        'SELECT deleted FROM guild_integrations WHERE guild_id = ? AND id = ?',
        [f.guildId, f.guildIntegrationId],
        { deleted: 1 }
      )
    }
    case 'put /guilds/{guild_id}/members/{user_id} 201': {
      return rowEffect(
        f,
        'the requested member to be added',
        'SELECT nick FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.addableMemberId],
        { nick: 'New contract member' }
      )
    }
    case 'put /guilds/{guild_id}/members/{user_id} 204': {
      return rowEffect(
        f,
        'the existing member nickname to be updated',
        'SELECT nick FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.memberId],
        { nick: 'Updated contract member' }
      )
    }
    case 'put /guilds/{guild_id}/onboarding 200': {
      return rowEffect(
        f,
        'onboarding settings to be updated',
        `SELECT enabled, mode FROM guild_onboarding_settings
         WHERE guild_id = ?`,
        [f.guildId],
        { enabled: 0, mode: 1 }
      )
    }
    case 'post /guilds/{guild_id}/prune 200': {
      return matchingRowCreatedEffect(
        f,
        'a guild prune run to be recorded',
        'SELECT COUNT(*) AS count FROM guild_prune_runs WHERE guild_id = ? AND days = 7',
        [f.guildId]
      )
    }
    case 'patch /guilds/{guild_id}/requests/{request_id} 200': {
      return rowEffect(
        f,
        'the guild join request status to be updated',
        `SELECT application_status FROM guild_join_requests
         WHERE guild_id = ? AND id = ?`,
        [f.guildId, f.joinRequestId],
        { application_status: 'APPROVED' }
      )
    }
    case 'patch /guilds/{guild_id}/roles 200': {
      return rowEffect(
        f,
        'the target role position to be updated',
        'SELECT position FROM roles WHERE guild_id = ? AND id = ?',
        [f.guildId, f.roleId],
        { position: 5 }
      )
    }
    case 'post /guilds/{guild_id}/scheduled-events 200': {
      return matchingRowCreatedEffect(
        f,
        'the requested scheduled event to be created',
        `SELECT COUNT(*) AS count FROM scheduled_events
         WHERE guild_id = ? AND name = ?`,
        [f.guildId, 'Contract external event']
      )
    }
    case 'patch /guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id} 200': {
      return rowEffect(
        f,
        'the target scheduled event name to be updated',
        'SELECT name FROM scheduled_events WHERE guild_id = ? AND id = ?',
        [f.guildId, f.scheduledEventId],
        { name: 'Updated contract event' }
      )
    }
    case 'delete /guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id} 204': {
      return rowEffect(
        f,
        'the target scheduled event to be absent',
        'SELECT id FROM scheduled_events WHERE guild_id = ? AND id = ?',
        [f.guildId, f.scheduledEventId],
        null
      )
    }
    case 'post /guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions 200': {
      return matchingRowCreatedEffect(
        f,
        'the requested scheduled event exception to be created',
        `SELECT COUNT(*) AS count FROM scheduled_event_exceptions
         WHERE event_id = ? AND scheduled_start_time = ?`,
        [f.scheduledEventId, '2030-03-01T00:00:00.000Z']
      )
    }
    case 'patch /guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions/{exception_id} 200': {
      return rowEffect(
        f,
        'the event exception to be canceled',
        `SELECT is_canceled FROM scheduled_event_exceptions
         WHERE event_id = ? AND id = ?`,
        [f.scheduledEventId, f.scheduledEventExceptionId],
        { is_canceled: 1 }
      )
    }
    case 'delete /guilds/{guild_id}/scheduled-events/{guild_scheduled_event_id}/exceptions/{exception_id} 204': {
      return rowEffect(
        f,
        'the event exception to be absent',
        `SELECT id FROM scheduled_event_exceptions
         WHERE event_id = ? AND id = ?`,
        [f.scheduledEventId, f.scheduledEventExceptionId],
        null
      )
    }
    case 'post /guilds/{guild_id}/soundboard-sounds 201': {
      return rowEffect(
        f,
        'the requested soundboard sound to be created',
        'SELECT name FROM soundboard_sounds WHERE guild_id = ? AND id = ?',
        [f.guildId, '977777777777777777'],
        { name: 'Created contract sound' }
      )
    }
    case 'patch /guilds/{guild_id}/soundboard-sounds/{sound_id} 200': {
      return rowEffect(
        f,
        'the target soundboard sound name to be updated',
        'SELECT name FROM soundboard_sounds WHERE guild_id = ? AND id = ?',
        [f.guildId, f.guildSoundboardSoundId],
        { name: 'Updated contract sound' }
      )
    }
    case 'delete /guilds/{guild_id}/soundboard-sounds/{sound_id} 204': {
      return rowEffect(
        f,
        'the target soundboard sound to be absent',
        'SELECT id FROM soundboard_sounds WHERE guild_id = ? AND id = ?',
        [f.guildId, f.guildSoundboardSoundId],
        null
      )
    }
    case 'post /guilds/{guild_id}/stickers 201': {
      return matchingRowCreatedEffect(
        f,
        'the requested guild sticker to be created',
        'SELECT COUNT(*) AS count FROM stickers WHERE guild_id = ? AND name = ?',
        [f.guildId, 'created-sticker']
      )
    }
    case 'patch /guilds/{guild_id}/stickers/{sticker_id} 200': {
      return rowEffect(
        f,
        'the target guild sticker name to be updated',
        'SELECT name FROM stickers WHERE guild_id = ? AND id = ?',
        [f.guildId, f.guildStickerId],
        { name: 'updated-sticker' }
      )
    }
    case 'delete /guilds/{guild_id}/stickers/{sticker_id} 204': {
      return rowEffect(
        f,
        'the target guild sticker to be absent',
        'SELECT id FROM stickers WHERE guild_id = ? AND id = ?',
        [f.guildId, f.guildStickerId],
        null
      )
    }
    case 'post /guilds/{guild_id}/templates 200': {
      return matchingRowCreatedEffect(
        f,
        'the requested guild template to be created',
        `SELECT COUNT(*) AS count FROM guild_templates
         WHERE source_guild_id = ? AND name = ?`,
        [f.guildId, 'Created contract template']
      )
    }
    case 'put /guilds/{guild_id}/templates/{code} 200': {
      return rowEffect(
        f,
        'the target guild template to be synchronized',
        'SELECT is_dirty FROM guild_templates WHERE source_guild_id = ? AND code = ?',
        [f.guildId, f.guildTemplateCode],
        { is_dirty: 0 }
      )
    }
    case 'patch /guilds/{guild_id}/templates/{code} 200': {
      return rowEffect(
        f,
        'the target guild template name to be updated',
        'SELECT name FROM guild_templates WHERE source_guild_id = ? AND code = ?',
        [f.guildId, f.guildTemplateCode],
        { name: 'Updated contract template' }
      )
    }
    case 'delete /guilds/{guild_id}/templates/{code} 200': {
      return rowEffect(
        f,
        'the target guild template to be absent',
        'SELECT code FROM guild_templates WHERE source_guild_id = ? AND code = ?',
        [f.guildId, f.guildTemplateCode],
        null
      )
    }
    case 'patch /guilds/{guild_id}/voice-states/@me 204': {
      return rowEffect(
        f,
        'the bot voice state to be suppressed',
        'SELECT suppress FROM guild_voice_states WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.userId],
        { suppress: 1 }
      )
    }
    case 'patch /guilds/{guild_id}/voice-states/{user_id} 204': {
      return rowEffect(
        f,
        'the member voice state to be suppressed',
        'SELECT suppress FROM guild_voice_states WHERE guild_id = ? AND user_id = ?',
        [f.guildId, f.memberId],
        { suppress: 1 }
      )
    }
    case 'patch /guilds/{guild_id}/welcome-screen 200': {
      return rowEffect(
        f,
        'the welcome-screen description to be updated',
        'SELECT description FROM guild_welcome_screen_settings WHERE guild_id = ?',
        [f.guildId],
        { description: 'Updated contract welcome' }
      )
    }
    case 'patch /guilds/{guild_id}/widget 200': {
      return rowEffect(
        f,
        'widget settings to be updated',
        'SELECT enabled, channel_id FROM guild_widget_settings WHERE guild_id = ?',
        [f.guildId],
        { enabled: 0, channel_id: null }
      )
    }
    default: {
      throw new Error(
        `No operation-specific mutation effect declared for ${key}`
      )
    }
  }
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

    if (entry.specPath === '/applications/{application_id}/attachment') {
      const body = (await response.json()) as {
        attachment?: { url?: unknown }
      }
      if (typeof body.attachment?.url !== 'string') {
        throw new TypeError(`${label} did not return an attachment URL`)
      }
      const assetUrl = new URL(body.attachment.url)
      if (assetUrl.origin !== baseUrl) {
        throw new Error(
          `${label} returned an attachment outside the test server`
        )
      }
      const asset = await fetch(assetUrl)
      if (
        asset.status !== 200 ||
        (await asset.text()) !== 'contract application attachment'
      ) {
        throw new Error(`${label} did not persist the uploaded attachment`)
      }
      return
    }

    if (entry.method === 'get') return
    const effect = mutationEffects
      .get(fixture)
      ?.get(`${entry.method} ${entry.specPath} ${status}`)
    if (!effect) {
      throw new Error(`${label} did not capture its expected operation effect`)
    }
    if (!effect.isApplied()) {
      throw new Error(
        `${label} did not apply its expected operation effect: ${effect.description}`
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
export const MANIFEST: SpecEndpoint[] = uniqueLegacyEntries
  .values()
  .map((entry: LegacySpecEndpoint) => {
    const key = `${entry.method} ${entry.specPath}`
    const statuses = MULTI_SUCCESS_STATUSES[key] ?? [entry.successStatus]
    return {
      specPath: entry.specPath,
      method: entry.method,
      authentication: authenticationFor(entry),
      createFixture: (factory: ContractFixtureFactory) => factory.create(),
      successBranches: statuses.map((status) => ({
        status,
        ...responseContract(entry, status),
        responseSchemaOverride: entry.responseSchemaOverride,
        request: (fixture: ContractFixture) => {
          const request = alternateRequest(entry, status, fixture)
          captureMutationEffect(entry, status, fixture)
          return request
        },
        assert: createOperationAssertion(entry, status),
      })),
    }
  })
  .toArray()
