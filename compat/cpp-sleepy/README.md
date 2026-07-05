# Sleepy Discord (github.com/yourWaifu/sleepy-discord) — `⛔blocked`

No verifier is scaffolded here. This file records the research and evidence
for why Sleepy Discord cannot be pointed at Fauxcord, mirroring the rigor of
`cpp-dpp/README.md` and `jvm-jda/README.md`.

## Summary

Sleepy Discord is blocked because its REST base URL is a hardcoded string
literal built inline in the request path, with no parameter, member, config,
or compile-define to override it — the Eris-class / DPP-class blocker
(hardcoded host *and* hardcoded HTTPS). Unlike JDA, this is **not** a Gateway
dependency: Sleepy Discord's synchronous REST methods are usable without
connecting a websocket; the block is purely the un-overridable base URL.

## Evidence: the REST base URL is a hardcoded literal

In `sleepy_discord/client.cpp`, `BaseDiscordClient::request(...)` — the single
function through which every REST call is dispatched — builds the URL as:

```cpp
session.setUrl("https://discord.com/api/v10/" + path.url());
```

The `"https://discord.com/api/v10/"` prefix is a string literal baked directly
into the request method. There is no override surface anywhere in Sleepy
Discord's public API:

- no `BaseDiscordClient` constructor argument for a host/base/scheme,
- no setter or member field that feeds this prefix,
- no environment variable or compile-time `#define` documented in the public
  headers (`include/sleepy_discord/*.h`) that repoints it.

The scheme is likewise the literal `https://`, while Fauxcord serves plain
HTTP only (`docs/getting-started.md`) — so, exactly as with Eris
(`js-eris/verify.mjs`) and DPP (`cpp-dpp/README.md`), there are two
independent obstacles (hardcoded host *and* hardcoded HTTPS) with no public
runtime override. The only way to change it would be to patch Sleepy
Discord's source and rebuild, which the task brief excludes as impractical for
this harness and which would not reflect how any real consumer integrates with
the library's public API.

## Verdict

Sleepy Discord is recorded as **`⛔blocked`** for all canonical endpoints in
`compat/common/endpoints.json`. No Dockerfile, build config, or verifier
script is provided, and no `verify-sleepy` service is registered in
`compat/compose.yaml`, since there is no code path (using Sleepy
Discord's public, documented API) that reaches a runnable state against
Fauxcord.

## Confidence notes

- **High confidence**: `BaseDiscordClient::request` in `sleepy_discord/client.cpp`
  hardcodes `session.setUrl("https://discord.com/api/v10/" + path.url())`
  (read directly from current upstream source in this session).
- **Medium-high confidence**: no public override (constructor arg, setter,
  env var, or compile define) exists for that prefix. Based on inspecting the
  request dispatch path and the absence of any base-URL configuration surface
  in the public headers; not verified by building/running Sleepy Discord in
  this environment (no build commands were run, per task constraints).
