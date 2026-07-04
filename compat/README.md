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
- Verifiers for the remaining languages/libraries in the plan (Python:
  discord.py, Nextcord, Pycord, hikari, interactions.py; Go: discordgo; .NET:
  Discord.Net, DSharpPlus 5.x; JVM: JDA, Discord4J, Javacord, Kord; Rust:
  Serenity, Twilight; C/C++: Concord, DPP, Sleepy Discord; plus the
  DSharpPlus 4.x doc-only blocker entry) have not been scaffolded yet and are
  tracked as follow-up work per the plan's task breakdown.
- `coverage-matrix.md` (the per-endpoint/per-library source-of-truth table)
  has not been created yet; it should be populated from `results/*.json`
  once more verifiers are complete.
