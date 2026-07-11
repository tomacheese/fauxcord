# Library Compatibility Harness

Drives every Fauxcord endpoint through the high-level API of each Discord library,
inside per-language Docker containers. See "Implementation status" below for the
task breakdown, and the sections that follow for the full methodology.

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

## Gateway verification

Each verifier that wraps a library with real Gateway client capability adds a
`gateway` field to its `results/<lib>.json` alongside the existing REST
`results` array:

```json
{
  "gateway": {
    "status": "pass",
    "steps": [
      { "step": "connect-identify-ready", "status": "pass", "note": "" },
      { "step": "dispatch-message-create", "status": "pass", "note": "" }
    ]
  }
}
```

`gateway.status` / each step's `status` ∈ `pass` | `n-a` | `blocked` |
`fauxcord-fix` | `lib-issue`.

The common flow every Gateway verifier follows:

1. `connect-identify-ready`: open a WebSocket connection via the library's
   high-level client, complete HELLO → IDENTIFY → READY, and confirm the
   library's own "ready" callback/event fires.
2. `dispatch-message-create`: after READY, send `POST
   /channels/{channel_id}/messages` via REST, then confirm the library's
   high-level "message create" callback/event fires with a matching message
   within a timeout.

REST-only clients with no Gateway capability (e.g. `@discordjs/rest`,
`DiscordRestClient`, `twilight-http` alone) are not expected to add a
`gateway` field at all — see `docs/superpowers/specs/2026-07-06-gateway-compat-verification-design.md`
for the full list of libraries and their Gateway-capable counterpart
(full `discord.js`, `DiscordSocketClient`, `twilight-gateway`).

Libraries with no Gateway client at all remain REST-only rows in this file
and are unaffected by this section.

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

**Why**: primarily isolation, not crash-recovery. This harness's builds
(images, layer cache, buildkit state) stay fully separate from anything
else running on the same host, instead of sharing the host's single
`default` builder/cache with unrelated Docker workloads.

(History: during this harness's development, a `default`-builder buildkit
crash — `frontend grpc server closed unexpectedly`, triggered by a verifier
double-launch — could not be recovered by tearing down and recreating the
builder, since `default` is a reserved name tied to the current Docker
context and cannot be removed or recreated. That specific double-launch
cause is now structurally prevented by the `flock` in
`scripts/run-verify.sh`'s header comment, so this is no longer the main
argument for avoiding `default` — but the host-isolation benefit below
still holds independently of that history.)

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

This harness spans 6 languages / 21 libraries. Of these, 16 have a scaffolded
verifier under `compat/` with a populated `results/<lib>.json`, and the other
5 are technical blockers with no runnable code path at all (see below) and are
not scaffolded (16 + 5 = 21). Counting by outcome rather than by scaffolding,
6 libraries are blocked overall — the 5 unscaffolded blockers plus `js-eris`,
which is scaffolded and empirically confirms `baseUrlOverridable: false` (see
"Known run limitations" below) — which is why the blocked-library table below
has 6 rows. Any endpoint/library left un-run in this environment is recorded
in "Known run limitations" below.

### Known run limitations

Full evidence for every row lives in each library's own file (linked below);
this section only summarizes *why*.

#### Blocked — no runnable path against Fauxcord (`⛔blocked` for every endpoint)

| Library | Reason | Evidence |
|---|---|---|
| `js-eris` | Hardcodes HTTPS on port 443, no scheme/port override | `js-eris/verify.mjs` header |
| `cpp-dpp` | Internal transport hardcodes host + HTTPS, no override hook | `cpp-dpp/README.md` |
| `dotnet-dsharpplus` (5.x) | Base URL is a compile-time `const string`, which alone is sufficient to block it regardless of Gateway support | `dotnet-dsharpplus/README.md` |
| `dotnet-dsharpplus` (4.x) | Same `const string` base-URL mechanism as 5.x | entry in `coverage-matrix.md`; a dedicated README is tracked as follow-up work |
| `jvm-javacord` | Hardcoded HTTPS domain, no runtime override — this alone is sufficient to block it regardless of Gateway support | `jvm-javacord/README.md` |
| `cpp-sleepy` | Base URL is a hardcoded string literal, no override | `cpp-sleepy/README.md` |

`jvm-jda` was re-evaluated under Issue #106 once Fauxcord's Gateway
(Issue #102) landed — its base URL was always overridable, and the Gateway
WebSocket requirement was the only remaining blocker, so it is now
`✅ verified` (see `jvm-jda/README.md`). `jvm-javacord` and
`dotnet-dsharpplus` were also re-evaluated but remain blocked: both have a
second, independent blocker (a hardcoded/compile-time-constant base URL)
that the Gateway implementation does not affect.

`js-eris` is the one exception among the remaining blockers with a real,
runnable verifier (`js-eris/verify.mjs`, `verify-eris` compose service,
`results/eris.json`) — it actually starts and empirically confirms
`baseUrlOverridable: false` against Fauxcord rather than being blocked on
inspection alone. The other rows have no Dockerfile/verifier/compose
service at all — there is no runnable code path against Fauxcord using
their public API to even attempt.

#### Verified, with caveats

| Library | Base URL override | Caveat |
|---|---|---|
| `js-oceanic` | fully overridable | few `N/A` rows (no high-level wrapper for those endpoints) |
| `rust-serenity` | `HttpBuilder::proxy(url)` | written without a `cargo build` in the loop — low-frequency method signatures unverified, see caveat block in `main.rs` |
| `rust-twilight` | `ClientBuilder::proxy(host, use_http)` | same as serenity: no `cargo build` in the loop, see caveat block in `main.rs` |
| `python-nextcord` | `nextcord.http.Route.BASE` | pins/thread rows decided by analogy with discord.py, not inspected directly |
| `python-pycord` | `discord.http.Route.BASE` | same by-analogy caveat as nextcord; PyPI name (`py-cord`) differs from its import name (`discord`), so `requirements.txt` is kept single-library to avoid an unpredictable import resolution |
| `python-interactions` | `interactions.api.http.route.Route.BASE` | source-verified against the `5.16.0` tag, no by-analogy guesses |
| `jvm-discord4j` | custom `RouterOptions.discordBaseUrl` | source-verified against `3.2.6` |
| `jvm-kord` | Ktor `HttpRequestPipeline.Before` interceptor | source-verified against `0.14.0` |
| `c-concord` | `struct discord_config.base_url` | source-verified against upstream headers/tests |

Recurring `N/A` categories across most of the above: the new-format pins API,
thread search, OAuth2 grant-flow endpoints (bot-only libraries lack these),
and destructive shared-resource deletes that would break later rows in the
same run. Exact per-row reasoning is in each verifier's own evidence notes
(`verify.*`).

`coverage-matrix.md` is the per-endpoint/per-library source of truth and is
fully populated; no `-` (not-yet-run) cells remain — see the matrix's own
header note.
