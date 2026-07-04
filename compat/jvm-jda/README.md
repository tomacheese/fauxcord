# JDA (net.dv8tion:JDA) — `⛔blocked`

No verifier is scaffolded here. This file records the research and evidence
for why JDA cannot be pointed at Fauxcord, mirroring the rigor of the
`js-eris/verify.mjs` header comment for that library's `⛔blocked` verdict.

## Summary

JDA is blocked from targeting Fauxcord — **not** because its REST base URL is
hardcoded (it is not: see below), but because JDA has no officially supported
way to obtain a usable `JDA` instance (and therefore no way to issue any
`RestAction`) without first completing a real Gateway WebSocket handshake.
Fauxcord explicitly does not implement the Gateway (see
`docs/getting-started.md`: "What it cannot do: WebSocket (Gateway / real-time
notifications)"), so that handshake can never succeed against it. This is a
hard blocker independent of any REST-layer configuration.

## What *is* confirmed to work: the REST base URL is overridable

JDA 5.x introduced `net.dv8tion.jda.api.requests.RestConfig`, which exposes
`RestConfig#setBaseUrl(String)`:

> "Provide a custom base URL for REST-api requests. This uses
> `DEFAULT_BASE_URL` by default. [...] It is not required for this URL to be
> HTTPS, because local proxies do not require signed connections."
> — [`RestConfig` javadoc](https://docs.jda.wiki/net/dv8tion/jda/api/requests/RestConfig.html)

This is passed to `JDABuilder` via `JDABuilder#setRestConfig(RestConfig)`, and
is explicitly documented as intended for "exotic proxies" and mocked
back-ends — i.e. exactly the Fauxcord use case. So, unlike Eris (hardcoded
HTTPS/443 with no scheme/port override — see `compat/js-eris/verify.mjs`),
JDA's REST layer alone is not the blocker.

## The actual blocker: JDA requires a real Gateway connection to become usable

1. **`JDABuilder.build()` performs a login sequence that includes opening the
   Gateway WebSocket**, not just a REST call. Community reports confirm that
   when the Gateway WebSocket handshake fails, `build()`/the login sequence
   surfaces the failure as an `ErrorResponseException` (e.g. wrapping a
   `SocketTimeoutException`) — see
   [discord-jda/JDA#2084](https://github.com/discord-jda/JDA/issues/2084) and
   the [JDA Wiki troubleshooting page](https://jda.wiki/using-jda/troubleshooting/).
   There is no supported "REST-only, skip the Gateway" build mode:
   `JDABuilder.createLight(token)` only trims caches/intents to reduce memory
   use, it does not skip the WebSocket connection.
2. **JDA's high-level API (`Guild`, `TextChannel`, `Message`, `Role`,
   `Webhook`, `.retrieveXxx()`/`.createXxx()`/`.editXxx()`/`.deleteXxx()`
   returning `RestAction<T>`) is only reachable through entity objects that
   are themselves populated via the Gateway/cache, or through `JDA` instance
   methods (e.g. `jda.retrieveUserById(id)`) that still require the `JDA`
   object to have completed login far enough to hold a valid REST requester
   bound to an established session. Neither path has a documented "just give
   me a `RestAction` executor without ever opening a websocket" entry point.
3. **Fauxcord's `GET /gateway` and `GET /gateway/bot` are dummy REST
   endpoints only** (see `src/services/gateway.ts`): they return a
   syntactically valid `ws://`/`wss://` URL derived from the base URL, but
   Fauxcord runs no actual WebSocket server behind it — the project's own
   docs state this is out of scope ("What it cannot do: WebSocket (Gateway /
   real-time notifications)", `docs/getting-started.md`). So the REST
   bootstrap call JDA makes before opening the socket will succeed and hand
   JDA a URL that then fails to establish a WebSocket connection, reproducing
   exactly the failure mode in evidence item 1 above.

Combining 1–3: even with `RestConfig#setBaseUrl` pointed at Fauxcord, calling
`JDABuilder.createLight(token).setRestConfig(cfg).build().awaitReady()` (the
idiomatic JDA startup) cannot complete, because `awaitReady()` waits for the
Gateway session to reach `READY`, which Fauxcord's non-existent WebSocket
server can never deliver. Any attempt to route around this via reflection
into JDA's internal `Requester`/`RestActionImpl` classes would not be using
JDA's public API and would not reflect how any real consumer of the library
integrates with a REST target — precision here matters more than forcing a
verifier to run, per the guidance for this task.

## Verdict

JDA is recorded as **`⛔blocked`** for all 86 canonical endpoints in
`compat/common/endpoints.json`, for the reason above (hard Gateway
dependency, not a REST base-URL limitation). No Dockerfile, build config, or
verifier script is provided, and no `verify-jda` service is registered in
`compat/docker-compose.yml`, since there is no code path (using JDA's public,
documented API) that reaches a runnable state against Fauxcord to justify a
build step.

## Confidence notes

- **High confidence**: `RestConfig#setBaseUrl` exists and does what is
  described (directly quoted from the current javadoc).
- **High confidence**: `JDABuilder.build()`'s login sequence includes opening
  the Gateway WebSocket, and failures there are visible as exceptions from
  `build()`/the login flow (corroborated by a real GitHub issue and the
  official troubleshooting wiki page).
- **Medium-high confidence**: there is no supported way to obtain a working
  `RestAction` executor from JDA's public API without going through that
  login/Gateway sequence at least far enough to hit the WebSocket step. This
  is based on JDA's documented architecture (Gateway-first, REST-plus-cache)
  and the absence of any documented REST-only builder option; it was not
  verified by compiling/running JDA itself in this environment (no network/
  build commands were run, per task constraints).
