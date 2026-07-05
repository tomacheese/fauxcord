# Library Compatibility Harness

Drives every Fauxcord endpoint through the high-level API of each Discord library,
inside per-language Docker containers. See the spec (Confluence "Spec - Issue #68")
for the full methodology, and the plan (Confluence "Plan - Issue #68") for the task
breakdown.

## Why Docker-only

Every library is verified inside its own language-specific Docker image. Installing
language runtimes directly on the host for verification is intentionally avoided so
that runs are reproducible and portable across CI and developer machines.

## Layout

- `compose.yaml` — starts the Fauxcord SUT (`fauxcord`) + one verifier per library.
- `common/setup.json` — fixed `/_test/setup` payload (bot/guild/channel snowflakes).
- `common/endpoints.json` — canonical endpoint list = the matrix rows (generated from
  `spec/manifest.ts` plus OAuth2 token endpoints and `DELETE /guilds/{guild_id}`).
- `<lang>-<lib>/` — self-contained verifier (Dockerfile + verify script + deps).
- `results/<lib>.json` — machine-readable per-library output (gitignored).
- `coverage-matrix.md` — source of truth; one row per endpoint, one column per library.

## Result JSON schema

Each verifier writes `results/<lib>.json`:

```json
{
  "library": "discord.js",
  "version": "2.x",
  "baseUrlOverridable": true,
  "results": [
    { "endpoint": "GET /channels/{channel_id}", "status": "pass", "http": 200, "note": "" }
  ]
}
```

`status` ∈ `pass` | `n-a` | `blocked` | `fauxcord-fix` | `lib-issue`.

## Run one verifier

```bash
docker compose -f compat/compose.yaml up --build \
  --abort-on-container-exit --exit-code-from verify-discordjs fauxcord verify-discordjs
cat compat/results/discordjs.json
```

## Run everything (heavy; needs network + time)

```bash
docker compose -f compat/compose.yaml up --build --abort-on-container-exit
```

## Buildx builder setup

All `docker compose build` invocations in this harness must target a
dedicated buildx builder, not the host's `default` one.

**Why**: `default` is a reserved name tied to the current Docker context —
it cannot be removed or recreated (`docker buildx rm default` and
`docker buildx create --name default` both fail). During this harness's
development, a `default`-builder buildkit crash (`frontend grpc server
closed unexpectedly`, triggered by a verifier double-launch — see
`scripts/run-verify.sh`'s header comment) could not be recovered by tearing
down and recreating the builder, since `default` itself is not a normal,
disposable buildx object. Relying on `default` for a harness that expects
to survive occasional buildkit crashes was a dead end.

**What we use instead**: a separate, disposable builder named
`fauxcord-compat`, using the `docker-container` driver (an isolated buildkit
instance running in its own container, unlike `default`'s driver which talks
to the Docker daemon's built-in builder):

```bash
# One-time setup (or after a crash — see "Recovering from a crash" below)
docker buildx create --name fauxcord-compat --driver docker-container
```

**How to select it**: set the `BUILDX_BUILDER` environment variable before
any `docker compose build`/`docker buildx` invocation, rather than running
`docker buildx use fauxcord-compat`. `docker buildx use` changes the
*global* current builder for the whole host (persisted in the buildx config,
outside this repo), which would silently affect any other, unrelated Docker
builds running on the same host. `BUILDX_BUILDER` only affects the
invocations that actually set it:

```bash
export BUILDX_BUILDER=fauxcord-compat
docker compose -f compat/compose.yaml build fauxcord verify-discordjs
```

`compat/scripts/run-library-check.sh` and `compat/scripts/run-verify.sh` do
not currently export `BUILDX_BUILDER` themselves — set it in the calling
shell/session before invoking them.

**Recovering from a crash**: if `fauxcord-compat` itself becomes unusable
(e.g. after a buildkit grpc crash), it — unlike `default` — is a disposable
object and can simply be removed and recreated:

```bash
docker buildx rm fauxcord-compat
docker buildx create --name fauxcord-compat --driver docker-container
```

**Verifying the builder is healthy**:

```bash
docker buildx ls                      # confirm fauxcord-compat is listed and its node is "running"
docker buildx inspect fauxcord-compat # detailed status (BuildKit version, platforms, etc.)
```

## Update the matrix

After a run, transcribe each `results/<lib>.json` entry into `coverage-matrix.md`
using the cell vocabulary (`✅` / `N/A` / `❌→fix` / `❌→lib` / `⛔blocked`).
Every `N/A` and `⛔blocked` cell needs an evidence note.

## Implementation status

This harness is being introduced in stages (the epic spans 6 languages / 20
libraries). Verifiers present under `compat/` are runnable; libraries not yet
scaffolded are tracked as follow-up per the plan. Any endpoint/library left
un-run in this environment is recorded in "Known run limitations" below.

### Known run limitations

- `js-eris`: Eris hardcodes HTTPS on port 443 with no scheme/port override
  (see `js-eris/verify.mjs` header comment for the source evidence). Recorded
  as `⛔blocked` for every endpoint rather than executed.
- `js-oceanic`: base URL is fully overridable and the verifier runs for real;
  a handful of endpoints are `n-a` (no high-level wrapper — new-format pins
  API, thread search, gateway info, bot-inapplicable guild/member/role/webhook
  deletes that would break later rows in the same run) with evidence notes in
  `verify.mjs` itself.
- `jvm-jda`: JDA's REST base URL *is* overridable (`RestConfig#setBaseUrl`,
  added in JDA 5.x), unlike Eris — but `JDABuilder.build()`'s login sequence
  requires completing a real Gateway WebSocket handshake before the `JDA`
  instance (and therefore any `RestAction`) becomes usable, and JDA has no
  supported REST-only/no-gateway build mode. Fauxcord's `GET /gateway` and
  `GET /gateway/bot` return dummy URLs with no WebSocket server behind them
  (see `docs/getting-started.md`: "What it cannot do: WebSocket (Gateway /
  real-time notifications)"), so that handshake can never succeed. Recorded
  as `⛔blocked` for every endpoint; see `jvm-jda/README.md` for the full
  evidence. No Dockerfile/build config/verifier script or `verify-jda`
  compose service is provided, since there is no runnable code path against
  Fauxcord using JDA's public API.
- `rust-serenity`: base URL is overridable via `HttpBuilder::proxy(url)`
  (a documented serenity feature for redirecting REST traffic, distinct from
  the scheme/host-only overrides other libraries expose) and the verifier is
  written to run for real; a handful of endpoints are `n-a` for the same
  categories of reasons as `js-oceanic`/`go-discordgo` (new-format pins API,
  thread search, gateway info — behind serenity's "gateway" feature which is
  intentionally excluded from this HTTP-only build — OAuth2 code-grant
  endpoints out of scope for a bot-focused client, and bot-inapplicable
  guild/member/role/webhook deletes that would break later rows in the same
  run). Unlike the other verifiers in this repo, this one was authored
  without a compiler in the loop: no network access was available to
  resolve the `serenity` crate and verify exact `Http` method signatures
  against the pinned `0.12` version, and `cargo build`/`cargo check` were
  intentionally not run in this environment. The `.proxy()` base-URL-override
  mechanism itself is asserted with high confidence (a well-known, documented
  serenity feature); exact parameter order/types for lower-frequency `Http`
  methods (thread management, permission overwrites, webhook-message CRUD)
  carry real uncertainty and may need adjustment on the first actual
  `cargo build` — see the caveat block at the top of
  `rust-serenity/src/main.rs`.
- `cpp-dpp`: DPP's `dpp::cluster` REST calls (`message_create`,
  `channel_get`, `guild_get`, etc.) are dispatched through an internal
  `request_queue`/`https_client` transport that hardcodes both the
  destination host and HTTPS/TLS, with no `cluster` constructor argument,
  setter, or `request_queue`-level API to redirect REST traffic elsewhere —
  unlike JDA/Discord.Net/discordgo/serenity, which all expose a documented
  base-URL/proxy override. This is the same category of blocker as
  `js-eris` (hardcoded transport, not a Gateway dependency); see
  `cpp-dpp/README.md` for the full evidence. Recorded as `⛔blocked` for
  every endpoint. No Dockerfile/build config/verifier script or `verify-dpp`
  compose service is provided, since there is no runnable code path against
  Fauxcord using DPP's public API, and recompiling DPP from a patched fork
  for every run would not be practical for this harness's fast-iteration
  goal.
- `python-nextcord`: base URL is assumed overridable via
  `nextcord.http.Route.BASE` (high confidence — a discord.py fork that kept
  REST plumbing close to upstream) and the verifier runs for real; the
  new-vs-legacy pins API choice and a couple of other rows (thread search,
  the explicit-`{user_id}` reaction-removal branch, gateway/OAuth2
  bootstrap-only calls) are decided by analogy with discord.py rather than
  by inspecting nextcord's actual source in this session — see the
  confidence-annotated evidence notes in `python-nextcord/verify.py` itself.
- `python-pycord`: same approach and same category of by-analogy
  assumptions as `python-nextcord` (base URL via `discord.http.Route.BASE`,
  pins-API migration assumed by analogy with discord.py) — see
  `python-pycord/verify.py` for the confidence-annotated evidence notes.
  Pycord's PyPI distribution name (`py-cord`) differs from its import name
  (`discord`, shared with discord.py itself), so `python-pycord/requirements.txt`
  is kept strictly single-library to avoid an unpredictable `import discord`
  resolution.
- `python-interactions`: base URL is overridable via
  `interactions.api.http.route.Route.BASE` (a shared `ClassVar[str]`,
  reassigned once at module scope) and the verifier runs for real against the
  library's gateway-free `HTTPClient` (imported directly from
  `interactions.api.http.http_client`, bypassing the gateway `Client`). Every
  method used was source-verified against the pinned `5.16.0` git tag, so
  there are no by-analogy guesses; a handful of rows are `n-a` (the
  new-format `/messages/pins*` API, the single-member thread-member GET,
  thread search, both OAuth2 grant-flow endpoints — the library has none —
  and the shared-resource-destroying DELETEs) with evidence notes in
  `python-interactions/verify.py`.
- `jvm-discord4j`: unlike JDA, Discord4J ships a genuine gateway-free
  `RestClient` (`.build()` opens no WebSocket), so it is runnable; the REST
  base URL is overridden by reconstructing a `RouterOptions` with a custom
  `discordBaseUrl` inside `RestClient.restBuilder(token).setExtraOptions(...)`
  (the 8-arg public constructor + public getters, all confirmed against the
  `3.2.6` source). Reactive calls are driven with `.block()`. `n-a` rows:
  threads (absent in 3.2.6's `ChannelService`), the new-format pins API,
  OAuth2 code-grant, and shared-resource deletes — see
  `jvm-discord4j/src/main/java/Verify.java`.
- `jvm-kord`: Kord's `kord-rest` module is a standalone gateway-free REST
  client, so it is runnable; its base URL (`Route.baseUrl`, a hardcoded
  getter) is redirected by passing a custom Ktor `HttpClient` to
  `KtorRequestHandler`'s primary constructor and installing a
  `HttpRequestPipeline.Before` interceptor that rewrites only
  protocol/host/port (the `/api/v10` path is already baked in by
  `takeFrom(request.baseUrl)`, so it is left untouched). All service method
  signatures were confirmed against the `0.14.0` source. `n-a` rows: new-format
  pins, single thread-member GET, thread search, gateway bootstrap, OAuth2, and
  shared-resource deletes — see `jvm-kord/src/main/kotlin/Verify.kt`.
- `rust-twilight`: base URL is overridable via twilight-http's documented
  `ClientBuilder::proxy(host, use_http)` (bare `host:port`, no scheme/path —
  twilight appends `/api/vN` itself) and the verifier runs for real. Method
  names/await-style (0.16 uses `IntoFuture`, no `.exec()`) were read from the
  `twilight-http-0.16.0` tag source rather than guessed; like `rust-serenity`,
  it was authored without a `cargo build` in the loop (see the CONFIDENCE
  CAVEAT block at the top of `rust-twilight/src/main.rs`). `n-a` rows:
  new-format pins, thread search, OAuth2 grant flow, and shared-resource
  deletes (twilight *does* wrap `GET /oauth2/@me` and `delete_guild`, unlike
  serenity — the former is exercised, the latter skipped as destructive).
- `c-concord`: base URL is runtime-overridable via
  `struct discord_config.base_url` (an upstream-unit-tested override:
  `test/unit-base-url.c`), and Concord's synchronous REST calls work
  gateway-free (no `discord_run`), so the verifier runs for real. The
  Dockerfile builds Concord — and a websockets-enabled libcurl — from source
  per Concord's own CI recipe. Function signatures and the blocking
  `.sync`/`struct ccord_szbuf` call idioms were confirmed against upstream
  headers/tests. `n-a` rows: new-format pins, single thread-member GET,
  thread search, OAuth2 grant flow, and shared-resource deletes — see
  `c-concord/verify.c`.
- `dotnet-dsharpplus` (5.x): `⛔blocked`. Its REST base URL is a C#
  `const string` (`Endpoints.BASE_URI`), compile-time-inlined and
  non-overridable at runtime — the same mechanism as DSharpPlus 4.x — and its
  high-level API requires a Gateway connection with no supported REST-only
  mode. No verifier/compose service is provided; see
  `dotnet-dsharpplus/README.md`.
- `jvm-javacord`: `⛔blocked`. Its REST base URL is built inline from a
  `public static final` (compile-time-constant) domain field over hardcoded
  `https://`, with no runtime override, *and* a usable `DiscordApi` is only
  obtainable via `DiscordApiBuilder.login()`, which requires a Gateway
  WebSocket Fauxcord does not implement — either obstacle alone is fatal. No
  verifier/compose service is provided; see `jvm-javacord/README.md`.
- `cpp-sleepy` (Sleepy Discord): `⛔blocked`. Its REST base URL is a hardcoded
  `"https://discord.com/api/v10/"` string literal inside the single request
  dispatch method, with no constructor/setter/env/compile-define override
  (hardcoded host *and* HTTPS, like Eris/DPP). No verifier/compose service is
  provided; see `cpp-sleepy/README.md`.
- The DSharpPlus 4.x doc-only blocker entry is tracked as follow-up work per
  the plan's task breakdown.
- `coverage-matrix.md` (the per-endpoint/per-library source-of-truth table)
  exists and is kept up to date as verifiers complete; several rows remain
  `-` pending outstanding Docker runs (see the matrix's own evidence notes
  for the current per-library breakdown).
