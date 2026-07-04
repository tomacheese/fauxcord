// Eris compatibility verifier.
//
// FEASIBILITY FINDING (confirmed against eris@0.18.x source in this build):
// Eris's RequestHandler builds every request with Node's `https` module and
// passes only `{ method, host, path, headers, agent }` to `HTTPS.request`
// (see node_modules/eris/lib/rest/RequestHandler.js, constructor default
// `domain: "discord.com"` and the request call around `HTTPS.request({...})`).
// There is no `port` field anywhere in RequestHandler.js or Client.js, no
// scheme option, and `options.rest.baseURL` (Client.js jsdoc) only replaces
// the *path* prefix (`Endpoints.BASE_URL`, default `/api/v10`) — not the
// scheme or port. Node's `https` module defaults to port 443 when no `port`
// is supplied, and there is no way to make Eris speak plain HTTP or target a
// non-443 port. Fauxcord serves plain HTTP on a configurable port (3000 by
// default), so Eris cannot be pointed at it without an external TLS-terminating
// reverse proxy on port 443 — which is infrastructure the *library* itself
// does not support configuring, matching the spec's `⛔blocked` criteria
// ("base URL is a compile-time const" / cannot be redirected at all).
//
// Per plan Task 6 delta guidance, this is recorded as a full-column block
// rather than executing calls: every endpoint is `blocked`.

import { readFileSync, writeFileSync } from 'node:fs'

const endpoints = JSON.parse(readFileSync('./common/endpoints.json', 'utf8'))

const NOTE =
  'Eris hardcodes HTTPS on port 443 (see node_modules/eris/lib/rest/RequestHandler.js: ' +
  '`HTTPS.request({ method, host: this.options.domain, path: this.options.baseURL + finalURL, ... })`, ' +
  'no `port`/scheme option anywhere); options.rest.baseURL only overrides the path prefix, not scheme/port. ' +
  'Cannot be redirected to a plain-HTTP Fauxcord instance.'

const results = endpoints.map(({ method, path }) => ({
  endpoint: `${method} ${path}`,
  status: 'blocked',
  note: NOTE,
}))

writeFileSync(
  '/results/eris.json',
  JSON.stringify(
    { library: 'eris', version: '0.18.x', baseUrlOverridable: false, results },
    null,
    2,
  ),
)
console.log('eris: blocked (no scheme/port override) —', results.length, 'rows')
