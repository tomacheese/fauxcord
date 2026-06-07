# Fauxcord

Discord REST API v10 の挙動を再現するモックサーバー。
実サービスへの接続なしに Discord ボット・アプリのインテグレーションテストを行える。

## Tech Stack

- **Runtime**: Node.js 24 + TypeScript (ES2024, NodeNext)
- **Framework**: Hono (`@hono/node-server`)
- **DB**: SQLite via `better-sqlite3`（WAL モード・外部キー有効）
- **型定義**: `discord-api-types` v10（型のみ、ランタイム使用なし）
- **Test**: Vitest
- **Lint**: ESLint (`@book000/eslint-config`) + Prettier
- **Package manager**: pnpm 11.2.2

## Essential Commands

```bash
pnpm dev              # 開発サーバー（tsx watch, hot reload）
pnpm test             # テスト実行（85 件）
pnpm test:watch       # テスト watch モード
pnpm lint             # tsc + eslint + prettier（コミット前に必須）
pnpm fix              # eslint --fix + prettier --write
pnpm build            # tsc -p tsconfig.build.json（テスト除外）
pnpm start            # node dist/index.js（本番）
```

## Architecture

```
src/
├── index.ts          # エントリーポイント・Hono アプリ組み立て・SEED_FILE
├── config.ts         # 環境変数（PORT, DB_PATH, DISABLE_AUTH, LATENCY_MS 等）
├── db.ts             # SQLite 初期化・15 テーブル定義
├── snowflake.ts      # Discord Snowflake ID 生成（Discord Epoch: 1420070400000n）
├── errors.ts         # DiscordErrorCode 定数・discordError / validationError ヘルパー
├── middleware/       # auth, cors, latency, rate-limit, version
├── routes/           # Hono ルーターファクトリ（createXxxRoutes(db, baseUrl)）
├── services/         # DB 操作ロジック（ルートから呼ばれる）
└── validators/       # リクエストバリデーション（エラー形式は Discord 仕様に合わせる）
```

**データフロー**: `index.ts` → ミドルウェア → `routes/` → `services/` → DB

**ルートマウント**: `/api/v10/`, `/api/`, `/` の 3 プレフィックスをすべてマウントする（`src/index.ts` の `routePrefix` ループ参照）。Webhook ルートも含む。

## Code Conventions

- 関数・インターフェースには **jsdoc（日本語）** を必ず記載
- コード内コメントは日本語
- エラーメッセージは英語（例: `"Unknown Channel"`）
- `skipLibCheck: false` は**絶対に変更しない**
- `any` 型の使用禁止（ESLint で強制）
- `.reverse()` → `.toReversed()`、`parseInt` → `Number.parseInt`（unicorn ルール）

## Key Implementation Patterns

**エラーレスポンス**（Discord API 仕様に厳密準拠）:
```typescript
return c.json(discordError(DiscordErrorCode.UNKNOWN_CHANNEL, "Unknown Channel", 404).body, 404)
```

**新規エンドポイント追加時**:
1. `src/services/` に DB 操作関数を追加（jsdoc 必須）
2. `src/routes/` のファクトリ関数にルート追加
3. 必要なら `src/validators/` にバリデーション追加
4. `src/routes/xxx.test.ts` にテスト追加（TDD 推奨）

**ルート定義順序に注意**: Hono は先勝ちマッチ。`/channels/:cid/messages/pins`（リテラル）は `/channels/:cid/messages/:mid`（パラメータ）より**前**に定義する。

## Testing

```bash
pnpm test                          # 全テスト（85 件）
pnpm test src/routes/channels      # ファイル指定
pnpm test:watch                    # watch モード（開発中）
pnpm test:coverage                 # カバレッジ付き
```

### 方針（t_wada TDD）

**Red → Green → Refactor** サイクルで実装する。

1. **Red**: 失敗するテストを先に書く
2. **Green**: テストが通る最小限の実装を書く
3. **Refactor**: テストを通したまま整理する

### テストの種類と配置

| 種類 | 場所 | 対象 |
|---|---|---|
| ユニットテスト | `src/xxx.test.ts` | 純粋関数（snowflake, errors 等） |
| ルートテスト | `src/routes/xxx.test.ts` | API エンドポイント単体 |
| 統合テスト | `src/integration.test.ts` | 複数機能を組み合わせたシナリオ |

### ルートテストの書き方

```typescript
// src/test-helpers.ts の createTestApp を使いインメモリ DB で動かす
const { app, db } = createTestApp()
const bot = seedBot(db, "Bot testtoken")
const guild = seedGuild(db, bot, "TestGuild")
const channel = seedChannel(db, guild, "general")

const res = await app.request("/api/v10/channels/" + channel.id, {
  headers: { Authorization: "Bot testtoken" },
})
expect(res.status).toBe(200)
const body = await res.json() as Record<string, unknown>
expect(body.id).toBe(channel.id)
```

### 注意点

- インメモリ DB（`:memory:`）を使用 → テスト間は独立（`createTestApp()` を各テストで呼ぶ）
- WAL モードは `:memory:` では `"memory"` になる → `expect(["wal","memory"]).toContain(result)`
- 認証ミドルウェアを含まない `createTestApp()` では、`Authorization` ヘッダーを直接 Bot レコードに照合する仕組みになっている（`src/routes/channels.ts` の fallback 参照）
- 新しいエンドポイントを追加したら、成功ケース・404・401・バリデーションエラーを最低限テストする

## Library Compatibility Testing

実際の Discord ライブラリをモックサーバーに向ける方法。
ベースURLを差し替えるだけで各ライブラリが動作することを確認済み。

### TypeScript / JavaScript — @discordjs/rest

```typescript
import { REST } from "@discordjs/rest"

const rest = new REST({ version: "10", api: "http://localhost:3000/api" }).setToken("your-token")
// → リクエストは http://localhost:3000/api/v10/... に向かう
```

### Python — discord.py 2.7+

```python
import discord.http as dhttp
dhttp.Route.BASE = "http://localhost:3000/api/v10"

client = discord.Client(intents=discord.Intents.default())
await client.login("your-token")
```

**注意**: discord.py 2.7+ はピン API に `/channels/{id}/messages/pins/{mid}` を使う（旧 `/channels/{id}/pins/{mid}` ではない）。`?wait=True` は `?wait=1` として送信される。

### C# — Discord.Net.Rest

```csharp
var config = new DiscordRestConfig {
    RestClientProvider = _ =>
        DefaultRestClientProvider.Instance("http://localhost:3000/api/v10/")
};
var client = new DiscordRestClient(config);
await client.LoginAsync(TokenType.Bot, "your-token");
```

**注意**: Discord.Net はログイン時に `GET /oauth2/applications/@me` を呼ぶ（実装済み）。

### Go — discordgo

```go
discordgo.EndpointAPI = "http://localhost:3000/api/v10/"
// 他のエンドポイント変数も必要に応じて書き換える

session, _ := discordgo.New("Bot your-token")
```

### テスト環境のセットアップ

ライブラリテスト前に `/_test/setup` で Bot・Guild・Channel を登録する:

```bash
curl -X POST http://localhost:3000/_test/setup \
  -H "Content-Type: application/json" \
  -d '{
    "token": "Bot your-token",
    "user": {"id": "111111111111111111", "username": "TestBot"},
    "guilds": [{"id": "222222222222222222", "name": "Test Guild",
      "channels": [{"id": "333333333333333333", "name": "general", "type": 0}]}]
  }'
```

### 非対応ライブラリ

- **DSharpPlus 4.x**: ベース URL が `const` で変更不可（5.x nightly は未確認）

## Environment Variables

| 変数 | デフォルト | 説明 |
|---|---|---|
| `PORT` | `3000` | リッスンポート |
| `DB_PATH` | `/data/mock.db` | SQLite ファイルパス |
| `DISABLE_AUTH` | `false` | `true` で認証バイパス |
| `LATENCY_MS` | `0` | 全 API レスポンスへの人工遅延 |
| `SEED_FILE` | _(なし)_ | 起動時自動ロード JSON |

## Important Gotchas

- **Webhook ルートは `routePrefix` ループ内**にあること（`/api/v10/webhooks/...` に対応するため）
- **Webhook 実行の `wait` パラメータ**: `"true"` と `"1"` の両方を真と解釈（discord.py は `?wait=1` を送る）
- **`GET /channels/:id/messages/pins`**（新 API）は `{"items":[...],"has_more":false}` 形式を返す。`GET /channels/:id/pins`（旧 API）はフラット配列
- **bulk-delete の数値 ID**: JS の JSON.parse で 19 桁 Snowflake が精度消失するため生テキストから正規表現で抽出（`src/routes/channels.ts` 参照）
- **`embeds: null`**: discordgo 等が送るため null を空配列として扱う
- **`/users/%40me`**: `@` の percent-encode に対応（`src/routes/users.ts` 参照）
- **Docker healthcheck**: Alpine の busybox wget は `localhost` を IPv6 解決するため `127.0.0.1` を明示

## Discord API v10 Compatibility Notes

- **Snowflake ID**: Discord Epoch (1420070400000n) を使用
- **エラーコード**: `src/errors.ts` の `DiscordErrorCode` を使用すること
- **Rate Limit ヘッダー**: 全レスポンスに `x-ratelimit-*` を付与（ダミー値）
- **`@everyone` ロール**: Guild 作成時に ID = Guild ID で自動生成（`src/services/test-control.ts`）
- **`/oauth2/applications/@me`**: Discord.Net がログイン時に呼び出すエイリアス（`src/routes/users.ts`）

## Git Workflow

- ブランチ: [Conventional Branch](https://conventional-branch.github.io)（`feat/`, `fix/` 等）
- コミット: [Conventional Commits](https://www.conventionalcommits.org/)、`<description>` は日本語
- push は **SSH** のみ
- PR 作成前に `pnpm lint` と `pnpm test` が通ること

## References

- @docs/spec.md — API 仕様書（エンドポイント一覧・エラーコード）
- @docs/design.md — 設計書（アーキテクチャ・DB スキーマ・Docker 設定）
- @seed.example.json — SEED_FILE フォーマットのサンプル
