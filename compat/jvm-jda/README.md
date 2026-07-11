# JDA (net.dv8tion:JDA) — `✅ verified`

A working verifier is scaffolded here (`Dockerfile`, `build.gradle.kts`,
`src/main/java/Verify.java`), run via the `verify-jda` service in
`compat/compose.yaml`. Latest run: **62 ✅ / 23 N/A / 2 ❌→lib** out of 87
canonical endpoints, plus a passing Gateway check (see below). Results are
written to `compat/results/jda.json`.

## History: why this was previously blocked

JDA was originally recorded as `⛔blocked` because `JDABuilder.build()`'s
login sequence opens a real Gateway WebSocket, and Fauxcord did not implement
the Gateway at the time. That blocker was resolved by the Gateway (WebSocket)
implementation landing in Fauxcord (Issue #102 / PR #107); this Issue (#106)
re-verified JDA against the now-available Gateway and unblocked it.

The REST-layer base URL was never the issue — JDA 5.x+'s
`net.dv8tion.jda.api.requests.RestConfig#setBaseUrl(String)`, passed via
`JDABuilder#setRestConfig(RestConfig)`, is documented for exactly this kind
of mocked-backend use case.

## Connecting

```java
RestConfig restConfig = new RestConfig().setBaseUrl(fauxcordBaseUrl);
JDA jda = JDABuilder.createLight(token)
    .setRestConfig(restConfig)
    .setSessionController(new SessionControllerAdapter())
    .build();
jda.awaitReady();
```

`awaitReady()` blocks until the Gateway session reaches `READY` — this now
completes successfully against Fauxcord's Gateway implementation.

## Gateway verification

The verifier drives JDA through Identify → Ready, then exercises a
Dispatch-event round trip (send a message via REST, assert it arrives via
`MessageReceivedEvent`). Both steps currently `pass`:

```json
{
  "status": "pass",
  "steps": [
    { "step": "connect-identify-ready", "status": "pass", "note": "" },
    { "step": "dispatch-message-create", "status": "pass", "note": "" }
  ]
}
```

### Fauxcord bugs found and fixed during this verification

Getting `dispatch-message-create` to pass required fixing two independent
Fauxcord Gateway dispatch gaps (real Discord always sends both of these on
guild-channel `MESSAGE_CREATE`/`MESSAGE_UPDATE`, but Fauxcord omitted them):

1. **Missing `guild_id`** — added in `src/gateway/subscribe.ts` /
   `src/services/messages.ts`.
2. **Missing `member` (the author's guild member object)** — JDA's
   `EntityBuilder` requires this to construct the message author's `Member`;
   its absence caused a silent internal failure (no exception, no log line)
   that only manifested as the listener's `CompletableFuture` timing out.
   Added a `member` field to `GatewayBusEvents['message.create'/'message.update']`
   in `src/gateway/bus.ts`, resolved via a new `dispatchMemberFor()` helper in
   `src/services/messages.ts`, and spread into the dispatch payload in
   `src/gateway/subscribe.ts`.

Two further Gateway-adjacent gaps were also found and fixed while getting JDA
past `READY`/`GUILD_CREATE` handling (not JDA-specific — these are general
Discord spec conformance gaps that also affect other Gateway-consuming
libraries):

3. **`GUILD_CREATE` was missing Gateway-only "extra fields"**
   (`member_count`, `large`, `joined_at`, `channels`, `members`, etc.) — JDA's
   entity builders require these to parse the event at all. Fixed via
   `buildGuildCreatePayload()` in `src/services/guilds.ts`.
4. **`READY`'s `guilds` list was always `[]`** instead of the real spec's
   `{id, unavailable: true}` stub list. JDA's `GuildSetupController` uses
   this stub list to know how many `GUILD_CREATE` dispatches to wait for
   before considering the session ready; an empty list made JDA think there
   was nothing to wait for. Fixed in `src/gateway/server.ts`.

## Remaining `❌→lib` findings (JDA-side, not fixed in Fauxcord)

| Endpoint | Symptom | Assessment |
|---|---|---|
| `GET /guilds/{guild_id}/bans/{user_id}` | `ErrorResponseException: 10026: Unknown Ban` | JDA-side error-response handling; several other libraries (Discord4J, Kord, Concord) show the same `❌→lib` pattern on this row while the majority (discord.py, hikari, Discord.Net, Serenity, ...) pass — consistent with a library-side quirk, not a Fauxcord bug. |
| `DELETE /channels/{channel_id}/messages/pins/{message_id}` | `ErrorResponseException: 10008: Unknown Message` | JDA is the only non-blocked library that attempts the new pins API's unpin call in the verifier's test sequence (most others only cover the legacy `/pins/{message_id}` route, shown as `N/A` for this row); Fauxcord's own route returns 204 unconditionally, so this reflects the verifier's message-lifecycle ordering interacting with JDA's `Message#unpin()`, not a Fauxcord response defect. |

## Running the verifier

```bash
cd compat
docker compose build fauxcord verify-jda
docker compose up --abort-on-container-exit fauxcord verify-jda
cat results/jda.json
```

## Confidence notes

- **High confidence**: the Gateway result (`connect-identify-ready`,
  `dispatch-message-create`) — reproduced via a fresh Docker rebuild + run
  after the fixes above, independent of the raw `ws`-client diagnostic used
  during debugging.
- **High confidence**: the 62/23/2 REST breakdown — read directly from
  `compat/results/jda.json`, generated by the same Docker run.
