# Fauxcord

A mock server that replicates the Discord REST API v10 **and** the Discord
Gateway (WebSocket). Point real Discord libraries at it to run integration
tests without connecting to the live service.

## Tech Stack

- **Runtime**: Node.js 24 (`.node-version`, `Dockerfile`, CI all pin 24) + TypeScript (`target: ES2024`, `moduleResolution: bundler`, `strict`, `skipLibCheck: false`)
- **HTTP framework**: Hono, served via `@hono/node-server`
- **Gateway**: `ws` (`WebSocketServer`), handled by `@hono/node-server`'s `upgradeWebSocket`
- **DB**: SQLite via `better-sqlite3` (WAL mode, `foreign_keys = ON`)
- **Types**: `discord-api-types` (v10 types only, no runtime use)
- **Test**: Vitest (`globals: false` — import `describe`/`it`/`expect` explicitly)
- **Lint/format**: ESLint (`@book000/eslint-config`) + Prettier
- **Package manager**: pnpm (version pinned in `package.json` `packageManager`)

## Essential Commands

```bash
pnpm dev              # Dev server (tsx watch, hot reload)
pnpm start            # tsx src/index.ts (production entry)
pnpm test             # Run all tests (vitest run)
pnpm test:watch       # Watch mode
pnpm test:coverage    # With v8 coverage
pnpm lint             # run-s lint:* → tsc --noEmit + eslint src/ + prettier --check src/ (required before committing)
pnpm fix              # eslint --fix + prettier --write
pnpm spec:fetch       # Download the latest upstream Discord spec
pnpm spec:diff        # Diff committed snapshot vs upstream (exit 1 = drift)
pnpm spec:update      # Overwrite spec/openapi.json with upstream
```

## Architecture

```
src/
├── index.ts          # Production entry: loadConfig → initializeDatabase → buildApp → serve, SEED_FILE loading, graceful Gateway shutdown
├── app.ts            # buildApp(db, config): assembles middleware + routes + Gateway WS. Shared by index.ts and tests
├── config.ts         # loadConfig() — environment variables (see table below)
├── db.ts             # SQLite init (WAL, foreign keys) and table definitions
├── snowflake.ts      # Snowflake ID generation (Discord Epoch 1420070400000n)
├── errors.ts         # DiscordErrorCode map + discordError() / validationError() helpers
├── lib/              # Shared route helpers (requireEntity, parseLimitQuery, parseJsonBody)
├── middleware/       # auth, cors, latency, rate-limit, version
├── routes/           # Hono route factories: createXxxRoutes(db, ...)
├── services/         # DB operation logic (called from routes and the Gateway)
├── validators/       # Request validation (errors follow the Discord spec format)
├── gateway/          # Gateway WebSocket: server, session(+SessionManager), protocol, opcodes, dispatch, bus, intents, subscribe
├── test-helpers.ts   # createTestApp / createFullTestApp / createTestGatewayServer + seed* helpers
└── spec-contract.test.ts  # Ajv contract tests against the committed spec snapshot
spec/       # openapi.json snapshot, manifest.ts, skip.ts, enum-noise.ts (spec-drift tracking)
scripts/    # spec-fetch.ts, spec-diff.ts (CLI, invoked via tsx)
compat/     # Docker-based cross-library compatibility harness (see below)
docs/       # getting-started, test-api, libraries
```

**Assembly & route mounting** (all in `src/app.ts`'s `buildApp`):

- `corsMiddleware` and `versionMiddleware` run on all requests.
- Auth-exempt routes are mounted **before** the auth middleware: mock (`/`), test-control (`/`), OAuth2 (validates its own auth), and the Gateway WebSocket (`GET /`, authenticated inside IDENTIFY).
- Then `authMiddleware` → `latencyMiddleware` → `rateLimitMiddleware`.
- Bot-authenticated route groups (channels, guilds, users, gateway, webhooks, invites) are each mounted under **all three prefixes** — `/api/v10`, `/api`, and `` (bare) — via the `routePrefix` loop.

## Code Conventions

- **jsdoc (in English) on every function and interface**; in-code comments in English.
- **Error messages in English** (e.g. `"Unknown Channel"`).
- **`any` is forbidden** (ESLint) and **never change `skipLibCheck: false`**.
- Unicorn rules apply: use `.toReversed()` not `.reverse()`, `Number.parseInt` not `parseInt`.
- Prettier: no semicolons, single quotes, `trailingComma: es5`, `printWidth: 80`.
- Discord-spec error responses:
  ```typescript
  return c.json(
    discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404).body,
    404
  )
  ```

**Route definition order matters** — Hono is first-match-wins. Define literal
paths before parameterized ones (e.g. `/channels/:cid/messages/pins` before
`/channels/:cid/messages/:mid`).

**Adding a new endpoint**:

1. Add the DB operation to `src/services/` (jsdoc required).
2. Add the route to the relevant factory in `src/routes/`.
3. Add validation to `src/validators/` if needed.
4. Add tests (`src/routes/xxx.test.ts`; TDD recommended).
5. **Add an entry to `spec/manifest.ts`** — the single source of truth for drift detection and contract tests.

## Testing

Approach: t_wada style TDD (Red → Green → Refactor). Use an in-memory DB
(`:memory:`) so tests are independent.

| Type              | Location                    | Setup helper                             |
| ----------------- | --------------------------- | ---------------------------------------- |
| Unit              | `src/xxx.test.ts`           | direct import (snowflake, errors, …)     |
| Route             | `src/routes/xxx.test.ts`    | build a local Hono app + one route factory |
| Contract          | `src/spec-contract.test.ts` | `createFullTestApp()`                    |
| Gateway           | `src/gateway/*.test.ts`     | `createTestGatewayServer()`              |
| Integration       | `src/integration.test.ts`   | multi-feature scenarios                  |

Route tests mount just the factory under test and seed the DB with the
`seed*` helpers from `src/test-helpers.ts`:

```typescript
import { Hono } from 'hono'
import { createChannelRoutes } from './channels'
import { initializeDatabase } from '../db'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'

const BASE_URL = 'http://localhost:3000'
const db = initializeDatabase(':memory:')
const app = new Hono()
app.route('/', createChannelRoutes(db, BASE_URL))

// seed* helpers return the created entity's ID (a string), not an object
const bot = seedBot(db, 'Bot testtoken')
const guild = seedGuild(db, bot)
const channel = seedChannel(db, guild)

const res = await app.request('/channels/' + channel, {
  headers: { Authorization: 'Bot testtoken' },
})
expect(res.status).toBe(200)
```

Notes:

- `createTestApp()` returns a bare app (no routes); `createFullTestApp()` mounts
  every route group (used by contract tests). Most route tests build their own app.
- WAL mode reports as `"memory"` on `:memory:` → `expect(["wal", "memory"]).toContain(mode)`.
- Cover at minimum the success case plus 404, 401, and validation errors.

## Environment Variables

| Variable       | Default                 | Description                                    |
| -------------- | ----------------------- | ---------------------------------------------- |
| `PORT`         | `3000`                  | Listen port                                    |
| `HOST`         | `0.0.0.0`               | Bind address                                   |
| `DB_PATH`      | `/data/mock.db`         | SQLite file path                               |
| `UPLOAD_PATH`  | `/data/uploads`         | Attachment storage directory                   |
| `BASE_URL`     | `http://localhost:3000` | Base URL used to generate attachment URLs      |
| `LOG_LEVEL`    | `info`                  | `debug` / `info` / `warn` / `error`            |
| `DISABLE_AUTH` | `false`                 | `true` accepts any token                       |
| `LATENCY_MS`   | `0`                     | Artificial latency added to all responses      |
| `SEED_FILE`    | _(none)_                | JSON (`{ "bots": [...] }`) loaded at startup — see `seed.example.json` |

## Gotchas

- **Route groups must stay inside the `routePrefix` loop** so `/api/v10/...`, `/api/...`, and bare paths all resolve (includes Webhooks).
- **Webhook execution `wait`**: both `"true"` and `"1"` are truthy (discord.py sends `?wait=1`).
- **Pins**: `GET /channels/:id/messages/pins` (new API) returns `{"items":[...],"has_more":false}`; `GET /channels/:id/pins` (old API) returns a flat array.
- **Bulk-delete IDs**: 19-digit Snowflakes lose precision through `JSON.parse`, so they are extracted from the raw request text via regex (see `src/routes/channel-messages.ts`).
- **`embeds: null`** (sent by discordgo etc.) is treated as an empty array.
- **`/users/%40me`**: percent-encoded `@me` is supported.
- **Docker healthcheck** uses `127.0.0.1` explicitly (busybox `wget` resolves `localhost` to IPv6 on Alpine).
- **`@everyone` role**: auto-created at Guild creation with ID = Guild ID.
- **Gateway auth** happens inside the IDENTIFY payload, not via HTTP headers.

## Spec Drift Tracking

Fauxcord tracks the official
[Discord OpenAPI spec](https://github.com/discord/discord-api-spec) to detect
when the real API diverges from the mock.

| File | Role |
| ---- | ---- |
| `spec/openapi.json` | Committed upstream snapshot (raw, byte-identical) |
| `spec/manifest.ts` | Single source of truth: maps every implemented endpoint to its spec path/method. Drives drift detection and contract tests |
| `spec/skip.ts` | Endpoints/assertions skipped due to confirmed spec-side bugs (`reason` required) |
| `spec/enum-noise.ts` | Fields the mock hardcodes, so a pure enum-choice-count *increase* is not drift (`reason` required); removals and type-shape changes are still reported |
| `scripts/spec-fetch.ts` / `scripts/spec-diff.ts` | Fetch upstream / diff snapshot vs upstream |
| `src/spec-contract.test.ts` | Ajv contract tests against the snapshot |
| `.github/workflows/spec-drift.yml` | Weekly cron + `workflow_dispatch`; opens a `spec-drift` issue on drift |

**Update workflow**: the weekly job opens a `spec-drift` issue → branch from
`master` → `pnpm spec:update` → `pnpm test` (contract tests fail for stale mock
responses) → fix the mock (or add a justified `spec/skip.ts` entry) → PR.

**Policy**: only add to `spec/skip.ts` when the spec is provably wrong, and to
`spec/enum-noise.ts` only when the mock genuinely returns a fixed value
regardless of input — never just to silence an annoying diff. Type drift is also
caught at compile time: services declare compile-time compatibility guards
against `discord-api-types/v10`, so `pnpm lint:tsc` fails when Renovate bumps the
types in an incompatible way.

## Library Compatibility (`compat/`)

Docker-based harness that drives every Fauxcord endpoint through the high-level
API of each Discord library, one container per library (JS, Python, JVM, Rust,
C#, C/C++). Entry points: `compat/compose.yaml`, `compat/scripts/`,
`compat/coverage-matrix.md`, and `.github/workflows/library-compat.yml`. See
`compat/README.md` for methodology. For quick manual "swap the base URL"
instructions per language, see `docs/libraries.md`.

## Git Workflow

- Branches: [Conventional Branch](https://conventional-branch.github.io) (`feat/`, `fix/`, …).
- Commits: [Conventional Commits](https://www.conventionalcommits.org/), `<description>` in Japanese.
- Push via **SSH** only.
- `pnpm lint` and `pnpm test` must pass before opening a PR.

## References

- @docs/getting-started.md — Quick start, environment variables, basic usage
- @docs/test-api.md — `/_test/*` and `/_mock/*` control APIs
- @docs/libraries.md — Connecting discord.js / discord.py / Discord.Net / discordgo and others
- @seed.example.json — SEED_FILE format sample
