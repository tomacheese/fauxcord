/**
 * テスト制御サービス
 *
 * テスト環境のセットアップ・リセットを処理します。
 */

import type { Database } from '../db.js'
import { generateSnowflake } from '../snowflake.js'

/** テストセットアップリクエストの型 */
export interface SetupRequest {
  token: string
  user?: {
    id?: string
    username?: string
    discriminator?: string
  }
  guilds?: SetupGuildRequest[]
}

/** テストセットアップのGuild情報型 */
export interface SetupGuildRequest {
  id?: string
  name: string
  channels?: SetupChannelRequest[]
}

/** テストセットアップのChannel情報型 */
export interface SetupChannelRequest {
  id?: string
  name: string
  type?: number
}

/** テストセットアップレスポンスの型 */
export interface SetupResponse {
  token: string
  user: { id: string; username: string }
  guilds: {
    id: string
    name: string
    channels: { id: string; name: string; type: number }[]
  }[]
}

/**
 * テスト環境をセットアップします。
 * @param db - データベース
 * @param request - セットアップリクエスト
 * @returns セットアップ結果
 * @throws トークンが既に登録済みの場合エラー
 */
export function setupTestEnvironment(
  db: Database,
  request: SetupRequest
): SetupResponse {
  // トークン重複チェック
  const existing = db
    .prepare('SELECT token FROM bots WHERE token = ?')
    .get(request.token)
  if (existing) {
    throw new Error('CONFLICT')
  }

  const userId = request.user?.id ?? generateSnowflake()
  const username = request.user?.username ?? 'MockBot'
  const discriminator = request.user?.discriminator ?? '0'

  // トランザクションで実行し、途中でエラーが発生した場合に部分的な
  // セットアップ状態（Botだけ登録済みなど）が残らないようにする
  const setup = db.transaction((): SetupResponse => {
    // ユーザー作成
    db.prepare(
      'INSERT OR IGNORE INTO users (id, username, discriminator, bot) VALUES (?, ?, ?, 1)'
    ).run(userId, username, discriminator)

    // Bot作成
    db.prepare(
      'INSERT INTO bots (token, user_id, username, discriminator) VALUES (?, ?, ?, ?)'
    ).run(request.token, userId, username, discriminator)

    const guildsResponse: SetupResponse['guilds'] = []

    for (const guildReq of request.guilds ?? []) {
      const guildId = guildReq.id ?? generateSnowflake()

      // Guild作成（同一IDが残存していた場合は内容を上書きして再利用＝冪等）
      db.prepare(
        `INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           owner_id = excluded.owner_id,
           bot_token = excluded.bot_token`
      ).run(guildId, guildReq.name, userId, request.token)

      // @everyone ロールを自動作成（Discord API 仕様: Guild には必ず @everyone が存在する）
      // @everyone のロール ID は Guild ID と同一
      db.prepare(
        `INSERT OR IGNORE INTO roles (id, guild_id, name, permissions, position, color, hoist, mentionable)
         VALUES (?, ?, '@everyone', '1071698660929', 0, 0, 0, 0)`
      ).run(guildId, guildId)

      const channelsResponse: { id: string; name: string; type: number }[] = []

      for (const channelReq of guildReq.channels ?? []) {
        const channelId = channelReq.id ?? generateSnowflake()
        const channelType = channelReq.type ?? 0

        // Channel作成（同一IDが残存していた場合は内容を上書きして再利用＝冪等）
        db.prepare(
          `INSERT INTO channels (id, guild_id, name, type) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             guild_id = excluded.guild_id,
             name = excluded.name,
             type = excluded.type`
        ).run(channelId, guildId, channelReq.name, channelType)

        channelsResponse.push({
          id: channelId,
          name: channelReq.name,
          type: channelType,
        })
      }

      guildsResponse.push({
        id: guildId,
        name: guildReq.name,
        channels: channelsResponse,
      })
    }

    return {
      token: request.token,
      user: { id: userId, username },
      guilds: guildsResponse,
    }
  })

  return setup()
}

/**
 * Botトークンとその関連データを全て削除します。
 * @param db - データベース
 * @param token - 削除するBotトークン
 * @returns 削除成功ならtrue
 */
export function deleteTestSetup(db: Database, token: string): boolean {
  const bot = db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token)
  if (!bot) return false

  // Cascade Deleteで関連するGuild/Channel/Messageも削除される
  db.prepare('DELETE FROM bots WHERE token = ?').run(token)
  return true
}

/**
 * テストデータをリセットします（トークン・Guild・チャンネルは保持）。
 * @param db - データベース
 * @param token - リセット対象のBotトークン（省略時は全トークン）
 */
export function resetTestData(db: Database, token?: string): void {
  if (token) {
    // 特定トークンのメッセージ・Webhookのみリセット
    db.prepare('DELETE FROM messages WHERE author_token = ?').run(token)
    db.prepare(
      `DELETE FROM webhooks WHERE channel_id IN (
         SELECT c.id FROM channels c
         JOIN guilds g ON g.id = c.guild_id
         WHERE g.bot_token = ?
       )`
    ).run(token)
  } else {
    // 全データリセット（テーブル自体は保持）
    db.exec('DELETE FROM messages')
    db.exec('DELETE FROM webhooks')
    db.exec('DELETE FROM reactions')
    db.exec('DELETE FROM pins')
    db.exec('DELETE FROM embeds')
    db.exec('DELETE FROM attachments')
  }
}

/**
 * チャンネルの全メッセージをテスト用フォーマットで取得します。
 * @param db - データベース
 * @param channelId - チャンネルID
 * @returns メッセージ一覧
 */
export function getTestMessages(
  db: Database,
  channelId: string
): {
  id: string
  content: string
  author_token: string | null
  created_at: string
}[] {
  return db
    .prepare(
      'SELECT id, content, author_token, created_at FROM messages WHERE channel_id = ? ORDER BY id'
    )
    .all(channelId) as {
    id: string
    content: string
    author_token: string | null
    created_at: string
  }[]
}
