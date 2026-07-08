# DSharpPlus 5.x (nightly) — `⛔blocked`

No runnable verifier is scaffolded here. This file records the research and
evidence for why DSharpPlus 5.x cannot be pointed at Fauxcord, mirroring the
rigor of `jvm-jda/README.md` and `cpp-dpp/README.md`, and extending the
DSharpPlus 4.x doc-only blocker entry to the 5.x line.

## Summary

DSharpPlus 5.x is blocked for the **same fundamental reason as 4.x**, plus a
Gateway dependency:

1. Its REST base URL is a C# `const string` compiled directly into every
   caller — a compile-time constant that no runtime configuration can
   override.
2. Its high-level API requires a live Gateway connection
   (`DiscordClient.ConnectAsync()`); DSharpPlus ships no supported
   REST-only mode with a custom base URL.

## Evidence 1: the REST base URL is a compile-time `const`

`DSharpPlus/Net/Rest/Endpoints.cs` defines:

```csharp
public const string API_VERSION = "10";
public const string BASE_URI = "https://discord.com/api/v" + API_VERSION;
```

`BASE_URI` is `const`, which in C# is inlined into every referencing assembly
at compile time. There is no field, property, `DiscordConfiguration`/
`DiscordClientBuilder` option, environment variable, or DI hook that repoints
REST traffic at runtime. This is materially stronger (harder to override) than
even a `static readonly` field, and is the identical mechanism that makes
DSharpPlus 4.x a blocker (see the DSharpPlus 4.x entry in
`compat/coverage-matrix.md`): the only way to change it is to fork DSharpPlus
and recompile, which the task brief explicitly excludes as impractical for
this fast-iteration harness and which would not reflect how any real consumer
integrates with DSharpPlus's public API.

## Evidence 2: Gateway dependency (no REST-only mode)

DSharpPlus 5.x's usage model is `DiscordClientBuilder.CreateDefault(token,
intents).Build()` followed by `client.ConnectAsync()`, which opens the Gateway
WebSocket; the entity model (guilds, channels, messages) and its
`*Async` REST wrappers are reached through that connected client. There is no
documented REST-only client analogous to `Discord.Net.Rest`'s
`DiscordRestClient`. Fauxcord serves no WebSocket
(`docs/getting-started.md`: "What it cannot do: WebSocket (Gateway /
real-time notifications)"), so `ConnectAsync()` can never complete — the same
class of blocker as JDA (`jvm-jda/README.md`).

## Version note

DSharpPlus 5.x is distributed only as nightly/pre-release packages; no specific
5.x nightly version is pinned here because the blocker is structural (a `const`
base URL + Gateway dependency) and does not vary by nightly build. Naming a
fabricated "confident" nightly version string was deliberately avoided.

## Verdict

DSharpPlus 5.x is recorded as **`⛔blocked`** for all canonical endpoints in
`compat/common/endpoints.json`. No Dockerfile, build config, or verifier
script is provided, and no `verify-dsharpplus` service is registered in
`compat/compose.yaml`, since there is no code path (using DSharpPlus's
public, documented 5.x API) that reaches a runnable state against Fauxcord.
This mirrors how JDA and DPP are handled (evidence-only README, no fake
verifier).

## Confidence notes

- **High confidence**: `Endpoints.BASE_URI` is a `const string`
  `"https://discord.com/api/v10"` (read directly from current upstream source
  in this session), so it is compile-time-inlined and non-overridable at
  runtime.
- **Medium-high confidence**: DSharpPlus 5.x has no supported REST-only mode
  and requires a Gateway connection for its high-level API. This follows
  DSharpPlus's documented, Gateway-first architecture; it was not verified by
  building/running DSharpPlus in this environment (no build commands were run,
  per task constraints).

## Gateway実装後の再評価（Issue #106）

Fauxcordの Gateway実装後（#102/#107）に再確認したが、DSharpPlus 4.x/5.x
の `⛔blocked` 判定は独立した2つの理由（REST base URLの `const string`
コンパイル時定数、Gateway接続必須）のうち、Gatewayとは無関係な (1) が
引き続き解消しないため、`⛔blocked` 判定を維持する。

現行の DSharpPlus `master` ブランチ上流ソース（`DSharpPlus/Net/Rest/
Endpoints.cs`）を直接取得し再確認した結果:

```csharp
public const string API_VERSION = "10";
public const string BASE_URI = "https://discord.com/api/v" + API_VERSION;
```

`BASE_URI` は現在も `const string` のまま（`Evidence 1` に記載の内容から
変化なし）。C# の `const` はコンパイル時に呼び出し側アセンブリへインライン
展開されるため、ランタイムでの上書き手段は原理的に存在しない。この結論は
4.x/5.x 共通のメカニズムであり、両バージョンに等しく適用される。

Fauxcordの Gateway実装によって理由 (2) は理論上解消され得るが、理由 (1)
は Gateway とは独立した別のブロッカーであるため、いずれか一方が残る限り
`⛔blocked` の結論は変わらない。
