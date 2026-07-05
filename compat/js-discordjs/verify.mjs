// discord.js (@discordjs/rest) compatibility verifier.
//
// @discordjs/rest is a generic REST client (not an object model), so its
// "high-level API" is rest.get/post/patch/put/delete against Discord routes.
// Every endpoint discord.js can address is therefore exercised through its
// request pipeline (headers, query handling, JSON parsing). We bootstrap the
// resources that path params refer to (message, role, webhook, invite,
// reaction), resolve each endpoint's params, call it, and record the outcome.

import { REST } from '@discordjs/rest'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.FAUXCORD_BASE ?? 'http://fauxcord:3000/api/v10'
const ORIGIN = BASE.replace(/\/api\/v10$/, '')
const setup = JSON.parse(readFileSync('./common/setup.json', 'utf8'))
const endpoints = JSON.parse(readFileSync('./common/endpoints.json', 'utf8'))

const BOT = setup.user.id
const GUILD = setup.guilds[0].id
const CH = setup.guilds[0].channels[0].id

const rest = new REST({ version: '10', api: `${ORIGIN}/api` }).setToken(
  'compat-token'
)

/** Wait until the SUT health endpoint responds ok. */
async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${ORIGIN}/_mock/health`)
      if (r.ok) return
    } catch {
      // ignore, retry below
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

/**
 * Bootstrap the resources referenced by path parameters and return a context
 * map used to resolve `{...}` placeholders. Best-effort: a failed bootstrap
 * leaves the placeholder unresolved and dependent endpoints get recorded as
 * lib-issue (useful triage signal rather than a hard stop).
 */
async function bootstrap() {
  const ctx = {
    '{channel_id}': CH,
    '{guild_id}': GUILD,
    '{user_id}': BOT,
    '{overwrite_id}': BOT,
    '{emoji_name}': encodeURIComponent('👍'),
  }
  // Banning the bot's own {user_id} would kick it from the guild (matches
  // real Discord: banning implies removal from guild_members), which then
  // 404s every subsequent guild-member endpoint with "Unknown Member" —
  // a verifier bootstrap bug, not a Fauxcord bug (Fauxcord allows banning an
  // arbitrary/non-member user id, so a dedicated dummy id is a safe target).
  ctx.banUserId = '900000000000000001'
  // endpoints.json orders `GET /guilds/{guild_id}/bans/{user_id}` before the
  // `PUT` that creates it (see the array order in compat/common/endpoints.json),
  // so create the ban up front here rather than relying on the main loop's
  // own PUT to have run first.
  try {
    await rest.put(`/guilds/${GUILD}/bans/${ctx.banUserId}`, { body: {} })
  } catch {
    // ignore; the main loop's own PUT test will surface any real failure
  }
  try {
    const msg = await rest.post(`/channels/${CH}/messages`, {
      body: { content: 'compat' },
    })
    ctx['{message_id}'] = msg.id
  } catch {
    ctx['{message_id}'] = '400000000000000001'
  }
  try {
    const role = await rest.post(`/guilds/${GUILD}/roles`, {
      body: { name: 'compat-role' },
    })
    ctx['{role_id}'] = role.id
  } catch {
    ctx['{role_id}'] = GUILD // @everyone role id == guild id in fauxcord
  }
  try {
    const wh = await rest.post(`/channels/${CH}/webhooks`, {
      body: { name: 'compat-wh' },
    })
    ctx['{webhook_id}'] = wh.id
    ctx['{webhook_token}'] = wh.token
  } catch {
    ctx['{webhook_id}'] = '500000000000000001'
    ctx['{webhook_token}'] = 'compat-token-xyz'
  }
  // A second, dedicated webhook for the id-only-form DELETE test below.
  // `DELETE /webhooks/{webhook_id}/{webhook_token}` and
  // `DELETE /webhooks/{webhook_id}` both target the SAME webhook by id
  // underneath; running both against ctx['{webhook_id}'] means whichever
  // runs first deletes it out from under the other ("Unknown Webhook").
  try {
    const wh2 = await rest.post(`/channels/${CH}/webhooks`, {
      body: { name: 'compat-wh2-idonly' },
    })
    ctx.webhookIdOnlyDeleteId = wh2.id
  } catch {
    ctx.webhookIdOnlyDeleteId = '500000000000000002'
  }
  // A webhook-authored message, for the /webhooks/{id}/{token}/messages/{id}
  // family. Sharing ctx['{message_id}'] with the plain channel-message
  // endpoints would let `DELETE /channels/{channel_id}/messages/{message_id}`
  // (which runs earlier in the DELETE pass) delete it out from under the
  // webhook-message DELETE test ("Unknown Message").
  try {
    const whMsg = await rest.post(
      `/webhooks/${ctx['{webhook_id}']}/${ctx['{webhook_token}']}?wait=true`,
      { body: { content: 'compat-webhook-msg' } }
    )
    ctx.webhookMessageId = whMsg.id
  } catch {
    ctx.webhookMessageId = '400000000000000004'
  }
  try {
    const inv = await rest.post(`/channels/${CH}/invites`, { body: {} })
    ctx['{code}'] = inv.code
  } catch {
    ctx['{code}'] = 'compat'
  }
  try {
    const emoji = await rest.post(`/guilds/${GUILD}/emojis`, {
      body: {
        name: 'compat',
        // 1x1 transparent PNG data URI
        image:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      },
    })
    ctx['{emoji_id}'] = emoji.id
  } catch {
    ctx['{emoji_id}'] = '600000000000000001'
  }
  // Ensure a reaction exists so reaction GET/DELETE have something to act on.
  try {
    await rest.put(
      `/channels/${CH}/messages/${ctx['{message_id}']}/reactions/${ctx['{emoji_name}']}/@me`
    )
  } catch {
    // ignore
  }
  // Bootstrap a real thread so the thread-members endpoints below operate on
  // an actual thread instead of the plain text channel. endpoints.json reuses
  // the `{channel_id}` placeholder for these paths (a thread IS a channel),
  // so main() substitutes THREAD_ID for CH specifically for thread-members
  // endpoints. Uses a dedicated message rather than ctx['{message_id}'] since
  // Discord only allows one thread per message.
  try {
    const threadSourceMsg = await rest.post(`/channels/${CH}/messages`, {
      body: { content: 'compat-thread-source' },
    })
    const thread = await rest.post(
      `/channels/${CH}/messages/${threadSourceMsg.id}/threads`,
      { body: { name: 'compat-thread' } }
    )
    ctx.threadId = thread.id
  } catch {
    ctx.threadId = CH
  }
  // A second, throwaway message pair for bulk-delete (needs 2+ distinct ids).
  try {
    const m1 = await rest.post(`/channels/${CH}/messages`, {
      body: { content: 'bulk-1' },
    })
    const m2 = await rest.post(`/channels/${CH}/messages`, {
      body: { content: 'bulk-2' },
    })
    ctx.bulkDeleteIds = [m1.id, m2.id]
  } catch {
    ctx.bulkDeleteIds = ['400000000000000002', '400000000000000003']
  }
  return ctx
}

/** Resolve a spec path template against the bootstrap context. */
function resolve(path, ctx) {
  return path.replace(/{[^}]+}/g, (p) => ctx[p] ?? '0')
}

/** Minimal request bodies for endpoints that require them. */
function bodyFor(method, path, ctx) {
  if (method === 'POST' && path === '/channels/{channel_id}/messages')
    return { content: 'compat' }
  if (
    method === 'PATCH' &&
    path === '/channels/{channel_id}/messages/{message_id}'
  )
    return { content: 'compat-edit' }
  if (method === 'POST' && path.endsWith('/messages/{message_id}/threads'))
    return { name: 'compat-thread' }
  if (method === 'POST' && path === '/channels/{channel_id}/threads')
    return { name: 'compat-thread2', type: 11 }
  if (method === 'POST' && path === '/guilds/{guild_id}/roles/{role_id}')
    return [{ id: GUILD, position: 1 }]
  if (method === 'PATCH' && path === '/guilds/{guild_id}/roles/{role_id}')
    return { name: 'renamed' }
  if (method === 'PATCH' && path === '/guilds/{guild_id}/channels')
    return [{ id: CH, position: 0 }]
  if (method === 'POST' && path === '/guilds/{guild_id}/channels')
    return { name: 'compat-channel' }
  if (method === 'POST' && path === '/guilds/{guild_id}/emojis')
    return {
      name: 'compat2',
      image:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    }
  if (method === 'POST' && path === '/guilds/{guild_id}/members')
    return { access_token: 'x' }
  if (method === 'PATCH' && path === '/guilds/{guild_id}/members/{user_id}')
    return { nick: 'compat' }
  if (method === 'PUT' && path === '/guilds/{guild_id}/bans/{user_id}')
    return {}
  if (
    method === 'PATCH' &&
    (path === '/users/{user_id}' || path === '/users/@me')
  )
    return { username: 'CompatBot' }
  // Webhook execute (no trailing sub-path) needs a message body, unlike the
  // webhook CRUD endpoints below which need { name }.
  if (method === 'POST' && path === '/webhooks/{webhook_id}/{webhook_token}')
    return { content: 'compat' }
  if (method.match(/^(POST|PATCH|PUT)$/) && path.includes('webhooks'))
    return { name: 'compat' }
  if (
    method === 'POST' &&
    path === '/channels/{channel_id}/messages/bulk-delete'
  )
    return { messages: ctx.bulkDeleteIds }
  if (
    method === 'PUT' &&
    path === '/channels/{channel_id}/permissions/{overwrite_id}'
  )
    return { type: 1, allow: '0', deny: '0' }
  return undefined
}

// Endpoints that destroy a shared fixture other rows in this same run still
// depend on, so they are recorded as n-a instead of actually invoked (same
// precedent as js-oceanic/verify.mjs's `calls` table entries for these paths).
const SKIP = {
  'DELETE /channels/{channel_id}':
    'not exercised: would delete the shared test channel other rows depend on',
  'DELETE /guilds/{guild_id}':
    'not exercised: bots cannot delete guilds in the real Discord API (owner-only), and doing so would cascade-destroy every other guild-scoped fixture this run still needs',
  // ctx['{user_id}'] is BOT itself; removing it from its own guild would 404
  // every guild-member endpoint if the container is reused across runs.
  'DELETE /guilds/{guild_id}/members/{user_id}':
    'not exercised: would remove the bot itself from the shared test guild',
  // These require an OAuth2 bearer/authorization-code or client-credentials
  // flow, which a raw REST client configured with a single Bot token
  // (rest.setToken()) cannot produce.
  'GET /oauth2/@me':
    'not exercised: requires an OAuth2 bearer token from a completed authorization, not a Bot token',
  'POST /oauth2/token':
    'not exercised: requires a form-urlencoded authorization-code/client-credentials grant request, not a Bot-token JSON call',
  'POST /oauth2/token/revoke':
    'not exercised: requires a form-urlencoded token-revocation request, not a Bot-token JSON call',
}

async function main() {
  await waitHealthy()
  await doSetup()
  const ctx = await bootstrap()
  const results = []

  // Run non-DELETE endpoints first, then DELETEs, so deletions don't remove
  // resources that GET/PATCH rows still need.
  const ordered = [...endpoints].sort(
    (a, b) => (a.method === 'DELETE') - (b.method === 'DELETE')
  )

  for (const { method, path } of ordered) {
    const key = `${method} ${path}`
    if (SKIP[key]) {
      results.push({ endpoint: key, status: 'n-a', note: SKIP[key] })
      continue
    }
    // thread-members/*, bans/*, and the webhook-message / id-only-webhook
    // -delete families each need a dedicated fixture id instead of the
    // shared `{channel_id}`/`{user_id}`/`{message_id}`/`{webhook_id}`
    // placeholders (see the matching bootstrap() comments).
    const url = path.includes('/thread-members')
      ? resolve(path, { ...ctx, '{channel_id}': ctx.threadId })
      : path.includes('/bans/')
        ? resolve(path, { ...ctx, '{user_id}': ctx.banUserId })
        : path.includes('/webhooks/{webhook_id}/{webhook_token}/messages/')
          ? resolve(path, { ...ctx, '{message_id}': ctx.webhookMessageId })
          : method === 'DELETE' && path === '/webhooks/{webhook_id}'
            ? resolve(path, {
                ...ctx,
                '{webhook_id}': ctx.webhookIdOnlyDeleteId,
              })
            : resolve(path, ctx)
    const body = bodyFor(method, path, ctx)
    const opts = body === undefined ? undefined : { body }
    try {
      switch (method) {
        case 'GET':
          await rest.get(url)
          break
        case 'POST':
          await rest.post(url, opts)
          break
        case 'PATCH':
          await rest.patch(url, opts)
          break
        case 'PUT':
          await rest.put(url, opts ?? { body: {} })
          break
        case 'DELETE':
          await rest.delete(url)
          break
        default:
          results.push({
            endpoint: key,
            status: 'n-a',
            note: `unsupported method ${method}`,
          })
          continue
      }
      results.push({ endpoint: key, status: 'pass', note: '' })
    } catch (err) {
      const status = err?.status ?? ''
      const raw = err?.rawError ? JSON.stringify(err.rawError) : String(err)
      results.push({
        endpoint: key,
        status: 'lib-issue',
        http: status,
        note: raw.slice(0, 300),
      })
    } finally {
      // @discordjs/rest clears the shared REST instance's token on ANY 401
      // response (e.g. from the oauth2 endpoints, which need a bearer token
      // rather than a Bot token). Reassert it after every attempt so one
      // 401 doesn't cascade a token error into the rest of the run.
      rest.setToken('compat-token')
    }
  }

  // Re-key results back to endpoints.json order for a stable matrix.
  const byKey = new Map(results.map((r) => [r.endpoint, r]))
  const ordered2 = endpoints.map(({ method, path }) =>
    byKey.get(`${method} ${path}`)
  )

  writeFileSync(
    process.env.RESULTS_PATH ?? '/results/discordjs.json',
    JSON.stringify(
      {
        library: 'discord.js',
        version: '@discordjs/rest 2.x',
        baseUrlOverridable: true,
        results: ordered2,
      },
      null,
      2
    )
  )
  const pass = results.filter((r) => r.status === 'pass').length
  console.log(`discordjs done: ${pass}/${results.length} pass`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
