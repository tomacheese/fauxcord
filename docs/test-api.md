# テスト制御 API

Fauxcord 固有のエンドポイント群です。
テスト環境のセットアップ・データ確認・リセットに使います。

> **認証不要** — これらのエンドポイントは Authorization ヘッダーなしで呼べます。

---

## `POST /_test/setup` — 環境を作る

Bot・Guild・Channel を一括登録します。  
テストスイートの `beforeAll` や `before_each` で呼ぶことを想定しています。

```bash
curl -X POST http://localhost:3000/_test/setup \
  -H "Content-Type: application/json" \
  -d '{
    "token": "Bot mytoken",
    "user": {
      "id": "111111111111111111",
      "username": "MyTestBot"
    },
    "guilds": [
      {
        "id": "222222222222222222",
        "name": "Test Guild",
        "channels": [
          { "id": "333333333333333333", "name": "general", "type": 0 }
        ]
      }
    ]
  }'
```

**フィールド**

| フィールド | 必須 | 説明 |
|---|---|---|
| `token` | ✅ | Bot トークン（`"Bot "` プレフィックス込み） |
| `user.id` | — | ユーザー ID（省略時は Snowflake 自動採番） |
| `user.username` | — | ユーザー名（省略時: `"MockBot"`） |
| `guilds` | — | 作成する Guild の配列 |
| `guilds[].id` | — | Guild ID（省略時: 自動採番） |
| `guilds[].name` | ✅ | Guild 名 |
| `guilds[].channels` | — | 作成するチャンネルの配列 |
| `guilds[].channels[].id` | — | チャンネル ID（省略時: 自動採番） |
| `guilds[].channels[].name` | ✅ | チャンネル名 |
| `guilds[].channels[].type` | — | チャンネル種別（`0`: テキスト、省略時: `0`） |

**レスポンス**: セットアップ結果（採番された ID を含む）

**注意**: 同じトークンで 2 回呼ぶと `409 Conflict` になります。  
2 回目以降は `/_test/reset` か `DELETE /_test/setup/:token` で既存データを削除してから再実行してください。

---

## `DELETE /_test/setup/:token` — 環境を完全削除する

Bot とその関連データ（Guild・Channel・Message・Webhook）をすべて削除します。

```bash
curl -X DELETE "http://localhost:3000/_test/setup/Bot%20mytoken"
```

> `Bot mytoken` のようにスペースを含む場合は `%20` でエンコードします。

---

## `POST /_test/reset` — メッセージだけ削除する

Guild・Channel・Bot 登録は残したまま、投稿されたデータのみを削除します。  
各テストケースの前後の初期化に使います。

### すべてのデータをリセット

```bash
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{}'
```

削除されるもの: messages, webhooks, reactions, pins, embeds, attachments

### 特定 Bot のデータだけリセット

```bash
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{"token": "Bot mytoken"}'
```

その Bot が送ったメッセージと、その Bot の Guild に属する Webhook だけが削除されます。

---

## `GET /_test/messages/:channelId` — チャンネルのメッセージを確認する

テスト内でメッセージが実際に届いているかを確認するためのエンドポイントです。

```bash
curl http://localhost:3000/_test/messages/333333333333333333
```

```json
{
  "messages": [
    {
      "id": "1513052391153471489",
      "content": "Hello, Fauxcord!",
      "author_token": "Bot mytoken",
      "created_at": "2026-06-07 10:00:00"
    }
  ]
}
```

`author_token` が `"webhook"` の場合は Webhook 経由で投稿されたメッセージです。

---

## `GET /_test/webhooks/:channelId` — チャンネルの Webhook 一覧を確認する

```bash
curl http://localhost:3000/_test/webhooks/333333333333333333
```

```json
{
  "webhooks": [
    {
      "id": "1513052391153471490",
      "name": "My Webhook",
      "token": "abcdef1234567890"
    }
  ]
}
```

---

## `GET /_mock/health` — サーバーの状態を確認する

```bash
curl http://localhost:3000/_mock/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "db": "ok",
  "uptime": 42
}
```

`db` が `"ok"` でなければ SQLite に問題があります。

---

## 典型的なテストフロー

```
1. テストスイート開始時
   POST /_test/setup   → Bot / Guild / Channel を登録

2. 各テストケース前
   POST /_test/reset   → メッセージ等をクリア

3. テスト実行
   Discord ライブラリ経由で API を呼び出す

4. アサーション
   GET /_test/messages/:channelId でメッセージ到達を確認

5. テストスイート終了時（オプション）
   DELETE /_test/setup/:token  → 完全削除
```

### 例: vitest での使い方

```typescript
import { beforeAll, beforeEach, describe, it, expect } from "vitest"

const BASE = "http://localhost:3000"
const TOKEN = "Bot test-token"
const CHANNEL_ID = "333333333333333333"

beforeAll(async () => {
  await fetch(`${BASE}/_test/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: TOKEN,
      user: { id: "111111111111111111", username: "TestBot" },
      guilds: [{ id: "222222222222222222", name: "Test Guild",
        channels: [{ id: CHANNEL_ID, name: "general", type: 0 }] }]
    })
  })
})

beforeEach(async () => {
  await fetch(`${BASE}/_test/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  })
})

it("sends a message", async () => {
  // ライブラリ経由でメッセージ送信
  await sendMessage(CHANNEL_ID, "hello")

  // /_test/messages で到達確認
  const res = await fetch(`${BASE}/_test/messages/${CHANNEL_ID}`)
  const { messages } = await res.json()
  expect(messages.some(m => m.content === "hello")).toBe(true)
})
```
