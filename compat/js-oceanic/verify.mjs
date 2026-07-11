// Oceanic.js compatibility verifier.
//
// Unlike Eris, Oceanic.js's RequestHandler accepts a full `baseURL` (protocol
// + host + port), so it can be pointed at plain-HTTP Fauxcord directly.
//
// Oceanic is an object-model library (not a thin REST client), so each
// endpoint is mapped to its concrete high-level method under
// `client.rest.{channels,guilds,users,webhooks,oauth}`. Endpoints with no
// wrapper (e.g. the new-format `/messages/pins` API, or bot-inapplicable
// ones like `DELETE /guilds/{id}`) are recorded as `n-a` with an evidence
// note.

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

/**
 * POST the shared setup payload. 200/201 (created) and 409 (already set up
 * by a prior run against a reused Fauxcord container) both count as success.
 * Retries with backoff on network errors or unexpected statuses; throws if
 * setup never succeeds so a genuine failure is loud instead of silently
 * corrupting every downstream result.
 */
async function doSetup() {
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${ORIGIN}/_test/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(setup),
      })
      if (res.ok || res.status === 409) return
      console.error(
        `doSetup: unexpected status ${res.status} (attempt ${attempt}/${maxAttempts})`
      )
    } catch (e) {
      console.error(
        `doSetup: request failed: ${e.message} (attempt ${attempt}/${maxAttempts})`
      )
    }
    if (attempt < maxAttempts) {
      await new Promise((res) => setTimeout(res, 1000 * attempt))
    }
  }
  throw new Error('doSetup: failed to POST /_test/setup after retries')
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
let THREAD_ID = CH
// A dummy target for ban endpoints. Banning BOT itself would kick it from
// guild_members (matching real Discord ban semantics), which then cascades
// into "Unknown Member" failures on every later member-role/get/edit call
// that also targets BOT (same bug class already fixed in
// js-discordjs/verify.mjs).
const BAN_USER_ID = '900000000000000001'

try {
  const msg = await rest.channels.createMessage(CH, { content: 'compat' })
  MSG = msg.id
} catch {
  // fall back to placeholder id
}
try {
  // Bootstrap a real thread so the thread-member endpoints operate on an
  // actual thread channel rather than the plain parent channel (a
  // thread-member add/remove/list on a non-thread channel 404s as "Unknown
  // Channel" in real Discord and in Fauxcord).
  const threadSourceMsg = await rest.channels.createMessage(CH, {
    content: 'compat-thread-source',
  })
  const thread = await rest.channels.startThreadFromMessage(
    CH,
    threadSourceMsg.id,
    {
      name: 'compat-thread-bootstrap',
    }
  )
  THREAD_ID = thread.id
} catch {
  // fall back to the plain channel id
}
try {
  // Pre-create the ban on the dummy target so the GET (which runs before
  // the PUT in endpoint order) finds it instead of 404ing as "Unknown Ban".
  await rest.guilds.createBan(GUILD, BAN_USER_ID)
} catch {
  // ignore; the PUT call below still exercises the create-ban wire format
}
try {
  const role = await rest.guilds.createRole(GUILD, { name: 'compat-role' })
  ROLE = role.id
} catch {
  // fall back: @everyone role id == guild id in fauxcord
}
try {
  const wh = await rest.webhooks.create(CH, { name: 'compat-wh' })
  WEBHOOK_ID = wh.id
  WEBHOOK_TOKEN = wh.token
} catch {
  // fall back to placeholder ids
}
try {
  const inv = await rest.channels.createInvite(CH, {})
  CODE = inv.code
} catch {
  // fall back to placeholder code
}
try {
  const emoji = await rest.guilds.createEmoji(GUILD, {
    name: 'compat',
    image:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  })
  EMOJI_ID = emoji.id
} catch {
  // fall back to placeholder id
}
try {
  await rest.channels.createReaction(CH, MSG, EMOJI)
} catch {
  // ignore; reaction endpoints below may still exercise the wire format
}

// Endpoint key -> [fn, note-if-n-a]. `fn` undefined => n-a (note required).
const calls = {
  'GET /channels/{channel_id}/invites': [() => rest.channels.getInvites(CH)],
  'POST /channels/{channel_id}/invites': [
    () => rest.channels.createInvite(CH, {}),
  ],
  'DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}':
    [() => rest.channels.deleteReaction(CH, MSG, EMOJI, BOT)],
  'DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me':
    [() => rest.channels.deleteReaction(CH, MSG, EMOJI)],
  'PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me':
    [() => rest.channels.createReaction(CH, MSG, EMOJI)],
  'GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}': [
    () => rest.channels.getReactions(CH, MSG, EMOJI),
  ],
  'DELETE /channels/{channel_id}/messages/{message_id}/reactions': [
    () => rest.channels.deleteReactions(CH, MSG),
  ],
  'POST /channels/{channel_id}/messages/{message_id}/threads': [
    () =>
      rest.channels.startThreadFromMessage(CH, MSG, { name: 'compat-thread' }),
  ],
  'DELETE /channels/{channel_id}/messages/{message_id}': [
    () => rest.channels.deleteMessage(CH, MSG),
  ],
  'GET /channels/{channel_id}/messages/{message_id}': [
    () => rest.channels.getMessage(CH, MSG),
  ],
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
    () =>
      rest.channels.editPermission(CH, BOT, { allow: '0', deny: '0', type: 1 }),
  ],
  'DELETE /channels/{channel_id}/pins/{message_id}': [
    () => rest.channels.unpinMessage(CH, MSG),
  ],
  'PUT /channels/{channel_id}/pins/{message_id}': [
    () => rest.channels.pinMessage(CH, MSG),
  ],
  'GET /channels/{channel_id}/pins': [
    () => rest.channels.getPinnedMessages(CH),
  ],
  'DELETE /channels/{channel_id}/thread-members/{user_id}': [
    () => rest.channels.removeThreadMember(THREAD_ID, BOT),
  ],
  'GET /channels/{channel_id}/thread-members/{user_id}': [
    () => rest.channels.getThreadMember(THREAD_ID, BOT),
  ],
  'PUT /channels/{channel_id}/thread-members/{user_id}': [
    () => rest.channels.addThreadMember(THREAD_ID, BOT),
  ],
  'DELETE /channels/{channel_id}/thread-members/@me': [
    () => rest.channels.leaveThread(THREAD_ID),
  ],
  'PUT /channels/{channel_id}/thread-members/@me': [
    () => rest.channels.joinThread(THREAD_ID),
  ],
  'GET /channels/{channel_id}/thread-members': [
    () => rest.channels.getThreadMembers(THREAD_ID),
  ],
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
    () =>
      rest.channels.startThreadWithoutMessage(CH, {
        name: 'compat-thread',
        type: 11,
      }),
  ],
  'POST /channels/{channel_id}/typing': [() => rest.channels.sendTyping(CH)],
  'GET /channels/{channel_id}/users/@me/threads/archived/private': [
    () => rest.channels.getJoinedPrivateArchivedThreads(CH),
  ],
  'GET /channels/{channel_id}/webhooks': [
    () => rest.webhooks.getForChannel(CH),
  ],
  'POST /channels/{channel_id}/webhooks': [
    () => rest.webhooks.create(CH, { name: 'compat-wh2' }),
  ],
  'DELETE /channels/{channel_id}': [
    undefined,
    'not exercised: would delete the shared test channel other rows depend on',
  ],
  'GET /channels/{channel_id}': [() => rest.channels.get(CH)],
  'PATCH /channels/{channel_id}': [
    () => rest.channels.edit(CH, { name: 'general' }),
  ],
  'GET /gateway/bot': [
    undefined,
    'gateway bootstrap info is fetched internally by Client#connect, no standalone REST wrapper',
  ],
  'GET /gateway': [
    undefined,
    'gateway bootstrap info is fetched internally by Client#connect, no standalone REST wrapper',
  ],
  'DELETE /guilds/{guild_id}/bans/{user_id}': [
    () => rest.guilds.removeBan(GUILD, BAN_USER_ID),
  ],
  'GET /guilds/{guild_id}/bans/{user_id}': [
    () => rest.guilds.getBan(GUILD, BAN_USER_ID),
  ],
  'PUT /guilds/{guild_id}/bans/{user_id}': [
    () => rest.guilds.createBan(GUILD, BAN_USER_ID),
  ],
  'GET /guilds/{guild_id}/bans': [() => rest.guilds.getBans(GUILD)],
  'GET /guilds/{guild_id}/channels': [() => rest.guilds.getChannels(GUILD)],
  'POST /guilds/{guild_id}/channels': [
    () => rest.guilds.createChannel(GUILD, 0, { name: 'compat-channel' }),
  ],
  'DELETE /guilds/{guild_id}/emojis/{emoji_id}': [
    () => rest.guilds.deleteEmoji(GUILD, EMOJI_ID),
  ],
  'GET /guilds/{guild_id}/emojis/{emoji_id}': [
    () => rest.guilds.getEmoji(GUILD, EMOJI_ID),
  ],
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
  'GET /guilds/{guild_id}/members/{user_id}': [
    () => rest.guilds.getMember(GUILD, BOT),
  ],
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
  'POST /guilds/{guild_id}/roles': [
    () => rest.guilds.createRole(GUILD, { name: 'compat-role2' }),
  ],
  'GET /guilds/{guild_id}/webhooks': [() => rest.webhooks.getForGuild(GUILD)],
  'DELETE /guilds/{guild_id}': [
    undefined,
    'no high-level wrapper: bots cannot delete guilds in the real Discord API (owner-only)',
  ],
  'GET /guilds/{guild_id}': [() => rest.guilds.get(GUILD)],
  'PATCH /guilds/{guild_id}': [
    () => rest.guilds.edit(GUILD, { name: 'Compat Guild' }),
  ],
  'DELETE /invites/{code}': [() => rest.channels.deleteInvite(CODE)],
  'GET /invites/{code}': [() => rest.channels.getInvite(CODE)],
  'GET /oauth2/@me': [
    undefined,
    'not exercised: requires an OAuth2 bearer token from a completed authorization, not a Bot token',
  ],
  'GET /oauth2/applications/@me': [() => rest.oauth.getApplication()],
  'POST /oauth2/token/revoke': [
    undefined,
    'not exercised: requires a form-urlencoded token-revocation request, not a Bot-token JSON call',
  ],
  'POST /oauth2/token': [
    undefined,
    'not exercised: requires a form-urlencoded authorization-code/client-credentials grant request, not a Bot-token JSON call',
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
    () =>
      rest.webhooks.editToken(WEBHOOK_ID, WEBHOOK_TOKEN, {
        name: 'compat-renamed',
      }),
  ],
  'POST /webhooks/{webhook_id}/{webhook_token}': [
    () =>
      rest.webhooks.execute(WEBHOOK_ID, WEBHOOK_TOKEN, { content: 'compat' }),
  ],
  'DELETE /webhooks/{webhook_id}': [
    undefined,
    'not exercised: would delete the shared webhook other rows still need',
  ],
  'GET /webhooks/{webhook_id}': [() => rest.webhooks.get(WEBHOOK_ID)],
  'PATCH /webhooks/{webhook_id}': [
    () => rest.webhooks.edit(WEBHOOK_ID, { name: 'compat-renamed2' }),
  ],
}

// The canonical endpoint order runs some DELETE/GET calls before the PUT/POST
// that creates the resource they act on. Running all non-DELETEs first, then
// DELETEs last, avoids false "Unknown X" errors from resource-lifecycle
// ordering rather than real Fauxcord/library bugs.
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
      note:
        entry?.[1] ?? 'no high-level Oceanic.js method found for this endpoint',
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

/**
 * Runs the Gateway connect + dispatch verification using a second Oceanic
 * Client instance with gateway enabled (the REST-only `client` above keeps
 * `gateway: { disable: true }` for the REST phase).
 * @returns Gateway verification result object.
 */
async function verifyOceanicGateway() {
  const steps = []
  const gwClient = new Client({
    auth: 'Bot compat-token',
    rest: { baseURL: `${ORIGIN}/api/v10` },
    gateway: { concurrency: 1 },
  })

  // Oceanic's own docs warn that an unhandled 'error' event throws and can
  // kill the process, so give it a sink. Separately, Fauxcord's mock READY
  // payload has no `application` field; Oceanic's Shard._ready constructs a
  // ClientApplication from `d.application` and throws synchronously when
  // it's missing. That throw happens inside the ws 'message' event handler,
  // so it never surfaces as a rejection of connect()/the 'ready' listener
  // below, nor as an 'error' event — it's a raw uncaughtException. The
  // shard also auto-reconnects and retries IDENTIFY after this crash, so
  // the same exception can recur while this function is running. The handler
  // is scoped to this function: it is removed before every return (see
  // `process.removeListener` below) so it cannot silently swallow an
  // unrelated fatal error later in the run.
  gwClient.on('error', () => {
    // swallowed: outcome is captured via the promises below instead
  })
  let onUncaughtGatewayError
  const onProcessUncaught = (error) => {
    onUncaughtGatewayError?.(error)
  }
  process.on('uncaughtException', onProcessUncaught)

  const connectOutcome = await new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(
      () => finish({ ok: false, error: new Error('ready timeout') }),
      20000
    )
    function finish(outcome) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      onUncaughtGatewayError = undefined
      resolve(outcome)
    }
    onUncaughtGatewayError = (error) => finish({ ok: false, error })
    gwClient.once('ready', () => finish({ ok: true }))
    gwClient.connect().catch((error) => finish({ ok: false, error }))
  })

  if (!connectOutcome.ok) {
    steps.push({
      step: 'connect-identify-ready',
      status: 'lib-issue',
      note: String(connectOutcome.error?.message ?? connectOutcome.error).slice(
        0,
        300
      ),
    })
    // The shard's WebSocket may still be open even though READY failed
    // (e.g. the crash above happens after the socket connects but before
    // the shard is marked ready), which would otherwise keep the process
    // alive forever.
    gwClient.shards?.forEach((s) => s.disconnect())
    process.removeListener('uncaughtException', onProcessUncaught)
    return { status: 'lib-issue', steps }
  }
  steps.push({ step: 'connect-identify-ready', status: 'pass', note: '' })

  try {
    const dispatchWait = new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('messageCreate timeout')),
        15000
      )
      // Filter by the exact content we're about to send so an unrelated
      // message arriving first in a shared run can't produce a false pass.
      const onMessage = (msg) => {
        if (msg.content !== 'gateway-compat-check') return
        gwClient.off('messageCreate', onMessage)
        clearTimeout(t)
        resolve(msg)
      }
      gwClient.on('messageCreate', onMessage)
    })
    await rest.channels.createMessage(CH, {
      content: 'gateway-compat-check',
    })
    await dispatchWait
    steps.push({ step: 'dispatch-message-create', status: 'pass', note: '' })
  } catch (err) {
    steps.push({
      step: 'dispatch-message-create',
      status: 'lib-issue',
      note: String(err?.message ?? err).slice(0, 300),
    })
  } finally {
    gwClient.shards?.forEach((s) => s.disconnect())
  }

  const failed = steps.find((s) => s.status !== 'pass')
  process.removeListener('uncaughtException', onProcessUncaught)
  return { status: failed ? failed.status : 'pass', steps }
}

const gatewayResult = await verifyOceanicGateway()

writeFileSync(
  process.env.RESULTS_PATH ?? '/results/oceanic.json',
  JSON.stringify(
    {
      library: 'oceanic.js',
      version: '1.11.x',
      baseUrlOverridable: true,
      results,
      gateway: gatewayResult,
    },
    null,
    2
  )
)
console.log(
  `oceanic done: ${results.filter((r) => r.status === 'pass').length}/${results.length} pass`
)
// The Gateway phase's shard may keep retrying/reconnecting in the
// background after a failed handshake despite the disconnect calls above,
// which would otherwise leave the process hanging past this point.
process.exit(0)
