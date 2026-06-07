# Discord Mock Server

Discord REST API v10 の挙動を再現するモックサーバーです。  
実サービスへの接続なしに、Discord ボットやアプリケーションのインテグレーションテストを行えます。

## 特徴

- **Discord API v10 互換** — チャンネル、Guild、メッセージ、Webhook、OAuth2 を網羅
- **ステートフルな一貫性** — POST したメッセージは GET で取得可能
- **テスト制御 API** — `/_test/*` でテスト環境のセットアップ・リセットが可能
- **Rate Limit ヘッダー** — Discord 互換のヘッダーをレスポンスに付与（ダミー値）
- **Snowflake ID** — Discord 互換の ID を自動採番
- **ファイル添付** — multipart/form-data でのファイルアップロード対応

## クイックスタート

### Docker Compose (推奨)

```bash
# リポジトリをクローン
git clone https://github.com/yourorg/discord-mock
cd discord-mock

# 起動
docker compose up -d

# 動作確認
curl http://localhost:3000/_mock/health
```

### ローカル実行

**必要なもの:** Node.js 22 以降（推奨: 24 LTS）、pnpm

```bash
# 依存パッケージのインストール
pnpm install

# ビルドしてサーバー起動
pnpm build
pnpm start

# 開発モード（ビルド不要・ファイル変更を検知して自動再起動）
pnpm dev
```

## テスト環境のセットアップ

サーバー起動後、まず `/_test/setup` で Bot トークンと Guild を登録します。

```bash
curl -X POST http://localhost:3000/_test/setup \
  -H "Content-Type: application/json" \
  -d '{
    "token": "Bot mytoken123",
    "user": {
      "id": "1111111111111111111",
      "username": "TestBot"
    },
    "guilds": [
      {
        "id": "9876543210987654321",
        "name": "Test Guild",
        "channels": [
          { "id": "1234567890123456789", "name": "general", "type": 0 }
        ]
      }
    ]
  }'
```

**レスポンス例:**

```json
{
  "token": "Bot mytoken123",
  "user": { "id": "1111111111111111111", "username": "TestBot" },
  "guilds": [
    {
      "id": "9876543210987654321",
      "name": "Test Guild",
      "channels": [
        { "id": "1234567890123456789", "name": "general", "type": 0 }
      ]
    }
  ]
}
```

## 主要 API の使用例

### チャンネル取得

```bash
curl http://localhost:3000/api/v10/channels/1234567890123456789 \
  -H "Authorization: Bot mytoken123"
```

### メッセージ送信

```bash
curl -X POST http://localhost:3000/channels/1234567890123456789/messages \
  -H "Authorization: Bot mytoken123" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, World!"}'
```

### Webhook 作成・実行

```bash
# Webhook 作成
WEBHOOK=$(curl -s -X POST http://localhost:3000/channels/1234567890123456789/webhooks \
  -H "Authorization: Bot mytoken123" \
  -H "Content-Type: application/json" \
  -d '{"name": "MyWebhook"}')

WEBHOOK_ID=$(echo $WEBHOOK | jq -r '.id')
WEBHOOK_TOKEN=$(echo $WEBHOOK | jq -r '.token')

# Webhook 実行
curl -X POST "http://localhost:3000/webhooks/$WEBHOOK_ID/$WEBHOOK_TOKEN?wait=true" \
  -H "Content-Type: application/json" \
  -d '{"content": "Webhook message", "username": "CustomBot"}'
```

### Guild 情報取得

```bash
curl http://localhost:3000/guilds/9876543210987654321 \
  -H "Authorization: Bot mytoken123"
```

### メッセージ一括削除

```bash
curl -X POST http://localhost:3000/channels/1234567890123456789/messages/bulk-delete \
  -H "Authorization: Bot mytoken123" \
  -H "Content-Type: application/json" \
  -d '{"messages": ["id1", "id2", "id3"]}'
```

## テスト制御 API

### テスト環境リセット

```bash
# 特定 Bot のデータをリセット（Guild・チャンネルは保持）
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{"token": "Bot mytoken123"}'

# 全データリセット
curl -X POST http://localhost:3000/_test/reset \
  -H "Content-Type: application/json" \
  -d '{}'
```

### テスト環境削除

```bash
curl -X DELETE "http://localhost:3000/_test/setup/Bot%20mytoken123"
```

### チャンネルのメッセージ確認（テスト用）

```bash
curl http://localhost:3000/_test/messages/1234567890123456789
```

## 環境変数

| 変数名 | デフォルト値 | 説明 |
|---|---|---|
| `PORT` | `3000` | リッスンポート |
| `HOST` | `0.0.0.0` | バインドアドレス |
| `DB_PATH` | `/data/mock.db` | SQLite ファイルパス |
| `UPLOAD_PATH` | `/data/uploads` | 添付ファイル保存先ディレクトリ |
| `BASE_URL` | `http://localhost:3000` | 添付ファイル URL 生成・OAuth2 リダイレクトに使用 |
| `LOG_LEVEL` | `info` | ログレベル (`debug` / `info` / `warn` / `error`) |
| `DISABLE_AUTH` | `false` | `true` で任意のトークンを全許可 |
| `LATENCY_MS` | `0` | 全レスポンスに付加する人工遅延 (ms) |
| `SEED_FILE` | _(なし)_ | 起動時に自動ロードする JSON ファイルのパス |

### SEED_FILE の使用

起動時に Bot・Guild・チャンネルを自動登録できます。

```bash
# 環境変数で指定
SEED_FILE=/path/to/seed.json pnpm start
```

`seed.example.json` を参考にシードファイルを作成してください。

## サポートするパス形式

以下のいずれのパス形式でも動作します。

| パス形式 | 動作 |
|---|---|
| `/api/v10/{endpoint}` | v10 として処理（推奨） |
| `/api/{endpoint}` | v10 として処理 |
| `/{endpoint}` | v10 として処理 |

**非サポートバージョン (v6〜v9) は `400` を返します。**

## 認証

### Bot トークン認証

```
Authorization: Bot <token>
```

`/_test/setup` で事前に登録したトークンのみ有効です。

`DISABLE_AUTH=true` を設定すると、任意のトークンを全て許可します。

### 認証不要エンドポイント

- `POST /webhooks/{id}/{token}` (Webhook 実行)
- `GET /_mock/health`
- `/_test/*`

## テスト実行

```bash
# 全テスト実行
pnpm test

# ウォッチモード
pnpm test:watch

# カバレッジ
pnpm test:coverage
```

## ディレクトリ構造

```
src/
├── index.ts                # エントリーポイント
├── config.ts               # 環境変数設定
├── db.ts                   # SQLite 初期化
├── snowflake.ts            # Snowflake ID 生成
├── errors.ts               # エラーコード定数・ヘルパー
├── test-helpers.ts         # テスト用ヘルパー
├── integration.test.ts     # 統合テスト
│
├── middleware/
│   ├── auth.ts             # Bot/Bearer トークン認証
│   ├── cors.ts             # CORS 設定
│   ├── latency.ts          # 人工遅延
│   ├── rate-limit.ts       # Rate Limit ヘッダー
│   └── version.ts          # API バージョン解決
│
├── routes/
│   ├── channels.ts         # /channels/* エンドポイント
│   ├── guilds.ts           # /guilds/* エンドポイント
│   ├── mock.ts             # /_mock/* エンドポイント
│   ├── oauth2.ts           # /oauth2/* エンドポイント
│   ├── test.ts             # /_test/* エンドポイント
│   ├── users.ts            # /users/*, /applications/*
│   └── webhooks.ts         # /webhooks/* エンドポイント
│
├── services/
│   ├── attachments.ts      # ファイル保存・配信
│   ├── channels.ts         # チャンネル操作
│   ├── guilds.ts           # Guild 操作
│   ├── messages.ts         # メッセージ操作
│   ├── oauth2.ts           # OAuth2 フロー
│   ├── test-control.ts     # テスト制御
│   ├── users.ts            # ユーザー操作
│   └── webhooks.ts         # Webhook 操作
│
└── validators/
    ├── common.ts           # 共通バリデーション
    ├── guild.ts            # Guild バリデーション
    ├── message.ts          # メッセージバリデーション
    └── webhook.ts          # Webhook バリデーション
```

## 技術スタック

| 項目 | 採用技術 |
|---|---|
| Runtime | Node.js 24 (LTS) |
| フレームワーク | [Hono](https://hono.dev/) |
| DB | SQLite + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| 型定義 | [discord-api-types](https://github.com/discordjs/discord-api-types) v10 |
| テスト | [Vitest](https://vitest.dev/) |

## エラーコード

Discord API v10 と完全互換のエラーコードを返します。

| コード | 説明 |
|---|---|
| `10003` | Unknown Channel |
| `10004` | Unknown Guild |
| `10007` | Unknown Member |
| `10008` | Unknown Message |
| `10013` | Unknown User |
| `10015` | Unknown Webhook |
| `30003` | Maximum number of pins reached (50) |
| `30007` | Maximum number of webhooks reached (15) |
| `50006` | Cannot send an empty message |
| `50035` | Invalid Form Body (バリデーションエラー) |
| `50041` | Invalid API version provided |

詳細は [API 仕様書](./docs/spec.md) を参照してください。

## ライセンス

MIT
