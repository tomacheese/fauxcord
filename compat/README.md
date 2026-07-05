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

Full evidence for every row lives in each library's own file (linked below);
this section only summarizes *why*.

#### Blocked — no runnable path against Fauxcord (`⛔blocked` for every endpoint)

| Library | Reason | Evidence |
|---|---|---|
| `js-eris` | Hardcodes HTTPS on port 443, no scheme/port override | `js-eris/verify.mjs` header |
| `jvm-jda` | Base URL *is* overridable, but login requires a real Gateway WebSocket handshake, which Fauxcord doesn't implement | `jvm-jda/README.md` |
| `cpp-dpp` | Internal transport hardcodes host + HTTPS, no override hook | `cpp-dpp/README.md` |
| `dotnet-dsharpplus` (5.x) | Base URL is a compile-time `const string`; also requires a Gateway connection | `dotnet-dsharpplus/README.md` |
| `dotnet-dsharpplus` (4.x) | Same `const string` base-URL mechanism as 5.x | entry in `coverage-matrix.md`; a dedicated README is tracked as follow-up work |
| `jvm-javacord` | Hardcoded HTTPS domain; login requires a Gateway WebSocket | `jvm-javacord/README.md` |
| `cpp-sleepy` | Base URL is a hardcoded string literal, no override | `cpp-sleepy/README.md` |

None of these have a Dockerfile/verifier/compose service — there is no
runnable code path against Fauxcord using their public API.

#### Verified, with caveats

| Library | Base URL override | Caveat |
|---|---|---|
| `js-oceanic` | fully overridable | few `n-a` rows (no high-level wrapper for those endpoints) |
| `rust-serenity` | `HttpBuilder::proxy(url)` | written without a `cargo build` in the loop — low-frequency method signatures unverified, see caveat block in `main.rs` |
| `rust-twilight` | `ClientBuilder::proxy(host, use_http)` | same as serenity: no `cargo build` in the loop, see caveat block in `main.rs` |
| `python-nextcord` | `nextcord.http.Route.BASE` | pins/thread rows decided by analogy with discord.py, not inspected directly |
| `python-pycord` | `discord.http.Route.BASE` | same by-analogy caveat as nextcord; PyPI name (`py-cord`) differs from its import name (`discord`), so `requirements.txt` is kept single-library to avoid an unpredictable import resolution |
| `python-interactions` | `interactions.api.http.route.Route.BASE` | source-verified against the `5.16.0` tag, no by-analogy guesses |
| `jvm-discord4j` | custom `RouterOptions.discordBaseUrl` | source-verified against `3.2.6` |
| `jvm-kord` | Ktor `HttpRequestPipeline.Before` interceptor | source-verified against `0.14.0` |
| `c-concord` | `struct discord_config.base_url` | source-verified against upstream headers/tests |

Recurring `n-a` categories across most of the above: the new-format pins API,
thread search, OAuth2 grant-flow endpoints (bot-only libraries lack these),
and destructive shared-resource deletes that would break later rows in the
same run. Exact per-row reasoning is in each verifier's own evidence notes
(`verify.*`).

`coverage-matrix.md` is the per-endpoint/per-library source of truth and is
fully populated; the only `-` (not-yet-run) cells are the
`PATCH /guilds/{guild_id}/members/@me` row for discord.js/Oceanic/discordgo/
Concord, whose result files predate that endpoint's addition to
`common/endpoints.json` — see the matrix's own header note.
