// Oceanic.js compatibility verifier.
//
// Oceanic.js's RequestHandler accepts a full `baseURL` (protocol + host +
// port), unlike Eris (see node_modules/oceanic.js/dist/lib/rest/RequestHandler.js:
// `baseURL: options.baseURL ?? Constants.API_URL`, then `new URL(options.baseURL)`
// to derive `host`), so it can be pointed at plain-HTTP Fauxcord directly.
//
// Oceanic is an object-model library (like discord.js proper, not a thin REST
// client), so each endpoint is mapped to its concrete high-level method under
// `client.rest.{channels,guilds,users,webhooks,oauth}`. Endpoints with no
// wrapper (e.g. the new-format `/messages/pins` API — Oceanic only wraps the
// legacy `/pins` API — or bot-inapplicable ones like `DELETE /guilds/{id}`)
// are recorded as `n-a` with an evidence note.

import { Client } from 'oceanic.js'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.FAUXCORD_BASE ?? 'http://fauxcord:3000/api/v10'
const ORIGIN = BASE.replace(/\/api\/v10$/, '')
const setup = JSON.parse(readFileSync('./common/setup.json', 'utf8'))
const endpoints = JSON.parse(readFileSync('./common/endpoints.json', 'utf8'))

const BOT = setup.user.id
const GUILD = setup.guilds[0].id
const CH = setup.guilds[0].channels[0].id
// Oceanic's own request-building code URL-encodes the emoji name/path segment
// internally, so passing an already-encoded string here would double-encode
// it and trigger "URI malformed" on decode. Pass the raw character.
const EMOJI = '👍'

const client = new Client({
  auth: 'Bot compat-token',
  rest: { baseURL: `${ORIGIN}/api/v10` },
  gateway: { disable: true },
})
const rest = client.rest

/** Wait until the SUT health endpoint responds ok. */
async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${ORIGIN}/_mock/health`)
      if (r.ok) return
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 1000))
  }
  throw new Error('fauxcord did not become healthy')
}

/** POST the shared setup payload (idempotent: ignore an existing 409). */
async function doSetup() {
  await fetch(`${ORIGIN}/_test/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(setup),
  }).catch(() => {})
}

await waitHealthy()
await doSetup()

// Bootstrap resources referenced by later calls.
let MSG = '400000000000000001'
let ROLE = GUILD
let WEBHOOK_ID = '500000000000000001'
let WEBHOOK_TOKEN = 'compat-token-xyz'
let CODE = 'compat'
let EMOJI_ID = '600000000000000001'

try {
  const msg = await rest.channels.createMessage(CH, { content: 'compat' })
  MSG = msg.id
} catch {
  /* fall back to placeholder id */
}
try {
  const role = await rest.guilds.createRole(GUILD, { name: 'compat-role' })
  ROLE = role.id
} catch {
  /* fall back: @everyone role id == guild id in fauxcord */
}
try {
  const wh = await rest.webhooks.create(CH, { name: 'compat-wh' })
  WEBHOOK_ID = wh.id
  WEBHOOK_TOKEN = wh.token
} catch {
  /* fall back to placeholder ids */
}
try {
  const inv = await rest.channels.createInvite(CH, {})
  CODE = inv.code
} catch {
  /* fall back to placeholder code */
}
try {
  const emoji = await rest.guilds.createEmoji(GUILD, {
    name: 'compat',
    image:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  })
  EMOJI_ID = emoji.id
} catch {
  /* fall back to placeholder id */
}
try {
  await rest.channels.createReaction(CH, MSG, EMOJI)
} catch {
  /* ignore: reaction endpoints may still exercise the wire format */
}

// Endpoint key -> [fn, note-if-n-a]. `fn` undefined => n-a (note required).
const calls = {
  'GET /channels/{channel_id}/invites': [() => rest.channels.getInvites(CH)],
  'POST /channels/{channel_id}/invites': [() => rest.channels.createInvite(CH, {})],
  'DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}': [
    () => rest.channels.deleteReaction(CH, MSG, EMOJI, BOT),
  ],
  'DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me': [
    () => rest.channels.deleteReaction(CH, MSG, EMOJI),
  ],
  'PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me': [
    () => rest.channels.createReaction(CH, MSG, EMOJI),
  ],
  'GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}': [
    () => rest.channels.getReactions(CH, MSG, EMOJI),
  ],
  'DELETE /channels/{channel_id}/messages/{message_id}/reactions': [
    () => rest.channels.deleteReactions(CH, MSG),
  ],
  'POST /channels/{channel_id}/messages/{message_id}/threads': [
    () => rest.channels.startThreadFromMessage(CH, MSG, { name: 'compat-thread' }),
  ],
  'DELETE /channels/{channel_id}/messages/{message_id}': [
    () => rest.channels.deleteMessage(CH, MSG),
  ],
  'GET /channels/{channel_id}/messages/{message_id}': [() => rest.channels.getMessage(CH, MSG)],
  'PATCH /channels/{channel_id}/messages/{message_id}': [
    () => rest.channels.editMessage(CH, MSG, { content: 'compat-edit' }),
  ],
  'POST /channels/{channel_id}/messages/bulk-delete': [
    undefined,
    'no dedicated bulk-delete wrapper; Channels#purgeMessages uses individual deletes',
  ],
  'DELETE /channels/{channel_id}/messages/pins/{message_id}': [
    undefined,
    'Oceanic only wraps the legacy /pins API (unpinMessage), not the new /messages/pins API',
  ],
  'PUT /channels/{channel_id}/messages/pins/{message_id}': [
    undefined,
    'Oceanic only wraps the legacy /pins API (pinMessage), not the new /messages/pins API',
  ],
  'GET /channels/{channel_id}/messages/pins': [
    undefined,
    'Oceanic only wraps the legacy /pins API (getPinnedMessages), not the new /messages/pins API',
  ],
  'GET /channels/{channel_id}/messages': [() => rest.channels.getMessages(CH)],
  'POST /channels/{channel_id}/messages': [
    () => rest.channels.createMessage(CH, { content: 'compat' }),
  ],
  'DELETE /channels/{channel_id}/permissions/{overwrite_id}': [
    () => rest.channels.deletePermission(CH, BOT),
  ],
  'PUT /channels/{channel_id}/permissions/{overwrite_id}': [
    () => rest.channels.editPermission(CH, BOT, { allow: '0', deny: '0', type: 1 }),
  ],
  'DELETE /channels/{channel_id}/pins/{message_id}': [
    () => rest.channels.unpinMessage(CH, MSG),
  ],
  'PUT /channels/{channel_id}/pins/{message_id}': [() => rest.channels.pinMessage(CH, MSG)],
  'GET /channels/{channel_id}/pins': [() => rest.channels.getPinnedMessages(CH)],
  'DELETE /channels/{channel_id}/thread-members/{user_id}': [
    () => rest.channels.removeThreadMember(CH, BOT),
  ],
  'GET /channels/{channel_id}/thread-members/{user_id}': [
    () => rest.channels.getThreadMember(CH, BOT),
  ],
  'PUT /channels/{channel_id}/thread-members/{user_id}': [
    () => rest.channels.addThreadMember(CH, BOT),
  ],
  'DELETE /channels/{channel_id}/thread-members/@me': [() => rest.channels.leaveThread(CH)],
  'PUT /channels/{channel_id}/thread-members/@me': [() => rest.channels.joinThread(CH)],
  'GET /channels/{channel_id}/thread-members': [() => rest.channels.getThreadMembers(CH)],
  'GET /channels/{channel_id}/threads/archived/private': [
    () => rest.channels.getPrivateArchivedThreads(CH),
  ],
  'GET /channels/{channel_id}/threads/archived/public': [
    () => rest.channels.getPublicArchivedThreads(CH),
  ],
  'GET /channels/{channel_id}/threads/search': [
    undefined,
    'no high-level wrapper for the thread search endpoint',
  ],
  'POST /channels/{channel_id}/threads': [
    () => rest.channels.startThreadWithoutMessage(CH, { name: 'compat-thread', type: 11 }),
  ],
  'POST /channels/{channel_id}/typing': [() => rest.channels.sendTyping(CH)],
  'GET /channels/{channel_id}/users/@me/threads/archived/private': [
    () => rest.channels.getJoinedPrivateArchivedThreads(CH),
  ],
  'GET /channels/{channel_id}/webhooks': [() => rest.webhooks.getForChannel(CH)],
  'POST /channels/{channel_id}/webhooks': [() => rest.webhooks.create(CH, { name: 'compat-wh2' })],
  'DELETE /channels/{channel_id}': [undefined, 'not exercised: would delete the shared test channel other rows depend on'],
  'GET /channels/{channel_id}': [() => rest.channels.get(CH)],
  'PATCH /channels/{channel_id}': [() => rest.channels.edit(CH, { name: 'general' })],
  'GET /gateway/bot': [undefined, 'gateway bootstrap info is fetched internally by Client#connect, no standalone REST wrapper'],
  'GET /gateway': [undefined, 'gateway bootstrap info is fetched internally by Client#connect, no standalone REST wrapper'],
  'DELETE /guilds/{guild_id}/bans/{user_id}': [() => rest.guilds.removeBan(GUILD, BOT)],
  'GET /guilds/{guild_id}/bans/{user_id}': [() => rest.guilds.getBan(GUILD, BOT)],
  'PUT /guilds/{guild_id}/bans/{user_id}': [() => rest.guilds.createBan(GUILD, BOT)],
  'GET /guilds/{guild_id}/bans': [() => rest.guilds.getBans(GUILD)],
  'GET /guilds/{guild_id}/channels': [() => rest.guilds.getChannels(GUILD)],
  'POST /guilds/{guild_id}/channels': [
    () => rest.guilds.createChannel(GUILD, 0, { name: 'compat-channel' }),
  ],
  'DELETE /guilds/{guild_id}/emojis/{emoji_id}': [() => rest.guilds.deleteEmoji(GUILD, EMOJI_ID)],
  'GET /guilds/{guild_id}/emojis/{emoji_id}': [() => rest.guilds.getEmoji(GUILD, EMOJI_ID)],
  'PATCH /guilds/{guild_id}/emojis/{emoji_id}': [
    () => rest.guilds.editEmoji(GUILD, EMOJI_ID, { name: 'compat2' }),
  ],
  'GET /guilds/{guild_id}/emojis': [() => rest.guilds.getEmojis(GUILD)],
  'POST /guilds/{guild_id}/emojis': [
    () =>
      rest.guilds.createEmoji(GUILD, {
        name: 'compat3',
        image:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      }),
  ],
  'DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}': [
    () => rest.guilds.removeMemberRole(GUILD, BOT, ROLE),
  ],
  'PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}': [
    () => rest.guilds.addMemberRole(GUILD, BOT, ROLE),
  ],
  'DELETE /guilds/{guild_id}/members/{user_id}': [
    undefined,
    'not exercised: would remove the bot itself from the shared test guild',
  ],
  'GET /guilds/{guild_id}/members/{user_id}': [() => rest.guilds.getMember(GUILD, BOT)],
  'PATCH /guilds/{guild_id}/members/{user_id}': [
    () => rest.guilds.editMember(GUILD, BOT, { nick: 'compat' }),
  ],
  'GET /guilds/{guild_id}/members': [() => rest.guilds.getMembers(GUILD)],
  'DELETE /guilds/{guild_id}/roles/{role_id}': [
    undefined,
    'not exercised: would remove the role other rows (member-role add/remove) still need',
  ],
  'PATCH /guilds/{guild_id}/roles/{role_id}': [
    () => rest.guilds.editRole(GUILD, ROLE, { name: 'compat-role-renamed' }),
  ],
  'GET /guilds/{guild_id}/roles': [() => rest.guilds.getRoles(GUILD)],
  'POST /guilds/{guild_id}/roles': [() => rest.guilds.createRole(GUILD, { name: 'compat-role2' })],
  'GET /guilds/{guild_id}/webhooks': [() => rest.webhooks.getForGuild(GUILD)],
  'DELETE /guilds/{guild_id}': [undefined, 'no high-level wrapper: bots cannot delete guilds in the real Discord API (owner-only)'],
  'GET /guilds/{guild_id}': [() => rest.guilds.get(GUILD)],
  'PATCH /guilds/{guild_id}': [() => rest.guilds.edit(GUILD, { name: 'Compat Guild' })],
  'DELETE /invites/{code}': [() => rest.channels.deleteInvite(CODE)],
  'GET /invites/{code}': [() => rest.channels.getInvite(CODE)],
  'GET /oauth2/@me': [() => rest.oauth.getCurrentAuthorizationInformation()],
  'GET /oauth2/applications/@me': [() => rest.oauth.getApplication()],
  'POST /oauth2/token/revoke': [
    () => rest.oauth.revokeToken({ clientID: BOT, clientSecret: 'x', token: 'x' }),
  ],
  'POST /oauth2/token': [
    () =>
      rest.oauth.exchangeCode({
        clientID: BOT,
        clientSecret: 'x',
        code: 'x',
        redirectURI: 'http://localhost/cb',
      }),
  ],
  'GET /users/{user_id}': [() => rest.users.get(BOT)],
  'GET /users/@me/guilds': [() => rest.oauth.getCurrentGuilds()],
  'GET /users/@me': [() => rest.oauth.getCurrentUser()],
  'PATCH /users/@me': [() => rest.users.editSelf({ username: 'CompatBot' })],
  'DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}': [
    undefined,
    'not exercised: no message id captured for a webhook-authored message in this run',
  ],
  'GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}': [
    undefined,
    'not exercised: no message id captured for a webhook-authored message in this run',
  ],
  'PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}': [
    undefined,
    'not exercised: no message id captured for a webhook-authored message in this run',
  ],
  'DELETE /webhooks/{webhook_id}/{webhook_token}': [
    undefined,
    'not exercised: would delete the shared webhook other rows still need',
  ],
  'GET /webhooks/{webhook_id}/{webhook_token}': [
    () => rest.webhooks.get(WEBHOOK_ID, WEBHOOK_TOKEN),
  ],
  'PATCH /webhooks/{webhook_id}/{webhook_token}': [
    () => rest.webhooks.editToken(WEBHOOK_ID, WEBHOOK_TOKEN, { name: 'compat-renamed' }),
  ],
  'POST /webhooks/{webhook_id}/{webhook_token}': [
    () => rest.webhooks.execute(WEBHOOK_ID, WEBHOOK_TOKEN, { content: 'compat' }),
  ],
  'DELETE /webhooks/{webhook_id}': [
    undefined,
    'not exercised: would delete the shared webhook other rows still need',
  ],
  'GET /webhooks/{webhook_id}': [() => rest.webhooks.get(WEBHOOK_ID)],
  'PATCH /webhooks/{webhook_id}': [() => rest.webhooks.edit(WEBHOOK_ID, { name: 'compat-renamed2' })],
}

// The canonical endpoint order runs some DELETE/GET calls before the PUT/POST
// that creates the resource they act on (e.g. message DELETE before its
// GET/PATCH; ban DELETE/GET before the PUT that creates the ban). Running all
// non-DELETEs first, then DELETEs last, avoids false "Unknown X" errors from
// resource-lifecycle ordering rather than real Fauxcord/library bugs (same
// fix as js-discordjs/verify.mjs).
const ordered = [...endpoints].sort(
  (a, b) => (a.method === 'DELETE') - (b.method === 'DELETE')
)

const results = []
for (const { method, path } of ordered) {
  const key = `${method} ${path}`
  const entry = calls[key]
  if (!entry || !entry[0]) {
    results.push({
      endpoint: key,
      status: 'n-a',
      note: entry?.[1] ?? 'no high-level Oceanic.js method found for this endpoint',
    })
    continue
  }
  try {
    await entry[0]()
    results.push({ endpoint: key, status: 'pass', note: '' })
  } catch (err) {
    results.push({
      endpoint: key,
      status: 'lib-issue',
      note: String(err?.message ?? err).slice(0, 300),
    })
  }
}

writeFileSync(
  '/results/oceanic.json',
  JSON.stringify(
    { library: 'oceanic.js', version: '1.11.x', baseUrlOverridable: true, results },
    null,
    2,
  ),
)
console.log(
  `oceanic done: ${results.filter((r) => r.status === 'pass').length}/${results.length} pass`,
)
