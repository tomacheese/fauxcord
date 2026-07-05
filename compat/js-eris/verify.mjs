// Eris compatibility verifier.
//
// FEASIBILITY FINDING (confirmed against eris@0.18.x source in this build):
// Eris's RequestHandler builds every request with Node's `https` module,
// hardcoding HTTPS on port 443 (node_modules/eris/lib/rest/RequestHandler.js).
// `options.rest.baseURL` only overrides the path prefix, not the scheme or
// port, so there is no way to point Eris at plain-HTTP Fauxcord without an
// external TLS-terminating reverse proxy — infrastructure the library itself
// doesn't support configuring. So every endpoint is recorded as `blocked`
// rather than executed.

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
