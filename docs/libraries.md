# Library Connection Guide

How to point each Discord library at Fauxcord.  
In most cases, **swapping the base URL is all it takes**.

---

## Prerequisites (common)

Whichever library you use, first register a Bot via `/_test/setup`.

```bash
curl -X POST http://localhost:3000/_test/setup \
  -H "Content-Type: application/json" \
  -d '{
    "token": "Bot your-token",
    "user": { "username": "TestBot" },
    "guilds": [{ "name": "Test Guild",
      "channels": [{ "name": "general", "type": 0 }] }]
  }'
```

Use the returned `id` values in your code.

---

## JavaScript / TypeScript — @discordjs/rest

Override the base URL with the `api` option of `new REST`.

```typescript
import { REST, Routes } from '@discordjs/rest'

const rest = new REST({
  version: '10',
  api: 'http://localhost:3000/api',
}).setToken('your-token')

// Call it just like the regular Discord API
const channel = await rest.get(Routes.channel('333333333333333333'))
const message = await rest.post(Routes.channelMessages('333333333333333333'), {
  body: { content: 'Hello from discord.js!' },
})
```

> With `api: "http://localhost:3000/api"`, actual requests go to  
> `http://localhost:3000/api/v10/...`.

**Supported versions**: `@discordjs/rest` 2.x and later

---

## Python — discord.py 2.x

Rewrite `Route.BASE`.

```python
import asyncio
import discord
import discord.http as dhttp

# Point at Fauxcord
dhttp.Route.BASE = "http://localhost:3000/api/v10"

async def main():
    client = discord.Client(intents=discord.Intents.default())
    await client.login("your-token")  # without the "Bot " prefix

    # Fetch a channel
    channel = await client.fetch_channel(333333333333333333)

    # Send a message
    msg = await channel.send("Hello from discord.py!")
    print(f"Sent: {msg.id}")

    # Pin it
    await msg.pin()

    # Create a Webhook
    wh = await channel.create_webhook(name="MyWebhook")
    await wh.send("Hello from webhook!", wait=True)

    await client.close()

asyncio.run(main())
```

**Version-specific notes**:

- **discord.py 2.7+** uses `/channels/{id}/messages/pins/{mid}` for the pin API  
  (the old `/channels/{id}/pins/{mid}` is also implemented, so both work)
- `webhook.send(wait=True)` is sent as `?wait=1` (Fauxcord supports both)

**Supported versions**: discord.py 2.x (verified with 2.7.1)

---

## C# — Discord.Net.Rest

Override the base URL via `RestClientProvider` in `DiscordRestConfig`.

```csharp
using Discord;
using Discord.Rest;

var config = new DiscordRestConfig
{
    RestClientProvider = _ =>
        DefaultRestClientProvider.Instance("http://localhost:3000/api/v10/")
};

var client = new DiscordRestClient(config);
await client.LoginAsync(TokenType.Bot, "your-token");

// Fetch a channel
var channel = (IRestMessageChannel)await client.GetChannelAsync(333333333333333333UL);

// Send a message
var msg = await channel.SendMessageAsync("Hello from Discord.Net!");

// Create a Webhook
var guildChannel = (IRestTextChannel)await client.GetChannelAsync(333333333333333333UL);
var webhook = await guildChannel.CreateWebhookAsync("MyWebhook");
```

**Notes**:

- Discord.Net calls `GET /oauth2/applications/@me` at login (Fauxcord supports this)
- Cast to `IRestTextChannel` before calling `CreateWebhookAsync`

**Supported versions**: Discord.Net 3.x (verified with 3.20.0)  
**Not supported**: DSharpPlus 4.x (its base URL is a constant and cannot be changed)

---

## Go — discordgo

Rewrite the endpoint via package variables.

```go
package main

import (
    "fmt"
    "github.com/bwmarrin/discordgo"
)

func main() {
    // Point at Fauxcord
    discordgo.EndpointAPI = "http://localhost:3000/api/v10/"

    s, err := discordgo.New("Bot your-token")
    if err != nil {
        panic(err)
    }

    // Fetch a channel
    ch, _ := s.Channel("333333333333333333")
    fmt.Println("Channel:", ch.Name)

    // Send a message
    msg, _ := s.ChannelMessageSend("333333333333333333", "Hello from discordgo!")
    fmt.Println("Message ID:", msg.ID)

    // Create a Webhook
    wh, _ := s.WebhookCreate("333333333333333333", "MyWebhook", "")
    s.WebhookExecute(wh.ID, wh.Token, true, &discordgo.WebhookParams{
        Content: "Hello from webhook!",
    })
}
```

**Notes**:

- `discordgo.ChannelMessageSend()` sends requests containing `embeds: null` (Fauxcord supports this)

**Supported versions**: verified with discordgo v0.29.0

---

## Comparison table

| Library          | Language | Configuration              | Status |
| ---------------- | -------- | -------------------------- | ------ |
| @discordjs/rest  | JS/TS    | `new REST({ api: "..." })` | ✅     |
| discord.py       | Python   | `Route.BASE = "..."`       | ✅     |
| Discord.Net.Rest | C#       | `RestClientProvider`       | ✅     |
| discordgo        | Go       | `EndpointAPI = "..."`      | ✅     |
| DSharpPlus 4.x   | C#       | ❌ Not possible (constant) | ❌     |

---

## Library compatibility matrix

Fauxcord tracks compatibility for 20+ Discord libraries across 6 languages using a
Docker-based verification harness under [`compat/`](../compat/README.md). Every
library is exercised against the full set of implemented endpoints inside its own
language-specific container, so results are reproducible and independent of the
host's installed toolchains.

The full per-endpoint, per-library breakdown lives in
[`compat/coverage-matrix.md`](../compat/coverage-matrix.md) (source of truth).
The summary below reflects the latest state of that matrix.

| Library                   | Language | Base URL override                                        | Status                                        |
| ------------------------- | -------- | -------------------------------------------------------- | --------------------------------------------- |
| @discordjs/rest           | JS/TS    | `new REST({ api: "..." })`                               | ✅ Verified, some raw findings pending triage |
| Eris                      | JS/TS    | ❌ Not possible (hardcodes HTTPS on port 443)            | ⛔ Blocked                                    |
| Oceanic.js                | JS/TS    | Fully overridable client option                          | ✅ Verified, some findings pending triage     |
| discord.py                | Python   | `Route.BASE = "..."`                                     | 🧪 Scaffolded, run pending                    |
| Nextcord                  | Python   | `nextcord.http.Route.BASE = "..."` (discord.py fork)     | 🧪 Scaffolded, run pending                    |
| Pycord                    | Python   | `discord.http.Route.BASE = "..."` (discord.py fork)      | 🧪 Scaffolded, run pending                    |
| hikari                    | Python   | `hikari.RESTApp(url=...)`                                | 🧪 Scaffolded, run pending                    |
| interactions.py           | Python   | `interactions.api.http.route.Route.BASE`                 | 🧪 Scaffolded, run pending                    |
| discordgo                 | Go       | `discordgo.EndpointAPI` + per-resource endpoint vars     | ✅ Verified (73/86 pass, 13 n/a, 0 lib-issue) |
| Discord.Net.Rest          | C#       | `RestClientProvider`                                     | ✅ Verified (62/86 pass, 24 n/a, 0 lib-issue) |
| DSharpPlus 5.x            | C#       | ❌ Not possible (compile-time `const string`)            | ⛔ Blocked                                    |
| DSharpPlus 4.x            | C#       | ❌ Not possible (compile-time `const string`)            | ⛔ Blocked                                    |
| JDA                       | JVM      | ❌ Not usable without a real Gateway WebSocket handshake | ⛔ Blocked                                    |
| Discord4J                 | JVM      | Custom `discordBaseUrl` via `RouterOptions`              | 🧪 Scaffolded, run pending                    |
| Javacord                  | JVM      | ❌ Not usable (hardcoded host + requires Gateway login)  | ⛔ Blocked                                    |
| Kord                      | JVM      | Ktor `HttpRequestPipeline.Before` interceptor            | 🧪 Scaffolded, run pending                    |
| Serenity                  | Rust     | `HttpBuilder::proxy(url)`                                | 🧪 Scaffolded, run pending                    |
| Twilight                  | Rust     | `ClientBuilder::proxy(host, use_http)`                   | 🧪 Scaffolded, run pending                    |
| DPP                       | C++      | ❌ Not possible (hardcoded transport, no override hook)  | ⛔ Blocked                                    |
| Concord                   | C        | `struct discord_config.base_url`                         | 🧪 Scaffolded, run pending                    |
| Sleepy Discord            | C++      | ❌ Not possible (hardcoded host + scheme literal)        | ⛔ Blocked                                    |

Legend: ✅ verified and working · 🧪 verifier code written, awaiting a Docker run ·
⛔ confirmed technical blocker (cannot point the library at Fauxcord at all).

### How verification runs

All library verification is Dockerized under `compat/` — no language runtime needs
to be installed on the host. The `.github/workflows/library-compat.yml` CI
workflow runs every scaffolded verifier as an independent, informational matrix
job (one library's failure does not block the others); it triggers on a weekly
schedule, `workflow_dispatch`, and on pull requests that touch `compat/**` or
`src/**`. See [`compat/README.md`](../compat/README.md) for how to run a single
verifier locally and how to update the coverage matrix after a run.

---

## Token formats

| Library         | At setup           | At login                                |
| --------------- | ------------------ | --------------------------------------- |
| discord.py      | `"Bot your-token"` | `"your-token"` (without the Bot prefix) |
| Discord.Net     | `"Bot your-token"` | `TokenType.Bot`, `"your-token"`         |
| discordgo       | `"Bot your-token"` | `"Bot your-token"`                      |
| @discordjs/rest | `"Bot your-token"` | `.setToken("your-token")`               |

> Always include the `"Bot "` prefix in the `token` field of `/_test/setup`.
