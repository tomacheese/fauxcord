# Copilot code review instructions — Fauxcord

Fauxcord is a **mock server** for the Discord REST API v10 and Gateway
(WebSocket), used to integration-test Discord bots without the live service.
It is a testing tool, not a production-facing service. Keep this in mind when
reviewing: many "hardening" concerns do not apply (see "Do not flag" below).

Stack: TypeScript (ESM, `moduleResolution: bundler`), Hono + `@hono/node-server`,
`ws` for the Gateway, `better-sqlite3` (synchronous SQLite), Vitest.

## Coding conventions (enforced — flag violations)

- Every exported function and interface has **jsdoc written in English**; in-code comments and error messages are also **English**.
- **`any` is forbidden.** Prefer precise types or `unknown` with narrowing.
- Do not weaken TypeScript strictness — never change `skipLibCheck: false` in `tsconfig.json`.
- Use `Number.parseInt`/`Number.parseFloat` (not the globals) and `.toReversed()` (not `.reverse()`); the `unicorn` ESLint rules enforce this.
- Formatting follows Prettier: no semicolons, single quotes, `trailingComma: es5`, 80-column width. Do not request stylistic changes Prettier already handles.
- ESM only: relative imports have no file extension and resolve via bundler mode. Flag `require()` / CommonJS added to `src/` (the sole intentional exception is `createRequire` for `ajv-formats` in `src/spec-contract.test.ts`).

## Review focus (project-specific)

- **New endpoints must add a matching entry to `spec/manifest.ts`** — it is the single source of truth for drift detection and contract tests. A new route in `src/routes/` without a manifest entry is a defect.
- **Route registration order**: Hono is first-match-wins. Literal paths must be registered before parameterized ones (e.g. `/channels/:cid/messages/pins` before `/channels/:cid/messages/:mid`). Flag reordering that could shadow a literal route.
- **Prefix mounting**: Bot-authenticated route groups must be mounted under all three prefixes (`/api/v10`, `/api`, ``) via the `routePrefix` loop in `src/app.ts`. Flag routes reachable under only one prefix.
- **Error responses** must use `discordError(...)` / `validationError(...)` with a `DiscordErrorCode` from `src/errors.ts` and the correct HTTP status, matching the Discord spec shape — not ad-hoc `c.json({ error: ... })`.
- **Snowflake precision**: 19-digit IDs lose precision through `JSON.parse` (JS number). Flag any code that reads Snowflake IDs from a parsed JSON number instead of extracting them from the raw request text (see `src/routes/channel-messages.ts` bulk-delete).
- **SQL**: values are always bound with `?` placeholders via `better-sqlite3` prepared statements. Dynamic `UPDATE ... SET ${...}` fragments must be built from fixed column keys, never from request-supplied values. Flag any request value concatenated into SQL text.
- **Layering**: routes call `src/services/` for DB work; keep DB access out of route handlers and validation out of services (`src/validators/`).

## Testing expectations

- New or changed endpoints should have tests in the matching `src/**/*.test.ts` covering the success case plus 404, 401, and validation errors.
- Tests use an in-memory DB (`:memory:`) and the `seed*` helpers from `src/test-helpers.ts`; each test builds an independent context. Flag tests that share mutable state across cases.
- Vitest runs with `globals: false` — `describe`/`it`/`expect` must be imported explicitly.

## Do not flag

- **Dummy or hardcoded values that mimic Discord** — e.g. fixed `x-ratelimit-*` headers, the `@everyone` role ID equal to the Guild ID, hardcoded `features: []`. These are intentional mock behavior, not bugs.
- **Permissive authentication** — `DISABLE_AUTH`, accepting any token, and treating unknown tokens as a mock bot are deliberate test features, not security holes.
- **`console.info` / `console.error` logging** — acceptable in this tool; do not demand a logging framework.
- **`process.exit()` in `scripts/`** — allowed there by an explicit ESLint override (they are CLI entry points).
- **Missing production concerns** — TLS, secret storage, CSRF, session hardening, etc. are out of scope for a local mock server.

Keep review comments concrete and actionable. Prefer pointing at the specific
rule above over generic advice.
