# Fauxcord

A mock server that replicates the behavior of the Discord REST API v10.
Run integration tests for Discord bots and apps without connecting to the real service.

## Tech Stack

- **Runtime**: Node.js 24 + TypeScript (ES2024, NodeNext)
- **Framework**: Hono (`@hono/node-server`)
- **DB**: SQLite via `better-sqlite3` (WAL mode, foreign keys enabled)
- **Type definitions**: `discord-api-types` v10 (types only, no runtime usage)
- **Test**: Vitest
- **Lint**: ESLint (`@book000/eslint-config`) + Prettier
- **Package manager**: pnpm 11.2.2

## Essential Commands

```bash
pnpm dev              # Dev server (tsx watch, hot reload)
pnpm test             # Run tests (113 tests)
pnpm test:watch       # テスト watch モード
pnpm lint             # tsc + eslint + prettier (required before committing)
pnpm fix              # eslint --fix + prettier --write
pnpm build            # tsc -p tsconfig.build.json (excludes test files)
pnpm start            # node dist/index.js (production)
pnpm spec:fetch       # Download the latest upstream spec to spec/openapi.upstream.json
pnpm spec:diff        # Diff spec/openapi.json vs spec/openapi.upstream.json (exit 1 = diff)
pnpm spec:update      # Update the committed spec snapshot (spec/openapi.json) to upstream
```

## Architecture

```
src/
├── index.ts          # Entry point, Hono app setup, SEED_FILE loading
├── config.ts         # Environment variables (PORT, DB_PATH, DISABLE_AUTH, LATENCY_MS, etc.)
├── db.ts             # SQLite initialization, 15 table definitions
├── snowflake.ts      # Discord Snowflake ID generation (Discord Epoch: 1420070400000n)
├── errors.ts         # DiscordErrorCode constants & discordError / validationError helpers
├── middleware/       # auth, cors, latency, rate-limit, version
├── routes/           # Hono ルーターファクトリ（createXxxRoutes(db, baseUrl)）
├── services/         # DB operation logic (called from routes)
└── validators/       # Request validation (error format follows Discord spec)
```

**Data flow**: `index.ts` → middleware → `routes/` → `services/` → DB

**Route mounting**: Mount all three prefixes — `/api/v10/`, `/api/`, and `/` (see the `routePrefix` loop in `src/index.ts`). This includes Webhook routes.

## Code Conventions

- Every function and interface must have **jsdoc (in English)**
- In-code comments are written in English
- Error messages are in English (e.g. `"Unknown Channel"`)
- **Never change** `skipLibCheck: false`
- The `any` type is forbidden (enforced by ESLint)
- `.reverse()` → `.toReversed()`, `parseInt` → `Number.parseInt` (unicorn rules)

## Key Implementation Patterns

**Error responses** (strictly conforming to the Discord API spec):

```typescript
return c.json(
  discordError(DiscordErrorCode.UNKNOWN_CHANNEL, 'Unknown Channel', 404).body,
  404
)
```

**When adding a new endpoint**:

1. Add a DB operation function to `src/services/` (jsdoc required)
2. Add the route to the factory function in `src/routes/`
3. Add validation to `src/validators/` if needed
4. Add tests to `src/routes/xxx.test.ts` (TDD recommended)
5. **Add an entry to `spec/manifest.ts`** (the single source of truth for drift detection and contract tests)

**Watch out for route definition order**: Hono uses first-match wins. Define `/channels/:cid/messages/pins` (literal) **before** `/channels/:cid/messages/:mid` (parameterized).

## Testing

```bash
pnpm test                          # All tests (85)
pnpm test src/routes/channels      # Run specific file
pnpm test:watch                    # Watch mode (during development)
pnpm test:coverage                 # with coverage
```

### Approach (t_wada TDD)

Implement using the **Red → Green → Refactor** cycle.

1. **Red**: Write a failing test first
2. **Green**: Write the minimal implementation that makes the test pass
3. **Refactor**: Clean up while keeping the tests passing

### Test Types and Placement

| Type              | Location                  | Target                                   |
| ----------------- | ------------------------- | ---------------------------------------- |
| Unit tests        | `src/xxx.test.ts`         | Pure functions (snowflake, errors, etc.) |
| Route tests       | `src/routes/xxx.test.ts`  | Individual API endpoints                 |
| Integration tests | `src/integration.test.ts` | Scenarios combining multiple features    |

### How to Write Route Tests

```typescript
// Use createTestApp from src/test-helpers.ts with an in-memory DB
const { app, db } = createTestApp()
const bot = seedBot(db, 'Bot testtoken')
const guild = seedGuild(db, bot, 'TestGuild')
const channel = seedChannel(db, guild, 'general')

const res = await app.request('/api/v10/channels/' + channel.id, {
  headers: { Authorization: 'Bot testtoken' },
})
expect(res.status).toBe(200)
const body = (await res.json()) as Record<string, unknown>
expect(body.id).toBe(channel.id)
```

### Notes

- Uses an in-memory DB (`:memory:`) → tests are independent of each other (call `createTestApp()` in each test)
- WAL mode reports as `"memory"` on `:memory:` → `expect(["wal","memory"]).toContain(result)`
- In `createTestApp()`, which does not include the auth middleware, the `Authorization` header is matched directly against Bot records (see the fallback in `src/routes/channels.ts`)
- When adding a new endpoint, test at minimum the success case, 404, 401, and validation errors

## Library Compatibility Testing

How to point real Discord libraries at the mock server.
Each library has been confirmed to work by simply swapping the base URL.

### TypeScript / JavaScript — @discordjs/rest

```typescript
import { REST } from '@discordjs/rest'

const rest = new REST({
  version: '10',
  api: 'http://localhost:3000/api',
}).setToken('your-token')
// → requests go to http://localhost:3000/api/v10/...
```

### Python — discord.py 2.7+

```python
import discord.http as dhttp
dhttp.Route.BASE = "http://localhost:3000/api/v10"

client = discord.Client(intents=discord.Intents.default())
await client.login("your-token")
```

**Note**: discord.py 2.7+ uses `/channels/{id}/messages/pins/{mid}` for the pin API (not the old `/channels/{id}/pins/{mid}`). `?wait=True` is sent as `?wait=1`.

### C# — Discord.Net.Rest

```csharp
var config = new DiscordRestConfig {
    RestClientProvider = _ =>
        DefaultRestClientProvider.Instance("http://localhost:3000/api/v10/")
};
var client = new DiscordRestClient(config);
await client.LoginAsync(TokenType.Bot, "your-token");
```

**Note**: Discord.Net calls `GET /oauth2/applications/@me` at login (implemented).

### Go — discordgo

```go
discordgo.EndpointAPI = "http://localhost:3000/api/v10/"
// Override other endpoint variables as needed

session, _ := discordgo.New("Bot your-token")
```

### Test Environment Setup

Before library testing, register a Bot, Guild, and Channel via `/_test/setup`:

```bash
curl -X POST http://localhost:3000/_test/setup \
  -H "Content-Type: application/json" \
  -d '{
    "token": "Bot your-token",
    "user": {"id": "111111111111111111", "username": "TestBot"},
    "guilds": [{"id": "222222222222222222", "name": "Test Guild",
      "channels": [{"id": "333333333333333333", "name": "general", "type": 0}]}]
  }'
```

### Unsupported Libraries

- **DSharpPlus 4.x**: The base URL is a `const` and cannot be changed (5.x nightly not yet tested)

## Environment Variables

| Variable       | Default         | Description                                   |
| -------------- | --------------- | --------------------------------------------- |
| `PORT`         | `3000`          | Listen port                                   |
| `DB_PATH`      | `/data/mock.db` | SQLite file path                              |
| `DISABLE_AUTH` | `false`         | Set to `true` to bypass authentication        |
| `LATENCY_MS`   | `0`             | Artificial latency added to all API responses |
| `SEED_FILE`    | _(none)_        | JSON loaded automatically at startup          |

## Important Gotchas

- **Webhook routes must be inside the `routePrefix` loop** (to support `/api/v10/webhooks/...`)
- **Webhook execution `wait` parameter**: Both `"true"` and `"1"` are interpreted as truthy (discord.py sends `?wait=1`)
- **`GET /channels/:id/messages/pins`** (new API) returns the `{"items":[...],"has_more":false}` format. `GET /channels/:id/pins` (old API) returns a flat array
- **Numeric IDs in bulk-delete**: 19-digit Snowflakes lose precision in JS's JSON.parse, so they are extracted from the raw text with a regex (see `src/routes/channels.ts`)
- **`embeds: null`**: Sent by discordgo and others, so null is treated as an empty array
- **`/users/%40me`**: Supports percent-encoded `@` (see `src/routes/users.ts`)
- **Docker healthcheck**: Alpine's busybox wget resolves `localhost` to IPv6, so `127.0.0.1` is specified explicitly

## Discord API v10 Compatibility Notes

- **Snowflake ID**: Uses the Discord Epoch (1420070400000n)
- **Error codes**: Use `DiscordErrorCode` from `src/errors.ts`
- **Rate Limit headers**: `x-ratelimit-*` attached to all responses (dummy values)
- **`@everyone` role**: Auto-generated at Guild creation with ID = Guild ID (`src/services/test-control.ts`)
- **`/oauth2/applications/@me`**: Alias that Discord.Net calls at login (`src/routes/users.ts`)

## Spec Drift Tracking

Fauxcord tracks the official [Discord OpenAPI spec](https://github.com/discord/discord-api-spec)
to detect when the real API diverges from the mock.

### Key files

| File | Role |
| ---- | ---- |
| `spec/openapi.json` | Committed snapshot of the upstream spec (raw, byte-identical) |
| `spec/manifest.ts` | Single source of truth: maps every implemented endpoint to its spec path/method. Drives both drift detection and contract tests. |
| `spec/skip.ts` | Endpoints/assertions skipped due to confirmed spec-side bugs (reason required). |
| `scripts/spec-fetch.ts` | Downloads the latest upstream spec. |
| `scripts/spec-diff.ts` | Diffs snapshot vs upstream; emits Markdown, exits 1 when drift exists. |
| `src/spec-contract.test.ts` | Ajv-based contract tests against the committed snapshot. |
| `.github/workflows/spec-drift.yml` | Weekly cron + `workflow_dispatch`; opens a `spec-drift` issue on drift. |

### Snapshot update workflow

1. The weekly workflow detects drift and opens a `spec-drift` GitHub Issue.
2. Pull the latest master and create a branch.
3. Run `pnpm spec:update` to download the new snapshot.
4. Run `pnpm test` — contract tests in `src/spec-contract.test.ts` will fail for any mock responses that no longer match the spec.
5. Fix the mock (or add a justified entry to `spec/skip.ts`) until all tests pass.
6. Commit and open a PR.

### Skip list policy

Only add to `spec/skip.ts` when the spec itself is provably wrong (e.g., a field is declared `required` but the real Discord API never returns it). Always include a clear `reason`. Do **not** add entries simply because fixing the mock is inconvenient.

### Type drift detection

The services import types from `discord-api-types/v10` and declare compile-time
compatibility guards. When Renovate bumps `discord-api-types`, running
`pnpm lint:tsc` will fail if a field used by the mock is renamed or retyped upstream.

## Git Workflow

- Branches: [Conventional Branch](https://conventional-branch.github.io) (`feat/`, `fix/`, etc.)
- Commits: [Conventional Commits](https://www.conventionalcommits.org/), with `<description>` written in Japanese
- Push via **SSH** only
- `pnpm lint` and `pnpm test` must pass before creating a PR

## References

- @docs/getting-started.md — Quick start, environment variables, basic usage
- @docs/test-api.md — Details of the `/_test/*` / `/_mock/*` test control APIs
- @docs/libraries.md — How to connect discord.js / discord.py / Discord.Net / discordgo
- @seed.example.json — Sample of the SEED_FILE format
