# Getting Started

## Fauxcord とは

Discord REST API v10 のモックサーバーです。  
本物の Discord に接続せずに、ボットやアプリのテストを自動化できます。

**できること:**
- メッセージ送信・取得・編集・削除
- リアクション、ピン留め、Webhook
- Guild / チャンネル / メンバー / ロール 操作
- OAuth2 フロー（Authorization Code / Client Credentials）
- ファイル添付

**できないこと:**
- WebSocket（Gateway / リアルタイム通知）
- 音声・動画

---

## 1. 起動する

### Docker（推奨）

```bash
docker run -p 3000:3000 ghcr.io/tomacheese/fauxcord:latest
```

データを永続化する場合:

```bash
docker run -p 3000:3000 -v fauxcord-data:/data ghcr.io/tomacheese/fauxcord:latest
```

### Docker Compose

```bash
# compose.yaml をダウンロードして起動
curl -O https://raw.githubusercontent.com/tomacheese/fauxcord/master/compose.yaml
docker compose up -d
```

### ローカル（Node.js 24 + pnpm）

```bash
git clone https://github.com/tomacheese/fauxcord
cd fauxcord
pnpm install
pnpm dev     # 開発モード（ファイル変更で自動再起動）
```

起動確認:

```bash
curl http://localhost:3000/_mock/health
# → {"status":"ok","version":"1.0.0","db":"ok","uptime":1}
```

---

## 2. Bot をセットアップする

Fauxcord は「どの Bot トークンが有効か」を管理します。  
テスト開始前に `/_test/setup` でトークンと Guild を登録してください。

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
        "name": "My Test Server",
        "channels": [
          { "id": "333333333333333333", "name": "general", "type": 0 },
          { "id": "444444444444444444", "name": "logs",    "type": 0 }
        ]
      }
    ]
  }'
```

> `id` フィールドはすべて省略可能です。省略すると Discord 互換の Snowflake ID が自動採番されます。

---

## 3. API を呼び出す

セットアップ後は、本物の Discord API と同じ URL 形式でリクエストできます。

### メッセージを送る

```bash
curl -X POST http://localhost:3000/api/v10/channels/333333333333333333/messages \
  -H "Authorization: Bot mytoken" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, Fauxcord!"}'
```

```json
{
  "id": "1513052391153471489",
  "content": "Hello, Fauxcord!",
  "author": { "id": "111111111111111111", "username": "MyTestBot", "bot": true },
  "timestamp": "2026-06-07T10:00:00.000Z",
  ...
}
```

### メッセージ一覧を取得する

```bash
curl http://localhost:3000/api/v10/channels/333333333333333333/messages \
  -H "Authorization: Bot mytoken"
```

### Webhook を作成・実行する

```bash
# 作成
WH=$(curl -s -X POST http://localhost:3000/api/v10/channels/333333333333333333/webhooks \
  -H "Authorization: Bot mytoken" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Webhook"}')

WH_ID=$(echo $WH | jq -r '.id')
WH_TOKEN=$(echo $WH | jq -r '.token')

# 実行
curl -X POST "http://localhost:3000/webhooks/$WH_ID/$WH_TOKEN?wait=true" \
  -H "Content-Type: application/json" \
  -d '{"content": "Webhook message!"}'
```

---

## 4. URL 形式

以下のどの形式でもアクセスできます。

| URL 形式 | 動作 |
|---|---|
| `/api/v10/channels/...` | 推奨（Discord 標準） |
| `/api/channels/...` | v10 として処理 |
| `/channels/...` | v10 として処理 |

> `/api/v9/` など v10 以外は `400 (50041)` を返します。

---

## 5. テストをリセットする

各テストケースの前後でデータを初期化できます。

```bash
# すべてのメッセージ・Webhook を削除（Bot / Guild / Channel は残る）
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{}'

# 特定 Bot のデータだけリセット
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{"token": "Bot mytoken"}'
```

詳しいテスト制御 API は → [test-api.md](./test-api.md)

---

## 6. 起動時に自動でデータを投入する（SEED_FILE）

毎回 `/_test/setup` を呼ぶ代わりに、起動時に自動でデータを投入できます。

```bash
SEED_FILE=/path/to/seed.json pnpm start
```

`seed.json` の形式は `seed.example.json` を参照してください。

---

## 7. 認証を無効化する（DISABLE_AUTH）

どんなトークンでもアクセスを許可したい場合:

```bash
DISABLE_AUTH=true pnpm start
```

> セットアップ済みのトークンは引き続きそのユーザー情報で動作します。  
> 未登録トークンはダミーの Bot (`MockBot`) として扱われます。

---

## 環境変数一覧

| 変数 | デフォルト | 説明 |
|---|---|---|
| `PORT` | `3000` | ポート番号 |
| `HOST` | `0.0.0.0` | バインドアドレス |
| `DB_PATH` | `/data/mock.db` | SQLite ファイルパス |
| `UPLOAD_PATH` | `/data/uploads` | 添付ファイル保存先 |
| `BASE_URL` | `http://localhost:3000` | 添付ファイル URL の生成に使用 |
| `DISABLE_AUTH` | `false` | `true` で認証バイパス |
| `LATENCY_MS` | `0` | 全レスポンスへの人工遅延（ms） |
| `SEED_FILE` | _(なし)_ | 起動時自動ロードする JSON のパス |

---

## 次のステップ

- [test-api.md](./test-api.md) — テスト制御 API の詳細
- [libraries.md](./libraries.md) — discord.js / discord.py / Discord.Net などの接続方法
