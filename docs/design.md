# Discord Mock Server — アーキテクチャ設計書

> バージョン: 1.0.0  
> 最終更新: 2026-06-07

---

## 目次

1. [技術スタック](#1-技術スタック)
2. [ディレクトリ構造](#2-ディレクトリ構造)
3. [アーキテクチャ概要](#3-アーキテクチャ概要)
4. [DBスキーマ設計](#4-dbスキーマ設計)
5. [Snowflake ID生成](#5-snowflake-id生成)
6. [認証フロー](#6-認証フロー)
7. [ファイル保存設計](#7-ファイル保存設計)
8. [環境変数](#8-環境変数)
9. [エラーハンドリング設計](#9-エラーハンドリング設計)
10. [Rate Limitヘッダー実装](#10-rate-limitヘッダー実装)
11. [Dockerfile](#11-dockerfile)
12. [compose.yaml](#12-composeyaml)
13. [GitHub Actions（ghcr.io配布）](#13-github-actionsghcrio配布)
14. [パッケージ構成](#14-パッケージ構成)

---

## 1. 技術スタック

| 項目 | 採用技術 | 理由 |
|---|---|---|
| Runtime | Node.js 24 | 安定性・エコシステム |
| パッケージマネージャ | pnpm 11（11.2.2 に固定） | lockfile 再現性・高速インストール |
| 実行方式 | tsc ビルド + node 実行（開発時のみ tsx watch） | 本番イメージから devDependencies / ビルドツールを排除し軽量・安全に |
| フレームワーク | Hono | 軽量・TypeScript-first・DiscordのURL構造との相性 |
| DB | SQLite + better-sqlite3 | 単一コンテナ・シンプル・WALモードで並行性確保 |
| 型定義 | discord-api-types/v10 | 公式型定義の流用 |
| 配布 | ghcr.io | GitHub Container Registry |

---

## 2. ディレクトリ構造

```
discord-mock/
├── src/
│   ├── index.ts                  # エントリーポイント・Honoアプリ起動
│   ├── config.ts                 # 環境変数読み込み・バリデーション
│   ├── db.ts                     # SQLite初期化・マイグレーション・WAL設定
│   ├── snowflake.ts              # Snowflake ID生成
│   │
│   ├── middleware/
│   │   ├── auth.ts               # Bot/Bearer トークン認証
│   │   ├── rate-limit.ts         # Rate Limitダミーヘッダー付与
│   │   ├── cors.ts               # CORS設定（* 固定）
│   │   ├── latency.ts            # 人工遅延（LATENCY_MS）
│   │   └── version.ts            # APIバージョンルーティング
│   │
│   ├── routes/
│   │   ├── channels.ts           # /channels/* エンドポイント
│   │   ├── guilds.ts             # /guilds/* エンドポイント
│   │   ├── users.ts              # /users/*, /applications/* エンドポイント
│   │   ├── webhooks.ts           # /webhooks/* エンドポイント
│   │   ├── oauth2.ts             # /oauth2/* エンドポイント
│   │   ├── test.ts               # /_test/* テスト制御エンドポイント
│   │   └── mock.ts               # /_mock/* インフラエンドポイント
│   │
│   ├── validators/
│   │   ├── message.ts            # メッセージバリデーション
│   │   ├── guild.ts              # Guildバリデーション
│   │   ├── webhook.ts            # Webhookバリデーション
│   │   └── common.ts             # 共通バリデーション
│   │
│   ├── services/
│   │   ├── channels.ts           # チャンネル操作ロジック
│   │   ├── messages.ts           # メッセージ操作ロジック
│   │   ├── guilds.ts             # Guild操作ロジック
│   │   ├── webhooks.ts           # Webhook操作ロジック
│   │   ├── users.ts              # ユーザー操作ロジック
│   │   ├── oauth2.ts             # OAuth2フロー
│   │   └── attachments.ts        # ファイル保存・配信
│   │
│   └── errors.ts                 # Discordエラーコード定数・生成ヘルパー
│
├── .github/
│   └── workflows/
│       └── docker-publish.yml    # CI: テスト → イメージビルド・公開（ghcr.io）
├── Dockerfile                    # マルチステージビルド（builder / prod-deps / runner）
├── .dockerignore                 # ビルドコンテキストから除外するファイル
├── compose.yaml
├── tsconfig.json                 # 型チェック用（テストコードを含む）
├── tsconfig.build.json           # 本番ビルド用（テストコードを dist から除外）
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml           # ビルドスクリプト許可設定（allowBuilds）
└── .npmrc
```

---

## 3. アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│                        Hono App                             │
│                                                             │
│  Middleware chain（全リクエスト）                            │
│  cors → version → auth → latency → rate-limit              │
│                     ↓                                       │
│  ┌──────────────────────────────────────────┐               │
│  │              Routes                      │               │
│  │  /api/v10/*  → channels / guilds /       │               │
│  │               users / webhooks / oauth2  │               │
│  │  /_test/*    → test                      │               │
│  │  /_mock/*    → mock (health, attachments)│               │
│  └────────────────┬─────────────────────────┘               │
│                   ↓                                         │
│  ┌────────────────────────────────────────┐                 │
│  │            Services                    │                 │
│  │  ビジネスロジック・DB操作                │                 │
│  └────────────┬───────────────────────────┘                 │
│               ↓                                             │
│  ┌────────────────────────────────────────┐                 │
│  │  better-sqlite3 (WAL mode)             │                 │
│  │  /data/mock.db                         │                 │
│  └────────────────────────────────────────┘                 │
│                                                             │
│  ファイル保存: /data/uploads/                               │
└─────────────────────────────────────────────────────────────┘
```

### リクエスト処理フロー

```
1. CORS ヘッダー付与
2. バージョン解決（/api/v9/ → 400、未指定 → v10 として処理）
3. 認証チェック（DISABLE_AUTH=true の場合スキップ）
4. 人工遅延（LATENCY_MS > 0 の場合）
5. ルーティング → Services → DB
6. Rate Limit ヘッダー付与
7. レスポンス返却
```

---

## 4. DBスキーマ設計

### 初期化

```typescript
// db.ts
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA synchronous = NORMAL");
```

### テーブル定義

#### bots（登録済みBotトークン）

```sql
CREATE TABLE IF NOT EXISTS bots (
  token       TEXT PRIMARY KEY,          -- "Bot xxxxxxxx"
  user_id     TEXT NOT NULL,
  username    TEXT NOT NULL DEFAULT 'MockBot',
  discriminator TEXT NOT NULL DEFAULT '0',
  bot         INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### guilds

```sql
CREATE TABLE IF NOT EXISTS guilds (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  icon                   TEXT,
  owner_id               TEXT NOT NULL,
  bot_token              TEXT NOT NULL REFERENCES bots(token),
  verification_level     INTEGER NOT NULL DEFAULT 0,
  default_message_notifications INTEGER NOT NULL DEFAULT 0,
  explicit_content_filter INTEGER NOT NULL DEFAULT 0,
  premium_tier           INTEGER NOT NULL DEFAULT 0,
  preferred_locale       TEXT NOT NULL DEFAULT 'en-US',
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### channels

```sql
CREATE TABLE IF NOT EXISTS channels (
  id                   TEXT PRIMARY KEY,
  guild_id             TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  type                 INTEGER NOT NULL DEFAULT 0,
  name                 TEXT,
  topic                TEXT,
  nsfw                 INTEGER NOT NULL DEFAULT 0,
  position             INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_user  INTEGER NOT NULL DEFAULT 0,
  parent_id            TEXT,
  last_message_id      TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_channels_guild ON channels(guild_id);
```

#### users（テスト用ユーザー）

```sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  discriminator TEXT NOT NULL DEFAULT '0',
  avatar        TEXT,
  bot           INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### guild_members

```sql
CREATE TABLE IF NOT EXISTS guild_members (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  nick       TEXT,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deaf       INTEGER NOT NULL DEFAULT 0,
  mute       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX idx_members_guild ON guild_members(guild_id);
```

#### roles

```sql
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'new role',
  color       INTEGER NOT NULL DEFAULT 0,
  hoist       INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '0',
  managed     INTEGER NOT NULL DEFAULT 0,
  mentionable INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_roles_guild ON roles(guild_id);
```

#### messages

```sql
CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  channel_id       TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id        TEXT NOT NULL,
  author_token     TEXT,                    -- 送信したBotのトークン（/_test/用）
  content          TEXT NOT NULL DEFAULT '',
  tts              INTEGER NOT NULL DEFAULT 0,
  mention_everyone INTEGER NOT NULL DEFAULT 0,
  pinned           INTEGER NOT NULL DEFAULT 0,
  type             INTEGER NOT NULL DEFAULT 0,
  flags            INTEGER NOT NULL DEFAULT 0,
  referenced_message_id TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at        TEXT
);

CREATE INDEX idx_messages_channel ON messages(channel_id, id);
```

#### embeds

```sql
CREATE TABLE IF NOT EXISTS embeds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,               -- JSON文字列
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_embeds_message ON embeds(message_id);
```

#### attachments

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  size         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  file_path    TEXT NOT NULL,              -- /data/uploads/ 以下の相対パス
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_attachments_message ON attachments(message_id);
```

#### reactions

```sql
CREATE TABLE IF NOT EXISTS reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  emoji      TEXT NOT NULL,               -- Unicode絵文字 or "name:id"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON reactions(message_id);
```

#### pins

```sql
CREATE TABLE IF NOT EXISTS pins (
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel_id, message_id)
);
```

#### webhooks

```sql
CREATE TABLE IF NOT EXISTS webhooks (
  id         TEXT PRIMARY KEY,
  type       INTEGER NOT NULL DEFAULT 1,
  guild_id   TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  avatar     TEXT,
  token      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_webhooks_channel ON webhooks(channel_id);
CREATE INDEX idx_webhooks_guild ON webhooks(guild_id);
```

#### oauth2_clients

```sql
CREATE TABLE IF NOT EXISTS oauth2_clients (
  client_id     TEXT PRIMARY KEY,
  client_secret TEXT NOT NULL,
  bot_token     TEXT REFERENCES bots(token),
  redirect_uris TEXT NOT NULL DEFAULT '[]',  -- JSON配列
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### oauth2_auth_codes

```sql
CREATE TABLE IF NOT EXISTS oauth2_auth_codes (
  code         TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES oauth2_clients(client_id),
  user_id      TEXT NOT NULL,
  scope        TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0
);
```

#### oauth2_access_tokens

```sql
CREATE TABLE IF NOT EXISTS oauth2_access_tokens (
  token         TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES oauth2_clients(client_id),
  user_id       TEXT,
  scope         TEXT NOT NULL,
  token_type    TEXT NOT NULL DEFAULT 'Bearer',
  expires_at    TEXT NOT NULL,
  refresh_token TEXT UNIQUE
);
```

---

## 5. Snowflake ID生成

Discord 互換の 64bit Snowflake を生成します。

```typescript
// snowflake.ts

const DISCORD_EPOCH = 1420070400000n;  // 2015-01-01T00:00:00.000Z
const WORKER_ID     = 1n;
const PROCESS_ID    = 1n;

let increment = 0n;

export function generateSnowflake(): string {
  const timestamp = BigInt(Date.now()) - DISCORD_EPOCH;
  const id =
    (timestamp << 22n) |
    (WORKER_ID << 17n) |
    (PROCESS_ID << 12n) |
    (increment & 0xFFFn);

  increment++;
  return id.toString();
}

// Snowflake からタイムスタンプを復元
export function snowflakeToTimestamp(snowflake: string): Date {
  const id = BigInt(snowflake);
  const timestamp = (id >> 22n) + DISCORD_EPOCH;
  return new Date(Number(timestamp));
}
```

---

## 6. 認証フロー

### Bot トークン認証

```
リクエスト
  ↓
Authorization ヘッダーを取得
  ↓
"Bot " プレフィックスを確認
  ↓
DISABLE_AUTH=true? → スキップ（任意トークン許可）
  ↓
bots テーブルを検索
  ↓
存在しない → 401 { "message": "401: Unauthorized", "code": 0 }
  ↓
c.set("bot", botRecord) としてコンテキストに保存
  ↓
次のハンドラへ
```

### Bearer トークン認証

```
Authorization: Bearer <token>
  ↓
oauth2_access_tokens を検索
  ↓
存在しない or 期限切れ → 401
  ↓
c.set("user", userRecord) としてコンテキストに保存
  ↓
次のハンドラへ
```

---

## 7. ファイル保存設計

### ディレクトリ構造

```
/data/uploads/
└── {channel_id}/
    └── {message_id}/
        └── {original_filename}
```

### 保存フロー

```
multipart/form-data リクエスト受信
  ↓
files[N] フィールドをパース（busboy / hono built-in）
  ↓
ファイルサイズチェック（> 25MB → 400 / code: 50045）
  ↓
ファイル数チェック（> 10 → 400 / code: 30015）
  ↓
/data/uploads/{channel_id}/{message_id}/ を作成
  ↓
ファイルを書き込み
  ↓
attachments テーブルに記録
  ↓
URL: {BASE_URL}/_mock/attachments/{channel_id}/{message_id}/{filename}
```

### 添付ファイルURL形式

```
http://localhost:3000/_mock/attachments/CHANNEL_ID/MESSAGE_ID/filename.png
```

`proxy_url` も同一URLを返します（Discord は CDN URLと proxy_url が異なりますが、モックでは同一にします）。

---

## 8. 環境変数

| 変数名 | デフォルト | 型 | 説明 |
|---|---|---|---|
| `PORT` | `3000` | number | リッスンポート |
| `HOST` | `0.0.0.0` | string | バインドアドレス |
| `DB_PATH` | `/data/mock.db` | string | SQLiteファイルパス |
| `UPLOAD_PATH` | `/data/uploads` | string | 添付ファイル保存先ディレクトリ |
| `BASE_URL` | `http://localhost:3000` | string | 添付ファイルURL生成・OAuth2リダイレクトに使用 |
| `LOG_LEVEL` | `info` | enum | `debug` / `info` / `warn` / `error` |
| `DISABLE_AUTH` | `false` | boolean | `true` で任意トークンを全許可 |
| `LATENCY_MS` | `0` | number | 全レスポンスに付加する人工遅延（ms） |
| `SEED_FILE` | _(なし)_ | string | 起動時に自動ロードする JSON ファイルのパス |

### SEED_FILE の形式

```json
{
  "bots": [
    {
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
    }
  ]
}
```

起動時に `/_test/setup` と同等の処理を実行します。既存データが存在する場合はスキップします。

---

## 9. エラーハンドリング設計

### エラー生成ヘルパー

```typescript
// errors.ts

export const DiscordErrorCode = {
  UNKNOWN_CHANNEL:        10003,
  UNKNOWN_GUILD:          10004,
  UNKNOWN_MEMBER:         10007,
  UNKNOWN_MESSAGE:        10008,
  UNKNOWN_ROLE:           10011,
  UNKNOWN_TOKEN:          10012,
  UNKNOWN_USER:           10013,
  UNKNOWN_WEBHOOK:        10015,
  MAX_PINS_REACHED:       30003,
  MAX_ROLES_REACHED:      30005,
  MAX_WEBHOOKS_REACHED:   30007,
  MAX_CHANNELS_REACHED:   30013,
  MAX_ATTACHMENTS:        30015,
  UNAUTHORIZED:           40001,
  REQUEST_TOO_LARGE:      40005,
  ALREADY_PINNED:         40041,
  MISSING_ACCESS:         50001,
  CANNOT_EDIT_OTHER:      50005,
  EMPTY_MESSAGE:          50006,
  MISSING_PERMISSIONS:    50013,
  INVALID_BULK_DELETE:    50016,
  WRONG_PIN_CHANNEL:      50019,
  MESSAGE_TOO_OLD:        50034,
  INVALID_FORM_BODY:      50035,
  INVALID_API_VERSION:    50041,
  FILE_TOO_LARGE:         50045,
} as const;

export function discordError(code: number, message: string, status: number) {
  return { json: { message, code }, status };
}
```

### グローバルエラーハンドラ

```typescript
// index.ts

app.onError((err, c) => {
  console.error(err);
  return c.json({ message: "500: Internal Server Error", code: 0 }, 500);
});

app.notFound((c) => {
  return c.json({ message: "404: Not Found", code: 0 }, 404);
});
```

---

## 10. Rate Limitヘッダー実装

```typescript
// middleware/rate-limit.ts

export const rateLimitMiddleware = () => async (c: Context, next: Next) => {
  await next();

  const resetTime = Math.floor(Date.now() / 1000) + 1;
  const bucket = `mock-${c.req.method}-${c.req.path.split('/')[2] ?? 'global'}`;

  c.header('X-RateLimit-Limit',       '5');
  c.header('X-RateLimit-Remaining',   '4');
  c.header('X-RateLimit-Reset',       resetTime.toString());
  c.header('X-RateLimit-Reset-After', '1.000');
  c.header('X-RateLimit-Bucket',      bucket);
  c.header('X-RateLimit-Scope',       'user');
};
```

---

## 11. Dockerfile

マルチステージビルドを採用し、本番イメージを軽量・安全に保つ。

| ステージ | 役割 |
|---|---|
| builder | ビルドツール（python3/make/g++）導入、pnpm install、tsc コンパイル |
| prod-deps | `pnpm prune --prod` で devDependencies を削除（better-sqlite3 のビルド済みバイナリは保持） |
| runner | 実行専用。ビルドツール・devDependencies を含まない。非 root ユーザーで実行 |

設計ポイント:

- pnpm はバージョン固定（`corepack prepare pnpm@11.2.2 --activate`）で lockfile との再現性を保証
- 非 root ユーザー `discord-mock`（uid 1001）で実行し、`/data` は事前に chown
- `NODE_ENV=production` を設定
- `HEALTHCHECK` の `start-period` は起動に時間がかかるため 15s に設定
- `.dockerignore` で node_modules / dist / .git / *.db / .env などをビルドコンテキストから除外
- `COPY . .` を避け、必要なファイルのみコピーしてキャッシュ効率を向上

```dockerfile
# syntax=docker/dockerfile:1

# ===== Stage 1: builder =====
# 依存パッケージのインストールと TypeScript のビルドを行うステージ
FROM node:24-alpine AS builder

# better-sqlite3 のネイティブビルドに必要なツール
RUN apk add --no-cache python3 make g++

WORKDIR /app

# pnpm をバージョン固定でインストール（lockfile と互換性を保つため）
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

# 依存パッケージのインストール（ビルドスクリプト許可済み）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ソースコードをコピーして TypeScript をコンパイル
# (tsconfig.build.json も必要なため glob でコピーする)
COPY tsconfig*.json ./
COPY src ./src
RUN pnpm run build

# ===== Stage 2: prod-deps =====
# devDependencies を削除し、本番用依存のみに削減するステージ
# （better-sqlite3 のビルド済みバイナリは保持される）
FROM builder AS prod-deps
RUN pnpm prune --prod

# ===== Stage 3: runner =====
# 実行専用の軽量ステージ（ビルドツール・devDependencies を含まない）
FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

# 非 root ユーザーを作成（セキュリティのため root で実行しない）
RUN addgroup -S nodejs && adduser -S discord-mock -u 1001 -G nodejs

# データディレクトリを作成し、非 root ユーザーが書き込めるよう権限を付与
RUN mkdir -p /data/uploads && chown -R discord-mock:nodejs /data

# ビルド成果物と本番用依存のみをコピー
COPY --from=prod-deps --chown=discord-mock:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=discord-mock:nodejs /app/dist ./dist
COPY --from=builder --chown=discord-mock:nodejs /app/package.json ./package.json

USER discord-mock

EXPOSE 3000

# ヘルスチェック（DB 初期化などで起動に時間がかかるため start-period は長めに設定）
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/_mock/health || exit 1

# コンパイル済み JavaScript を直接実行（tsx は本番では使用しない）
CMD ["node", "dist/index.js"]
```

---

## 12. compose.yaml

Docker Compose v2 の正式名称である `compose.yaml` を使用する（`docker-compose.yml` はレガシー名称）。
本番相当の `discord-mock` サービスに加え、`dev` profile でホットリロード付きの開発用サービスを提供する。

```yaml
services:
  discord-mock:
    build: .
    # または ghcr.io から取得する場合:
    # image: ghcr.io/yourorg/discord-mock:latest
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      HOST: 0.0.0.0
      DB_PATH: /data/mock.db
      UPLOAD_PATH: /data/uploads
      # BASE_URL はアタッチメント URL などレスポンス内に埋め込まれる URL の生成に使用される。
      # ホストマシン上のクライアントからアクセスする想定のため localhost を指定している。
      # 別のコンテナや外部ホストからアクセスする場合は、そのクライアントから到達可能な URL に変更すること。
      BASE_URL: http://localhost:3000
      LOG_LEVEL: info
      DISABLE_AUTH: "false"
      LATENCY_MS: "0"
      # SEED_FILE: /config/seed.json
    volumes:
      # SQLite データベースとアップロードファイルの永続化用ボリューム
      - discord-mock-data:/data
      # 起動時に初期データを投入する場合は、以下のコメントアウトを解除し、
      # あわせて上記 environment の SEED_FILE も有効化すること。
      # シードファイルの書式は seed.example.json を参照。
      # - ./seed.json:/config/seed.json:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/_mock/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      # 起動に時間がかかるため少し長めに設定
      start_period: 15s
    restart: unless-stopped

  # 開発用サービス: ソースコードの変更を監視して自動再起動する（tsx watch）
  # 起動例: docker compose --profile dev up discord-mock-dev
  discord-mock-dev:
    profiles:
      - dev
    build:
      context: .
      # builder ステージには devDependencies（tsx など）が含まれている
      target: builder
    command: ["node_modules/.bin/tsx", "watch", "src/index.ts"]
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      HOST: 0.0.0.0
      DB_PATH: /data/mock.db
      UPLOAD_PATH: /data/uploads
      BASE_URL: http://localhost:3000
      LOG_LEVEL: debug
      DISABLE_AUTH: "false"
      LATENCY_MS: "0"
    volumes:
      # ホスト側のソースコードをマウントしてホットリロードを有効化
      - ./src:/app/src
      - discord-mock-data:/data

volumes:
  discord-mock-data:
```

---

## 13. GitHub Actions（ghcr.io配布）

設計ポイント:

- `test` ジョブ（型チェック → テスト → ビルド）が成功した場合のみ `build-and-push` を実行（`needs: test`）
- pnpm のバージョンは package.json の `packageManager` フィールド（pnpm@11.2.2）から自動解決
- マルチアーキテクチャビルド（linux/amd64, linux/arm64。better-sqlite3 はアーキごとにビルド）
- サプライチェーンセキュリティ: SBOM・Provenance アテステーションを付与

```yaml
# .github/workflows/docker-publish.yml

name: Build and Push Docker Image

on:
  push:
    branches: [main]
    tags: ['v*.*.*']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup pnpm
        # バージョンは package.json の packageManager フィールド (pnpm@11.2.2) から自動解決される
        uses: pnpm/action-setup@v6

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm run lint

      - name: Run tests
        run: pnpm test

      - name: Build
        run: pnpm run build

  build-and-push:
    runs-on: ubuntu-latest
    # テストが成功した場合のみイメージをビルド・公開する
    needs: test
    permissions:
      contents: read
      packages: write
      # SBOM / Provenance アテステーションの生成・登録に必要
      id-token: write
      attestations: write

    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to ghcr.io
        uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}

      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          # マルチアーキテクチャ（better-sqlite3はアーキごとにビルド）
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          # サプライチェーンセキュリティ: SBOM と Provenance アテステーションを付与
          sbom: true
          provenance: mode=max
```

---

## 14. パッケージ構成

- `packageManager` フィールドで pnpm を 11.2.2 に固定（corepack / pnpm/action-setup が参照）
- 本番は `tsc` でビルドした JavaScript を `node` で直接実行する。`tsx` は開発時（`dev` script）のみ使用

```json
{
  "name": "discord-mock",
  "version": "1.0.0",
  "description": "Discord REST API v10 Mock Server",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.2.2",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^25.9.2",
    "@vitest/coverage-v8": "^4.1.8",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  },
  "dependencies": {
    "@hono/node-server": "^2.0.4",
    "better-sqlite3": "^12.10.0",
    "discord-api-types": "^0.38.48",
    "hono": "^4.12.23"
  }
}
```

TypeScript 設定は型チェック用とビルド用の 2 ファイル構成:

```json
// tsconfig.json（型チェック用: テストコードを含む全ソースが対象）
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": false,
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true,
    "esModuleInterop": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

```json
// tsconfig.build.json（本番ビルド用: テストコード・テストヘルパーを dist への出力から除外）
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/test-helpers.ts"]
}
```

pnpm のビルドスクリプト許可設定（pnpm 11 はデフォルトで依存パッケージのビルドスクリプトを実行しないため、明示的な許可が必要）:

```yaml
# pnpm-workspace.yaml
# better-sqlite3: ネイティブモジュールのコンパイルに必要
# esbuild: バイナリ配置スクリプトの実行に必要（vitest / tsx が使用）
allowBuilds:
  better-sqlite3: true
  esbuild: true
```
