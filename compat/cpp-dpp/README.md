# D++ / DPP (github.com/brainboxdotcc/DPP) — `⛔blocked`

No verifier is scaffolded here. This file records the research and evidence
for why DPP cannot be pointed at Fauxcord, mirroring the rigor of the
`js-eris/verify.mjs` header comment and `jvm-jda/README.md` for their
`⛔blocked` verdicts.

## Summary

DPP is blocked from targeting Fauxcord because its REST transport has no
public, documented, runtime way to redirect requests to a different host,
scheme, or port. Every `dpp::cluster` REST call (`message_create`,
`channel_get`, `guild_get`, etc.) is dispatched through DPP's internal
`request_queue` / `https_client` machinery, which is built to always speak
TLS to Discord's production API host. Unlike JDA (`RestConfig#setBaseUrl`),
Discord.Net (`DefaultRestClientProvider.Instance(url)`), discordgo
(`EndpointAPI` package variable), or serenity (`HttpBuilder::proxy(url)`),
DPP exposes no `cluster`-level constructor argument, setter, or
`request_queue`-level API to substitute a different API base URL. This
places DPP in the same category as Eris (`compat/js-eris/verify.mjs`): a
compile-time/hardcoded host with no supported override point, rather than a
Gateway-dependency blocker like JDA.

## What was checked

1. **`dpp::cluster` constructor surface.** The public constructor is
   `cluster(const std::string &token, uint32_t intents = i_default_intents,
   uint32_t shards = 0, uint32_t cluster_id = 0, uint32_t maxclusters = 1,
   bool compressed = true, cache_policy_t policy = cache_policy::cpol_default,
   uint32_t request_threads = 12, uint32_t request_threads_raw = 1)`. There is
   no host/base-URL/scheme parameter anywhere in this signature, and no
   overload that accepts one.
2. **REST dispatch path.** REST calls such as `cluster.message_create(...)`,
   `cluster.channel_get(...)`, `cluster.guild_get(...)` all funnel through
   DPP's internal `request_queue`, which schedules work onto a pool of
   `https_client` workers. The `https_client` construction for REST traffic
   targets Discord's production API host directly — there is no `cluster`
   member function (`set_*`), constructor argument, or `request_queue`
   accessor in DPP's public headers that accepts a replacement host, port, or
   scheme for this path. This mirrors the Eris finding almost exactly: a
   hardcoded destination baked into the low-level HTTP client construction,
   not a value threaded through from user-facing configuration.
3. **TLS is not optional for the REST path.** DPP's `https_client` is built
   on top of its own TLS-capable socket client (the same family used for the
   Gateway's `wss://` connection), and REST requests are issued as HTTPS,
   not plain HTTP. Fauxcord serves plain HTTP only (see
   `docs/getting-started.md`), so even if a host override existed, DPP would
   still need to be convinced to speak cleartext HTTP to that host — a
   second, independent obstacle on top of the missing host override, in the
   same combination Eris has (hardcoded host *and* hardcoded HTTPS/443).
4. **No environment-variable or compile-define override.** DPP does not
   document (in its Doxygen reference or the `include/dpp/*.h` public
   headers) any `DPP_API_URL`-style compile definition or environment
   variable that repoints the REST host. This differs from, e.g., libraries
   that read an override from an env var at process start; DPP has no such
   mechanism. The only way to change the compiled-in host would be to patch
   DPP's own source and rebuild the library from scratch, which the task
   brief explicitly treats as impractical for this harness's fast-iteration
   goal (and which would not reflect how any real consumer integrates with
   DPP's public, documented API).

## Secondary consideration: `cluster.start()` and REST-only usage

Independent of the base-URL question, it's worth noting that DPP's REST
methods are asynchronous (`std::function<void(const dpp::confirmation_callback_t&)>`
callbacks) and are, in principle, usable without calling `cluster.start()`
(which is what opens the Gateway WebSocket) — DPP's request queue worker
threads are independent of the Gateway shard threads `start()` spins up. This
detail does **not** change the verdict: the missing host/scheme override
(items 1–4 above) is a hard blocker on its own, so whether or not
`cluster.start()` is required is moot for reaching Fauxcord in the first
place. It's recorded here only to make clear that, unlike JDA, DPP's block
is a REST-transport limitation, not a Gateway-handshake dependency.

## Verdict

DPP is recorded as **`⛔blocked`** for all 86 canonical endpoints in
`compat/common/endpoints.json`, for the reason above (hardcoded REST host
and hardcoded HTTPS transport, with no public runtime override). No
`Dockerfile`, build config, or verifier script is provided, and no
`verify-dpp` service is registered in `compat/compose.yaml`, since
there is no code path (using DPP's public, documented API) that reaches a
runnable state against Fauxcord to justify a build step. Recompiling DPP
from a patched fork for every verification run is excluded per the task's
fast-iteration constraint, and would not reflect how any real consumer of
DPP integrates with a REST target.

## Confidence notes

- **Medium-high confidence**: `dpp::cluster`'s public constructor takes no
  host/base-URL argument and there is no `set_*`/builder-style method on
  `cluster` for this purpose. This is based on training-data knowledge of
  DPP's public header surface (`include/dpp/cluster.h`), not verified by
  fetching the current source or building DPP in this environment — per the
  task constraints, no network/build commands (`cmake`, `g++`, `vcpkg`,
  `docker build`, etc.) were run.
- **Medium confidence**: the internal `request_queue`/`https_client` REST
  dispatch path hardcodes both the destination host and HTTPS transport,
  with no override surfaced through any public API. This is consistent with
  DPP's overall design (a single-binary, low-dependency library that talks
  directly to `discord.com` rather than exposing a pluggable HTTP transport),
  but the exact internal call chain was not re-confirmed against the current
  DPP source in this session.
- **Explicitly not claimed**: no `DPP_API_URL`-style compile define or
  environment-variable override was found in memory of DPP's documented
  configuration surface. Per the task's guidance to default toward
  `⛔blocked` unless there is strong, specific, runtime evidence of an
  override, and given the risk of fabricating a mechanism for a compiled
  systems library that would be very easy to get wrong, this write-up does
  not assert one exists.
