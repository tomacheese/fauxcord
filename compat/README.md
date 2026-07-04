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

- `docker-compose.yml` — starts the Fauxcord SUT (`fauxcord`) + one verifier per library.
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
docker compose -f compat/docker-compose.yml up --build \
  --abort-on-container-exit --exit-code-from verify-discordjs fauxcord verify-discordjs
cat compat/results/discordjs.json
```

## Run everything (heavy; needs network + time)

```bash
docker compose -f compat/docker-compose.yml up --build --abort-on-container-exit
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
- Verifiers for the remaining languages/libraries in the plan (Python:
  hikari, interactions.py; Go: discordgo; .NET: Discord.Net, DSharpPlus
  5.x; JVM: Discord4J, Javacord, Kord; Rust: Twilight; C/C++: Concord,
  Sleepy Discord; plus the DSharpPlus 4.x doc-only blocker entry) have not
  been scaffolded yet and are tracked as follow-up work per the plan's task
  breakdown.
- `coverage-matrix.md` (the per-endpoint/per-library source-of-truth table)
  has not been created yet; it should be populated from `results/*.json`
  once more verifiers are complete.
