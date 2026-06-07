# Discord Mock Server — API仕様書

> バージョン: 1.0.0  
> 対象 Discord API バージョン: **v10**  
> 最終更新: 2026-06-07

---

## 目次

1. [概要](#1-概要)
2. [ベースURL・バージョニング](#2-ベースurlバージョニング)
3. [認証](#3-認証)
4. [Rate Limitヘッダー](#4-rate-limitヘッダー)
5. [エラーフォーマット](#5-エラーフォーマット)
6. [Snowflake ID](#6-snowflake-id)
7. [ページネーション](#7-ページネーション)
8. [バリデーション制限](#8-バリデーション制限)
9. [Channels API](#9-channels-api)
10. [Guilds API](#10-guilds-api)
11. [Users API](#11-users-api)
12. [Webhooks API](#12-webhooks-api)
13. [OAuth2 API](#13-oauth2-api)
14. [テスト制御 API（/_test/）](#14-テスト制御-api_test)
15. [インフラ API（/_mock/）](#15-インフラ-api_mock)
16. [Discordエラーコード一覧](#16-discordエラーコード一覧)

---

## 1. 概要

本サーバは Discord REST API v10 の挙動を再現するモックサーバです。  
実サービスへの接続なしに、Discordボットやアプリケーションのインテグレーションテストを行えます。

### 設計方針

- Discord API v10 との**完全互換**を目指す
- メッセージのPOST→GETなど、**ステートフルな一貫性**を保証する
- テスト用の制御エンドポイント（`/_test/*`）を提供する
- WebSocket（Gateway）は対象外（REST・Webhook のみ）

---

## 2. ベースURL・バージョニング

### サポートするパス形式

| パス形式 | 動作 |
|---|---|
| `/api/v10/{endpoint}` | v10 として処理（推奨） |
| `/api/{endpoint}` | v10 として処理 |
| `/{endpoint}` | v10 として処理 |

**非サポートバージョン（v6〜v9）へのリクエストは `400` を返します。**

```
GET /api/v9/channels/123
→ 400 Bad Request
{
  "message": "400: Bad Request",
  "code": 50041
}
```

### デフォルトベースURL

```
http://localhost:3000
```

`BASE_URL` 環境変数で変更可能です。

---

## 3. 認証

### Bot トークン認証

```
Authorization: Bot <token>
```

事前に `/_test/setup` で登録されたトークンのみ有効です。  
未登録のトークンは `401` を返します。

```json
{
  "message": "401: Unauthorized",
  "code": 0
}
```

`DISABLE_AUTH=true` 環境変数を設定すると、任意のトークンを全て許可します。

### Bearer トークン認証

OAuth2 フローで取得したアクセストークンを使用します。

```
Authorization: Bearer <access_token>
```

### 認証不要エンドポイント

- `POST /api/v10/webhooks/{id}/{token}` （Webhook実行）
- `GET /_mock/health`

---

## 4. Rate Limitヘッダー

全レスポンスに以下のヘッダーを付与します。  
モックサーバは実際にはレート制限を行いません（ダミー値）。

| ヘッダー | 値（ダミー） | 説明 |
|---|---|---|
| `X-RateLimit-Limit` | `5` | バケット内の最大リクエスト数 |
| `X-RateLimit-Remaining` | `4` | 残りリクエスト数 |
| `X-RateLimit-Reset` | `<現在時刻 + 1秒のUnix timestamp>` | リセット時刻 |
| `X-RateLimit-Reset-After` | `1.000` | リセットまでの秒数 |
| `X-RateLimit-Bucket` | `mock-bucket-{endpoint}` | バケットID |
| `X-RateLimit-Scope` | `user` | スコープ |

---

## 5. エラーフォーマット

Discord API 互換のエラーレスポンスを返します。

### 基本形式

```json
{
  "message": "エラーメッセージ",
  "code": 10003
}
```

### バリデーションエラー形式

```json
{
  "message": "Invalid Form Body",
  "code": 50035,
  "errors": {
    "content": {
      "_errors": [
        {
          "code": "BASE_TYPE_MAX_LENGTH",
          "message": "Must be 2000 or fewer in length."
        }
      ]
    }
  }
}
```

---

## 6. Snowflake ID

Discord 互換の Snowflake ID を自動採番します。

### フォーマット（64bit整数）

```
111111111111111111111111111111111111111111 11111 11111 111111111111
|                                         |     |     |
42bit: Discord Epoch からのミリ秒          5bit  5bit  12bit インクリメント
       (2015-01-01T00:00:00.000Z)         WID   PID
```

- **Discord Epoch**: `1420070400000` (2015-01-01 00:00:00 UTC)
- 文字列として返却（JavaScript の精度問題を避けるため）

### 手動指定

`/_test/setup` でギルド・チャンネルのIDを手動指定可能です。  
省略した場合は自動採番されます。

---

## 7. ページネーション

メッセージ一覧など、複数リソース返却エンドポイントでは以下のクエリパラメータを使用します。

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `limit` | integer | `50` | 取得件数（1〜100） |
| `before` | snowflake | - | 指定IDより前のメッセージを取得 |
| `after` | snowflake | - | 指定IDより後のメッセージを取得 |
| `around` | snowflake | - | 指定IDの前後を取得（`limit`は偶数に丸める） |

`before`・`after`・`around` は排他です。複数指定した場合は `before` を優先します。

---

## 8. バリデーション制限

Discord API v10 と同一の制限を適用します。違反時は `400 / code: 50035` を返します。

### メッセージ

| フィールド | 制限 |
|---|---|
| `content` | 最大 2,000 文字 |
| `embeds` | 最大 10 個 |
| embed 合計文字数 | 最大 6,000 文字 |
| `attachments` | 最大 10 個 |
| ファイルサイズ | 最大 25MB（デフォルト） |

### Embed

| フィールド | 制限 |
|---|---|
| `title` | 最大 256 文字 |
| `description` | 最大 4,096 文字 |
| `fields` | 最大 25 個 |
| `field.name` | 最大 256 文字 |
| `field.value` | 最大 1,024 文字 |
| `footer.text` | 最大 2,048 文字 |
| `author.name` | 最大 256 文字 |

### Guild

| フィールド | 制限 |
|---|---|
| `name` | 2〜100 文字 |
| チャンネル数 | 最大 500 |
| ロール数 | 最大 250 |
| Webhook 数（チャンネル単位） | 最大 15 |
| Webhook 数（Guild 全体） | 最大 1,000 |

### Webhook

| フィールド | 制限 |
|---|---|
| `name` | 1〜80 文字 |
| `content` | 最大 2,000 文字 |
| `username` | 最大 80 文字 |
| `embeds` | 最大 10 個 |

---

## 9. Channels API

### GET /channels/{channel.id}

チャンネル情報を取得します。

**レスポンス 200**

```json
{
  "id": "1234567890123456789",
  "type": 0,
  "guild_id": "9876543210987654321",
  "position": 0,
  "name": "general",
  "topic": null,
  "nsfw": false,
  "last_message_id": null,
  "rate_limit_per_user": 0,
  "parent_id": null,
  "permission_overwrites": []
}
```

**エラー**
- `401` — 認証失敗
- `404 / code: 10003` — チャンネルが存在しない

---

### PATCH /channels/{channel.id}

チャンネル情報を更新します。

**リクエストボディ**（全フィールド任意）

```json
{
  "name": "new-name",
  "topic": "新しいトピック",
  "nsfw": false,
  "rate_limit_per_user": 5,
  "position": 1
}
```

**レスポンス 200** — 更新後のチャンネルオブジェクト

**エラー**
- `401` — 認証失敗
- `404 / code: 10003` — チャンネルが存在しない

---

### DELETE /channels/{channel.id}

チャンネルを削除します。

**レスポンス 200** — 削除したチャンネルオブジェクト

---

### GET /channels/{channel.id}/messages

メッセージ一覧を取得します。

**クエリパラメータ** — [ページネーション参照](#7-ページネーション)

**レスポンス 200**

```json
[
  {
    "id": "1234567890123456789",
    "channel_id": "9876543210987654321",
    "author": {
      "id": "1111111111111111111",
      "username": "TestBot",
      "discriminator": "0",
      "bot": true,
      "avatar": null
    },
    "content": "Hello World",
    "timestamp": "2026-06-07T00:00:00.000Z",
    "edited_timestamp": null,
    "tts": false,
    "mention_everyone": false,
    "mentions": [],
    "mention_roles": [],
    "attachments": [],
    "embeds": [],
    "pinned": false,
    "type": 0
  }
]
```

---

### GET /channels/{channel.id}/messages/{message.id}

メッセージを1件取得します。

**レスポンス 200** — メッセージオブジェクト

**エラー**
- `404 / code: 10008` — メッセージが存在しない

---

### POST /channels/{channel.id}/messages

メッセージを送信します。

**Content-Type**
- `application/json` — テキスト・Embedのみ
- `multipart/form-data` — ファイル添付あり

**リクエストボディ（JSON）**

```json
{
  "content": "Hello",
  "tts": false,
  "embeds": [],
  "message_reference": {
    "message_id": "1234567890123456789"
  },
  "components": [],
  "flags": 0
}
```

**リクエストボディ（multipart/form-data）**

| フィールド | 型 | 説明 |
|---|---|---|
| `payload_json` | string | JSON文字列（上記と同じ） |
| `files[N]` | file | 添付ファイル（N = 0〜9） |

**レスポンス 200** — メッセージオブジェクト（`attachments` フィールド含む）

```json
{
  "attachments": [
    {
      "id": "0",
      "filename": "image.png",
      "size": 12345,
      "url": "http://localhost:3000/_mock/attachments/CHANNEL_ID/MESSAGE_ID/image.png",
      "proxy_url": "http://localhost:3000/_mock/attachments/CHANNEL_ID/MESSAGE_ID/image.png",
      "content_type": "image/png"
    }
  ]
}
```

**エラー**
- `400 / code: 50006` — content・embeds・attachments が全て空
- `404 / code: 10003` — チャンネルが存在しない

---

### PATCH /channels/{channel.id}/messages/{message.id}

メッセージを編集します。

**リクエストボディ**（全フィールド任意）

```json
{
  "content": "編集後テキスト",
  "embeds": [],
  "attachments": []
}
```

**レスポンス 200** — 編集後のメッセージオブジェクト

**エラー**
- `403 / code: 50005` — 他ユーザーのメッセージを編集しようとした
- `404 / code: 10008` — メッセージが存在しない

---

### DELETE /channels/{channel.id}/messages/{message.id}

メッセージを削除します。

**レスポンス 204 No Content**

---

### POST /channels/{channel.id}/messages/bulk-delete

メッセージを一括削除します（2〜100件）。

**リクエストボディ**

```json
{
  "messages": ["1234567890123456789", "1234567890123456790"]
}
```

**レスポンス 204 No Content**

**エラー**
- `400 / code: 50016` — 件数が範囲外（2未満 or 100超）
- `400 / code: 50034` — 2週間以上前のメッセージが含まれる

---

### PUT /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me

リアクションを追加します。

- `emoji` は URL エンコードされた絵文字（例: `%F0%9F%91%8D`）またはカスタム絵文字（`name:id`形式）

**レスポンス 204 No Content**

---

### DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me

自分のリアクションを削除します。

**レスポンス 204 No Content**

---

### GET /channels/{channel.id}/messages/{message.id}/reactions/{emoji}

リアクションしたユーザー一覧を取得します。

**クエリパラメータ**

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `after` | - | ページネーション |
| `limit` | `25` | 最大 100 |

**レスポンス 200** — ユーザーオブジェクトの配列

---

### DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}

指定絵文字の全リアクションを削除します。

**レスポンス 204 No Content**

---

### DELETE /channels/{channel.id}/messages/{message.id}/reactions

全リアクションを削除します。

**レスポンス 204 No Content**

---

### GET /channels/{channel.id}/pins

ピン留めメッセージ一覧を取得します（最大50件）。

**レスポンス 200** — メッセージオブジェクトの配列

---

### PUT /channels/{channel.id}/pins/{message.id}

メッセージをピン留めします。

**レスポンス 204 No Content**

**エラー**
- `400 / code: 30003` — ピン留め上限（50件）超過

---

### DELETE /channels/{channel.id}/pins/{message.id}

ピン留めを解除します。

**レスポンス 204 No Content**

---

### GET /channels/{channel.id}/webhooks

チャンネルの Webhook 一覧を取得します。

**レスポンス 200** — Webhook オブジェクトの配列

---

### POST /channels/{channel.id}/webhooks

Webhook を作成します。

**リクエストボディ**

```json
{
  "name": "MyWebhook",
  "avatar": null
}
```

**レスポンス 200** — Webhook オブジェクト

**エラー**
- `400 / code: 30007` — Webhook 上限（15件/チャンネル）超過

---

## 10. Guilds API

### GET /guilds/{guild.id}

Guild 情報を取得します。

**クエリパラメータ**

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `with_counts` | `false` | `approximate_member_count` を含める |

**レスポンス 200**

```json
{
  "id": "9876543210987654321",
  "name": "Test Guild",
  "icon": null,
  "owner_id": "1111111111111111111",
  "afk_timeout": 300,
  "verification_level": 0,
  "default_message_notifications": 0,
  "explicit_content_filter": 0,
  "roles": [],
  "emojis": [],
  "features": [],
  "mfa_level": 0,
  "system_channel_id": null,
  "premium_tier": 0,
  "premium_subscription_count": 0,
  "preferred_locale": "en-US",
  "channels": []
}
```

**エラー**
- `404 / code: 10004` — Guild が存在しない

---

### GET /guilds/{guild.id}/channels

Guild のチャンネル一覧を取得します。

**レスポンス 200** — チャンネルオブジェクトの配列

---

### POST /guilds/{guild.id}/channels

チャンネルを作成します。

**リクエストボディ**

```json
{
  "name": "new-channel",
  "type": 0,
  "topic": null,
  "nsfw": false,
  "parent_id": null,
  "position": null
}
```

**レスポンス 201** — チャンネルオブジェクト

**エラー**
- `400 / code: 30013` — チャンネル上限（500）超過

---

### GET /guilds/{guild.id}/members

メンバー一覧を取得します。

**クエリパラメータ**

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `limit` | `1` | 最大 1,000 |
| `after` | `0` | ページネーション |

**レスポンス 200** — Guild Member オブジェクトの配列

---

### GET /guilds/{guild.id}/members/{user.id}

特定メンバーを取得します。

**レスポンス 200**

```json
{
  "user": {
    "id": "1111111111111111111",
    "username": "TestUser",
    "discriminator": "0",
    "avatar": null,
    "bot": false
  },
  "nick": null,
  "roles": [],
  "joined_at": "2026-01-01T00:00:00.000Z",
  "deaf": false,
  "mute": false,
  "flags": 0
}
```

**エラー**
- `404 / code: 10007` — メンバーが存在しない

---

### GET /guilds/{guild.id}/roles

ロール一覧を取得します。

**レスポンス 200** — Role オブジェクトの配列

---

### POST /guilds/{guild.id}/roles

ロールを作成します。

**リクエストボディ**（全フィールド任意）

```json
{
  "name": "new role",
  "permissions": "0",
  "color": 0,
  "hoist": false,
  "mentionable": false
}
```

**レスポンス 200** — Role オブジェクト

**エラー**
- `400 / code: 30005` — ロール上限（250）超過

---

### GET /guilds/{guild.id}/webhooks

Guild の全 Webhook を取得します。

**レスポンス 200** — Webhook オブジェクトの配列

---

## 11. Users API

### GET /users/@me

認証済みユーザー（Bot）の情報を取得します。

**レスポンス 200**

```json
{
  "id": "1111111111111111111",
  "username": "TestBot",
  "discriminator": "0",
  "avatar": null,
  "bot": true,
  "flags": 0,
  "public_flags": 0
}
```

---

### GET /users/{user.id}

ユーザー情報を取得します。

**レスポンス 200**

```json
{
  "id": "1111111111111111111",
  "username": "TestUser",
  "discriminator": "0",
  "avatar": null,
  "bot": false,
  "public_flags": 0
}
```

**エラー**
- `404 / code: 10013` — ユーザーが存在しない

---

### GET /users/@me/guilds

Bot が参加している Guild 一覧を取得します。

**レスポンス 200**

```json
[
  {
    "id": "9876543210987654321",
    "name": "Test Guild",
    "icon": null,
    "owner": false,
    "permissions": "0",
    "features": []
  }
]
```

---

### GET /applications/@me

アプリケーション情報を取得します。

**レスポンス 200**

```json
{
  "id": "1111111111111111111",
  "name": "TestBot",
  "icon": null,
  "description": "",
  "bot_public": true,
  "bot_require_code_grant": false,
  "owner": {
    "id": "1111111111111111111",
    "username": "TestUser",
    "discriminator": "0",
    "avatar": null
  }
}
```

---

## 12. Webhooks API

### GET /webhooks/{webhook.id}

Webhook 情報を取得します。

**レスポンス 200**

```json
{
  "id": "1234567890123456789",
  "type": 1,
  "guild_id": "9876543210987654321",
  "channel_id": "1111111111111111111",
  "name": "MyWebhook",
  "avatar": null,
  "token": "abcdefg1234567"
}
```

---

### GET /webhooks/{webhook.id}/{webhook.token}

トークンで Webhook 情報を取得します。Bot 認証不要。

**レスポンス 200** — Webhook オブジェクト（`user` フィールドなし）

---

### PATCH /webhooks/{webhook.id}

Webhook を更新します。

**リクエストボディ**

```json
{
  "name": "NewName",
  "channel_id": "1234567890123456789"
}
```

**レスポンス 200** — 更新後の Webhook オブジェクト

---

### DELETE /webhooks/{webhook.id}

Webhook を削除します。

**レスポンス 204 No Content**

---

### POST /webhooks/{webhook.id}/{webhook.token}

Webhook を実行します（メッセージ送信）。Bot 認証不要。

**クエリパラメータ**

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `wait` | `false` | `true` のとき作成されたメッセージを返す |
| `thread_id` | - | 送信先スレッドID |

**Content-Type**
- `application/json`
- `multipart/form-data`

**リクエストボディ（JSON）**

```json
{
  "content": "Hello",
  "username": "CustomName",
  "avatar_url": "https://example.com/avatar.png",
  "tts": false,
  "embeds": [],
  "allowed_mentions": {}
}
```

**レスポンス**
- `wait=false`: `204 No Content`
- `wait=true`: `200` — メッセージオブジェクト

---

### GET /webhooks/{webhook.id}/{webhook.token}/messages/{message.id}

Webhook が送信したメッセージを取得します。

**レスポンス 200** — メッセージオブジェクト

---

### PATCH /webhooks/{webhook.id}/{webhook.token}/messages/{message.id}

Webhook が送信したメッセージを編集します。

**レスポンス 200** — 編集後のメッセージオブジェクト

---

### DELETE /webhooks/{webhook.id}/{webhook.token}/messages/{message.id}

Webhook が送信したメッセージを削除します。

**レスポンス 204 No Content**

---

## 13. OAuth2 API

### GET /oauth2/@me

現在のアクセストークンの情報を取得します。

**レスポンス 200**

```json
{
  "application": {
    "id": "1111111111111111111",
    "name": "TestBot",
    "icon": null,
    "description": "",
    "bot_public": true,
    "bot_require_code_grant": false
  },
  "scopes": ["identify", "guilds"],
  "expires": "2026-07-07T00:00:00.000Z",
  "user": {
    "id": "2222222222222222222",
    "username": "TestUser",
    "discriminator": "0",
    "avatar": null
  }
}
```

---

### Authorization Code Flow

#### GET /oauth2/authorize

ブラウザリダイレクト用エンドポイント。

**クエリパラメータ**

| パラメータ | 必須 | 説明 |
|---|---|---|
| `client_id` | ✅ | アプリケーションID |
| `redirect_uri` | ✅ | リダイレクトURI |
| `response_type` | ✅ | `code` 固定 |
| `scope` | ✅ | スペース区切りのスコープ |
| `state` | — | CSRF防止用トークン |

**レスポンス** — `redirect_uri?code={code}&state={state}` へリダイレクト

**注意**: モックサーバは認証画面を表示せず即座にリダイレクトします。

---

#### POST /oauth2/token（Authorization Code）

認可コードをアクセストークンに交換します。

**Content-Type**: `application/x-www-form-urlencoded`

**リクエストボディ**

| フィールド | 必須 | 説明 |
|---|---|---|
| `grant_type` | ✅ | `authorization_code` |
| `code` | ✅ | 認可コード |
| `redirect_uri` | ✅ | 登録済みリダイレクトURI |

**レスポンス 200**

```json
{
  "access_token": "mock_access_token_xxxxxx",
  "token_type": "Bearer",
  "expires_in": 604800,
  "refresh_token": "mock_refresh_token_xxxxxx",
  "scope": "identify guilds"
}
```

---

#### POST /oauth2/token（Client Credentials）

クライアント認証情報でアクセストークンを取得します。

**Content-Type**: `application/x-www-form-urlencoded`

**リクエストボディ**

| フィールド | 必須 | 説明 |
|---|---|---|
| `grant_type` | ✅ | `client_credentials` |
| `scope` | ✅ | スペース区切りのスコープ |

**レスポンス 200**

```json
{
  "access_token": "mock_access_token_xxxxxx",
  "token_type": "Bearer",
  "expires_in": 604800,
  "scope": "identify guilds"
}
```

---

#### POST /oauth2/token/revoke

トークンを無効化します。

**Content-Type**: `application/x-www-form-urlencoded`

**リクエストボディ**

| フィールド | 必須 | 説明 |
|---|---|---|
| `token` | ✅ | 無効化するトークン |

**レスポンス 200** `{}`

---

### サポートスコープ

| スコープ | 説明 |
|---|---|
| `identify` | ユーザー情報取得 |
| `email` | メールアドレス取得 |
| `guilds` | 参加Guild一覧 |
| `guilds.join` | Guildへの追加 |
| `guilds.members.read` | Guildメンバー情報 |
| `bot` | ボットとしての操作 |
| `webhook.incoming` | Webhook作成 |
| `applications.commands` | Slash Command登録 |

---

## 14. テスト制御 API（/_test/）

テスト専用の制御エンドポイントです。Discord API 本体には存在しません。

### POST /_test/setup

テスト環境（Bot・Guild・チャンネル）を登録します。

**リクエストボディ**

```json
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
        {
          "id": "1234567890123456789",
          "name": "general",
          "type": 0
        },
        {
          "name": "bot-log",
          "type": 0
        }
      ]
    }
  ]
}
```

- `id` フィールドは省略すると Snowflake 自動採番
- `user` フィールドは省略可（省略時はデフォルト値を使用）

**レスポンス 201**

```json
{
  "token": "Bot mytoken123",
  "user": { "id": "...", "username": "TestBot" },
  "guilds": [
    {
      "id": "9876543210987654321",
      "name": "Test Guild",
      "channels": [
        { "id": "1234567890123456789", "name": "general", "type": 0 },
        { "id": "auto-generated-id", "name": "bot-log", "type": 0 }
      ]
    }
  ]
}
```

**エラー**
- `409` — トークンが既に登録されている

---

### DELETE /_test/setup/{token}

登録した Bot トークンとその関連データを全て削除します。

**レスポンス 204 No Content**

---

### POST /_test/reset

全データをリセットします（登録済みトークン・Guild・チャンネルは保持）。

**リクエストボディ**（省略可）

```json
{
  "token": "Bot mytoken123"
}
```

- `token` を指定した場合：そのトークンのメッセージ・Webhookのみリセット
- 省略した場合：全トークンのデータをリセット

**レスポンス 204 No Content**

---

### GET /_test/messages/{channel.id}

チャンネルの全メッセージを取得します（ページネーションなし・テスト検証用）。

**レスポンス 200**

```json
{
  "messages": [
    {
      "id": "1234567890123456789",
      "content": "Hello",
      "author_token": "Bot mytoken123",
      "created_at": "2026-06-07T00:00:00.000Z"
    }
  ]
}
```

---

### GET /_test/webhooks/{channel.id}

チャンネルの全 Webhook を取得します。

**レスポンス 200** — Webhook オブジェクトの配列

---

## 15. インフラ API（/_mock/）

### GET /_mock/health

ヘルスチェックエンドポイント。Docker の `HEALTHCHECK` で使用します。

**レスポンス 200**

```json
{
  "status": "ok",
  "version": "1.0.0",
  "db": "ok",
  "uptime": 12345
}
```

DBへの接続が失敗している場合は `503` を返します。

---

### GET /_mock/attachments/{channel.id}/{message.id}/{filename}

添付ファイルを配信します。認証不要。

**レスポンス 200** — ファイルバイナリ（適切な `Content-Type` ヘッダー付き）

**エラー**
- `404` — ファイルが存在しない

---

## 16. Discordエラーコード一覧

モックサーバが返すエラーコードは Discord API v10 と完全互換です。

### 10xxx — リソース不明

| コード | メッセージ |
|---|---|
| `10003` | Unknown Channel |
| `10004` | Unknown Guild |
| `10007` | Unknown Member |
| `10008` | Unknown Message |
| `10011` | Unknown Role |
| `10012` | Unknown Token |
| `10013` | Unknown User |
| `10015` | Unknown Webhook |

### 30xxx — 上限超過

| コード | メッセージ |
|---|---|
| `30003` | Maximum number of pins reached for the channel (50) |
| `30005` | Maximum number of guild roles reached (250) |
| `30007` | Maximum number of webhooks reached (15) |
| `30013` | Maximum number of guild channels reached (500) |
| `30015` | Maximum number of attachments in a message reached (10) |

### 40xxx — その他エラー

| コード | メッセージ |
|---|---|
| `40001` | Unauthorized |
| `40005` | Request entity too large |
| `40041` | This message was already pinned |

### 50xxx — 操作不可

| コード | メッセージ |
|---|---|
| `50001` | Missing Access |
| `50005` | Cannot edit a message authored by another user |
| `50006` | Cannot send an empty message |
| `50013` | You lack permissions to perform that action |
| `50016` | Provided too many messages to delete |
| `50019` | A message can only be pinned to the channel it was sent in |
| `50034` | A message provided was too old to bulk delete |
| `50035` | Invalid Form Body |
| `50041` | Invalid API version provided |
| `50045` | File uploaded exceeds the maximum size |
