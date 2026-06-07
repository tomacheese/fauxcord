# ライブラリ別 接続ガイド

各 Discord ライブラリをFauxcord に向ける方法です。  
基本的には**ベース URL を差し替えるだけ**で動作します。

---

## 事前準備（共通）

どのライブラリを使う場合も、まず `/_test/setup` で Bot を登録してください。

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

返ってきた `id` をコードで使います。

---

## JavaScript / TypeScript — @discordjs/rest

`new REST` の `api` オプションでベース URL を差し替えます。

```typescript
import { REST, Routes } from "@discordjs/rest"

const rest = new REST({ version: "10", api: "http://localhost:3000/api" })
  .setToken("your-token")

// 通常の Discord API と同じように呼べる
const channel = await rest.get(Routes.channel("333333333333333333"))
const message = await rest.post(Routes.channelMessages("333333333333333333"), {
  body: { content: "Hello from discord.js!" }
})
```

> `api: "http://localhost:3000/api"` と指定すると、実際のリクエストは  
> `http://localhost:3000/api/v10/...` に向かいます。

**対応バージョン**: `@discordjs/rest` 2.x 以降

---

## Python — discord.py 2.x

`Route.BASE` を書き換えます。

```python
import asyncio
import discord
import discord.http as dhttp

# Fauxcord に向ける
dhttp.Route.BASE = "http://localhost:3000/api/v10"

async def main():
    client = discord.Client(intents=discord.Intents.default())
    await client.login("your-token")  # "Bot " プレフィックスなし

    # チャンネルを取得
    channel = await client.fetch_channel(333333333333333333)

    # メッセージを送る
    msg = await channel.send("Hello from discord.py!")
    print(f"Sent: {msg.id}")

    # ピン留め
    await msg.pin()

    # Webhook を作る
    wh = await channel.create_webhook(name="MyWebhook")
    await wh.send("Hello from webhook!", wait=True)

    await client.close()

asyncio.run(main())
```

**バージョン固有の注意点**:

- **discord.py 2.7+** はピン API に `/channels/{id}/messages/pins/{mid}` を使います  
  （旧 `/channels/{id}/pins/{mid}` は別途実装済みで両方動きます）
- `webhook.send(wait=True)` は `?wait=1` として送信されます（Fauxcord は両方サポート）

**対応バージョン**: discord.py 2.x（2.7.1 で動作確認済み）

---

## C# — Discord.Net.Rest

`DiscordRestConfig` の `RestClientProvider` でベース URL を差し替えます。

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

// チャンネルを取得
var channel = (IRestMessageChannel)await client.GetChannelAsync(333333333333333333UL);

// メッセージを送る
var msg = await channel.SendMessageAsync("Hello from Discord.Net!");

// Webhook を作る
var guildChannel = (IRestTextChannel)await client.GetChannelAsync(333333333333333333UL);
var webhook = await guildChannel.CreateWebhookAsync("MyWebhook");
```

**注意点**:

- Discord.Net はログイン時に `GET /oauth2/applications/@me` を呼びます（Fauxcord は対応済み）
- `IRestTextChannel` にキャストしてから `CreateWebhookAsync` を呼んでください

**対応バージョン**: Discord.Net 3.x（3.20.0 で動作確認済み）  
**非対応**: DSharpPlus 4.x（ベース URL が定数のため変更不可）

---

## Go — discordgo

パッケージ変数でエンドポイントを書き換えます。

```go
package main

import (
    "fmt"
    "github.com/bwmarrin/discordgo"
)

func main() {
    // Fauxcord に向ける
    discordgo.EndpointAPI = "http://localhost:3000/api/v10/"

    s, err := discordgo.New("Bot your-token")
    if err != nil {
        panic(err)
    }

    // チャンネルを取得
    ch, _ := s.Channel("333333333333333333")
    fmt.Println("Channel:", ch.Name)

    // メッセージを送る
    msg, _ := s.ChannelMessageSend("333333333333333333", "Hello from discordgo!")
    fmt.Println("Message ID:", msg.ID)

    // Webhook を作る
    wh, _ := s.WebhookCreate("333333333333333333", "MyWebhook", "")
    s.WebhookExecute(wh.ID, wh.Token, true, &discordgo.WebhookParams{
        Content: "Hello from webhook!",
    })
}
```

**注意点**:

- `discordgo.ChannelMessageSend()` は `embeds: null` を含むリクエストを送ります（Fauxcord は対応済み）

**対応バージョン**: discordgo v0.29.0 で動作確認済み

---

## 比較表

| ライブラリ | 言語 | 設定方法 | 対応状況 |
|---|---|---|---|
| @discordjs/rest | JS/TS | `new REST({ api: "..." })` | ✅ |
| discord.py | Python | `Route.BASE = "..."` | ✅ |
| Discord.Net.Rest | C# | `RestClientProvider` | ✅ |
| discordgo | Go | `EndpointAPI = "..."` | ✅ |
| DSharpPlus 4.x | C# | ❌ 不可（定数） | ❌ |

---

## トークン形式について

| ライブラリ | セットアップ時 | ログイン時 |
|---|---|---|
| discord.py | `"Bot your-token"` | `"your-token"`（Bot プレフィックスなし） |
| Discord.Net | `"Bot your-token"` | `TokenType.Bot`, `"your-token"` |
| discordgo | `"Bot your-token"` | `"Bot your-token"` |
| @discordjs/rest | `"Bot your-token"` | `.setToken("your-token")` |

> `/_test/setup` の `token` フィールドには必ず `"Bot "` プレフィックスを付けてください。
