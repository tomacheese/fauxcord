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

const rest = new REST({ version: '10', api: `${ORIGIN}/api` }).setToken('compat-token')

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
 * Retries with backoff on network errors or unexpected statuses (see
 * js-oceanic/verify.mjs's doSetup for the incident that motivated this).
 * Throws if setup never succeeds so a genuine failure is loud instead of
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
  try {
    const msg = await rest.post(`/channels/${CH}/messages`, { body: { content: 'compat' } })
    ctx['{message_id}'] = msg.id
  } catch {
    ctx['{message_id}'] = '400000000000000001'
  }
  try {
    const role = await rest.post(`/guilds/${GUILD}/roles`, { body: { name: 'compat-role' } })
    ctx['{role_id}'] = role.id
  } catch {
    ctx['{role_id}'] = GUILD // @everyone role id == guild id in fauxcord
  }
  try {
    const wh = await rest.post(`/channels/${CH}/webhooks`, { body: { name: 'compat-wh' } })
    ctx['{webhook_id}'] = wh.id
    ctx['{webhook_token}'] = wh.token
  } catch {
    ctx['{webhook_id}'] = '500000000000000001'
    ctx['{webhook_token}'] = 'compat-token-xyz'
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
      `/channels/${CH}/messages/${ctx['{message_id}']}/reactions/${ctx['{emoji_name}']}/@me`,
    )
  } catch {
    // ignore
  }
  return ctx
}

/** Resolve a spec path template against the bootstrap context. */
function resolve(path, ctx) {
  return path.replace(/{[^}]+}/g, (p) => ctx[p] ?? '0')
}

/** Minimal request bodies for endpoints that require them. */
function bodyFor(method, path) {
  if (method === 'POST' && path === '/channels/{channel_id}/messages') return { content: 'compat' }
  if (method === 'PATCH' && path === '/channels/{channel_id}/messages/{message_id}')
    return { content: 'compat-edit' }
  if (method === 'POST' && path.endsWith('/messages/{message_id}/threads'))
    return { name: 'compat-thread' }
  if (method === 'POST' && path === '/guilds/{guild_id}/roles/{role_id}') return [{ id: GUILD, position: 1 }]
  if (method === 'PATCH' && path === '/guilds/{guild_id}/roles/{role_id}') return { name: 'renamed' }
  if (method === 'PATCH' && path === '/guilds/{guild_id}/channels') return [{ id: CH, position: 0 }]
  if (method === 'POST' && path === '/guilds/{guild_id}/members') return { access_token: 'x' }
  if (method === 'PATCH' && path === '/guilds/{guild_id}/members/{user_id}') return { nick: 'compat' }
  if (method === 'PUT' && path === '/guilds/{guild_id}/bans/{user_id}') return {}
  if (method === 'PATCH' && (path === '/users/{user_id}' || path === '/users/@me'))
    return { username: 'CompatBot' }
  if (method.match(/^(POST|PATCH|PUT)$/) && path.includes('webhooks')) return { name: 'compat' }
  return undefined
}

async function main() {
  await waitHealthy()
  await doSetup()
  const ctx = await bootstrap()
  const results = []

  // Run non-DELETE endpoints first, then DELETEs, so deletions don't remove
  // resources that GET/PATCH rows still need.
  const ordered = [...endpoints].sort((a, b) => (a.method === 'DELETE') - (b.method === 'DELETE'))

  for (const { method, path } of ordered) {
    const key = `${method} ${path}`
    const url = resolve(path, ctx)
    const body = bodyFor(method, path)
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
          results.push({ endpoint: key, status: 'n-a', note: `unsupported method ${method}` })
          continue
      }
      results.push({ endpoint: key, status: 'pass', note: '' })
    } catch (err) {
      const status = err?.status ?? ''
      const raw = err?.rawError ? JSON.stringify(err.rawError) : String(err)
      results.push({ endpoint: key, status: 'lib-issue', http: status, note: raw.slice(0, 300) })
    }
  }

  // Re-key results back to endpoints.json order for a stable matrix.
  const byKey = new Map(results.map((r) => [r.endpoint, r]))
  const ordered2 = endpoints.map(({ method, path }) => byKey.get(`${method} ${path}`))

  writeFileSync(
    '/results/discordjs.json',
    JSON.stringify(
      { library: 'discord.js', version: '@discordjs/rest 2.x', baseUrlOverridable: true, results: ordered2 },
      null,
      2,
    ),
  )
  const pass = results.filter((r) => r.status === 'pass').length
  console.log(`discordjs done: ${pass}/${results.length} pass`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
