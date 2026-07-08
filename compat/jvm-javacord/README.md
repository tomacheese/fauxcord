# Javacord (org.javacord:javacord) — `⛔blocked`

No verifier is scaffolded here. This file records the research and evidence
for why Javacord cannot be pointed at Fauxcord, mirroring the rigor of the
`jvm-jda/README.md` and `cpp-dpp/README.md` `⛔blocked` write-ups.

## Summary

Javacord is blocked from targeting Fauxcord for **two independent reasons**,
either of which alone is sufficient:

1. Its REST base URL is a hardcoded `https://discord.com` string built from a
   `public static final` (i.e. compile-time-constant) domain field, with no
   runtime, config, or constructor override — the Eris-class blocker.
2. Javacord has no supported REST-only mode: a usable `DiscordApi` is only
   obtainable through `DiscordApiBuilder.login()`, which opens the Gateway
   WebSocket, and Fauxcord implements no Gateway — the JDA-class blocker.

## Evidence 1: the REST base URL is hardcoded and non-overridable

Javacord builds every REST URL in `RestEndpoint.getFullUrl(...)`
(`javacord-core/src/main/java/org/javacord/core/util/rest/RestEndpoint.java`):

```java
return "https://" + Javacord.DISCORD_DOMAIN + "/api/v"
        + Javacord.DISCORD_API_VERSION + getEndpointUrl();
```

Both `DISCORD_DOMAIN` and `DISCORD_API_VERSION` are declared in
`javacord-api/src/main/java/org/javacord/api/Javacord.java` as
`public static final String`:

```java
public static final String DISCORD_DOMAIN = "discord.com";
```

Because `DISCORD_DOMAIN` is `final`, it cannot be reassigned at runtime, and
the scheme (`https://`) is a literal inside `getFullUrl`. There is no
`DiscordApiBuilder` setter, `RestEndpoint` parameter, environment variable, or
system property that repoints REST traffic — unlike JDA
(`RestConfig#setBaseUrl`), Discord.Net (`DefaultRestClientProvider.Instance`),
discordgo (`EndpointAPI`), serenity (`HttpBuilder::proxy`), or Concord
(`discord_config.base_url`). This is the same category of blocker as Eris
(hardcoded host *and* hardcoded HTTPS/443 — see `js-eris/verify.mjs`): Fauxcord
serves plain HTTP only, so even a host override would still leave the hardcoded
`https://`.

## Evidence 2: no REST-only mode (Gateway handshake required)

Javacord's public entry point to any high-level REST call (channels, messages,
guilds, webhooks, …) is a `DiscordApi` instance, and the only supported way to
obtain one is `new DiscordApiBuilder().setToken(token).login()`. `login()`
performs the identify/connect sequence over the Gateway WebSocket before the
returned `DiscordApi` becomes usable; Javacord exposes no documented
"REST-only, skip the Gateway" builder. Fauxcord's `GET /gateway` /
`GET /gateway/bot` return dummy `ws(s)://` URLs with no WebSocket server behind
them (`docs/getting-started.md`: "What it cannot do: WebSocket (Gateway /
real-time notifications)"), so `login()` can never complete — the same
mechanism that blocks JDA (`jvm-jda/README.md`).

## Verdict

Javacord is recorded as **`⛔blocked`** for all canonical endpoints in
`compat/common/endpoints.json`. No Dockerfile, build config, or verifier
script is provided, and no `verify-javacord` service is registered in
`compat/compose.yaml`, since there is no code path (using Javacord's
public, documented API) that reaches a runnable state against Fauxcord.

## Confidence notes

- **High confidence**: `RestEndpoint.getFullUrl` hardcodes `https://` +
  `Javacord.DISCORD_DOMAIN` (`final`) + `/api/v` + `DISCORD_API_VERSION`
  (read directly from current upstream source in this session).
- **Medium-high confidence**: there is no supported way to obtain a usable
  `DiscordApi` without `DiscordApiBuilder.login()` opening the Gateway. This
  follows Javacord's documented, Gateway-first architecture and the absence of
  any REST-only builder option; it was not verified by compiling/running
  Javacord in this environment (no build commands were run, per task
  constraints).

## Gateway実装後の再評価（Issue #106）

Fauxcordの Gateway実装後（#102/#107）に再確認したが、Javacordの
`⛔blocked` 判定は独立した2つの理由（REST base URLのハードコード、
Gateway接続必須のログイン）のうち、Gatewayとは無関係な (1) が引き続き
解消しないため、`⛔blocked` 判定を維持する。

現行の Javacord `master` ブランチ上流ソース（`javacord-api/src/main/java/
org/javacord/api/Javacord.java`、`javacord-core/src/main/java/org/javacord/
core/util/rest/RestEndpoint.java`）を直接取得し再確認した結果:

- `DISCORD_DOMAIN` は現在も `public static final String` のまま（`Evidence
  1` に記載の内容から変化なし）。ランタイムで上書きする手段は追加されて
  いない。
- `DiscordApiBuilder.login()` が現在も唯一のエントリポイントであり、
  REST-only モードは追加されていない。

Fauxcordの Gateway実装によって理由 (2) は理論上解消され得るが、理由 (1)
は Gateway とは独立した別のブロッカーであるため、いずれか一方が残る限り
`⛔blocked` の結論は変わらない。
