/**
 * Discord Gateway WebSocket ハンドラ
 *
 * Hono の `upgradeWebSocket` に渡す `WSEvents` を構築し、Hello/Identify/
 * Heartbeat/Resume/Ready/Invalid Session/Reconnect を処理する。
 */

import type { WSContext, WSEvents } from 'hono/ws'
import type { Database } from '../db'
import { SessionManager, type Session } from './session'
import { GatewayOp, GatewayCloseCode } from './opcodes'
import { encodePayload, decodePayload } from './protocol'
import type { IdentifyData, ResumeData } from './protocol'

/** HELLO で通知する Heartbeat 間隔 (ms)。実 Discord のデフォルト値。 */
const HEARTBEAT_INTERVAL_MS = 41_250
/** Heartbeat が届かない場合にセッションを閉じるまでの許容時間 (ms) */
const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2

/**
 * Identify のトークンから Bot を解決する。DISABLE_AUTH=true の場合は REST と同様に
 * 任意のトークンを許可し、未登録トークンは MockBot として扱う。
 * @param db - データベース
 * @param disableAuth - 認証バイパスフラグ
 * @param token - Identify の token フィールド
 * @returns 解決された Bot 情報。認証失敗時は undefined
 */
function resolveBotForIdentify(
  db: Database,
  disableAuth: boolean,
  token: string
): { userId: string; username: string } | undefined {
  const row = db
    .prepare('SELECT user_id, username FROM bots WHERE token = ?')
    .get(token) as { user_id: string; username: string } | undefined
  if (row) return { userId: row.user_id, username: row.username }
  if (disableAuth) return { userId: '0', username: 'MockBot' }
  return undefined
}

/**
 * Intent ビットフィールドの形式的な妥当性を検証する（負数・非整数を拒否）。
 * Privileged Intent の権限チェックはスコープ外のため常に許可する。
 * @param intents - Identify の intents フィールド
 * @returns 妥当なら true
 */
function isValidIntents(intents: number): boolean {
  return Number.isInteger(intents) && intents >= 0
}

/**
 * Checks whether the given unknown value is a valid IDENTIFY payload shape.
 * @param d - the `d` field of a decoded Gateway payload
 * @returns true if `d` has the required `token`/`intents` fields
 */
function isIdentifyData(d: unknown): d is IdentifyData {
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof (d as { token?: unknown }).token === 'string' &&
    typeof (d as { intents?: unknown }).intents === 'number'
  )
}

/**
 * Checks whether the given unknown value is a valid RESUME payload shape.
 * @param d - the `d` field of a decoded Gateway payload
 * @returns true if `d` has the required `token`/`session_id`/`seq` fields
 */
function isResumeData(d: unknown): d is ResumeData {
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof (d as { token?: unknown }).token === 'string' &&
    typeof (d as { session_id?: unknown }).session_id === 'string' &&
    typeof (d as { seq?: unknown }).seq === 'number'
  )
}

/**
 * http(s) の baseUrl を ws(s) URL へ変換する。
 * @param baseUrl - 変換対象の baseUrl
 * @returns ws(s) URL
 */
function toWsUrl(baseUrl: string): string {
  if (baseUrl.startsWith('https://'))
    return `wss://${baseUrl.slice('https://'.length)}`
  if (baseUrl.startsWith('http://'))
    return `ws://${baseUrl.slice('http://'.length)}`
  return baseUrl
}

/**
 * Heartbeat タイムアウト監視タイマーを（再）設定する。
 * @param sessionManager - セッションマネージャ
 * @param ws - 接続中の WebSocket コンテキスト
 * @param sessionId - セッション ID
 */
function armHeartbeatTimeout(
  sessionManager: SessionManager,
  ws: WSContext,
  sessionId: string
): void {
  const session = sessionManager.get(sessionId)
  if (!session) return
  if (session.heartbeatTimer) clearTimeout(session.heartbeatTimer)
  session.heartbeatTimer = setTimeout(() => {
    ws.close(GatewayCloseCode.SessionTimedOut, 'Session timed out')
    sessionManager.remove(sessionId)
  }, HEARTBEAT_TIMEOUT_MS)
}

/**
 * IDENTIFY (op2) を処理し、認証成功時に READY (op0) を送る。
 * @param db - データベース
 * @param options - baseUrl・disableAuth
 * @param sessionManager - セッションマネージャ
 * @param sessionIdByWs - WSContext→sessionId のマップ
 * @param ws - 接続中の WebSocket コンテキスト
 * @param data - IDENTIFY のペイロード
 */
function handleIdentify(
  db: Database,
  options: { baseUrl: string; disableAuth: boolean },
  sessionManager: SessionManager,
  sessionIdByWs: WeakMap<WSContext, string>,
  ws: WSContext,
  data: IdentifyData
): void {
  const bot = resolveBotForIdentify(db, options.disableAuth, data.token)
  if (!bot) {
    ws.close(GatewayCloseCode.AuthenticationFailed, 'Authentication failed')
    return
  }
  if (!isValidIntents(data.intents)) {
    ws.close(GatewayCloseCode.InvalidIntents, 'Invalid intent(s)')
    return
  }

  const session = sessionManager.create({
    botId: bot.userId,
    token: data.token,
    intents: data.intents,
    ws: ws.raw as never, // hono/ws の WSContext.raw は基盤の ws.WebSocket インスタンス
  })
  sessionIdByWs.set(ws, session.sessionId)
  armHeartbeatTimeout(sessionManager, ws, session.sessionId)

  ws.send(
    encodePayload({
      op: GatewayOp.Dispatch,
      t: 'READY',
      s: sessionManager.nextSeq(session),
      d: {
        v: 10,
        user: { id: bot.userId, username: bot.username, bot: true },
        guilds: [],
        session_id: session.sessionId,
        resume_gateway_url: toWsUrl(options.baseUrl),
      },
    })
  )
}

/**
 * RESUME (op6) を処理する。
 * @param sessionManager - セッションマネージャ
 * @param sessionIdByWs - WSContext→sessionId のマップ
 * @param ws - 接続中の WebSocket コンテキスト
 * @param data - RESUME のペイロード
 */
function handleResume(
  sessionManager: SessionManager,
  sessionIdByWs: WeakMap<WSContext, string>,
  ws: WSContext,
  data: ResumeData
): void {
  const session = sessionManager.get(data.session_id)
  if (session?.token !== data.token) {
    ws.send(encodePayload({ op: GatewayOp.InvalidSession, d: false }))
    return
  }
  const replay = sessionManager.replayFrom(session, data.seq)
  if (!replay) {
    ws.send(encodePayload({ op: GatewayOp.InvalidSession, d: false }))
    return
  }
  session.ws = ws.raw as never
  sessionIdByWs.set(ws, session.sessionId)
  armHeartbeatTimeout(sessionManager, ws, session.sessionId)
  for (const entry of replay) {
    ws.send(encodePayload(entry.event))
  }
  ws.send(
    encodePayload({
      op: GatewayOp.Dispatch,
      t: 'RESUMED',
      s: session.seq,
      d: {},
    })
  )
}

/**
 * HEARTBEAT (op1) を処理し、ACK (op11) を返してタイムアウトタイマーを再設定する。
 * @param sessionManager - セッションマネージャ
 * @param sessionIdByWs - WSContext→sessionId のマップ
 * @param ws - 接続中の WebSocket コンテキスト
 */
function handleHeartbeat(
  sessionManager: SessionManager,
  sessionIdByWs: WeakMap<WSContext, string>,
  ws: WSContext
): void {
  const sessionId = sessionIdByWs.get(ws)
  const session = sessionId ? sessionManager.get(sessionId) : undefined
  ws.send(encodePayload({ op: GatewayOp.HeartbeatAck, d: null }))
  if (session) {
    session.lastHeartbeatAt = Date.now()
    armHeartbeatTimeout(sessionManager, ws, session.sessionId)
  }
}

/**
 * Gateway WebSocket ハンドラを構築する。
 * @param db - データベース（Identify のトークン検証・MockBot 生成に使用）
 * @param options - baseUrl・disableAuth
 * @returns Hono の upgradeWebSocket に渡す WSEvents と、Dispatch 配信に使う SessionManager
 */
export function createGatewayWebSocketHandler(
  db: Database,
  options: { baseUrl: string; disableAuth: boolean }
): { upgrade: WSEvents; sessionManager: SessionManager } {
  const sessionManager = new SessionManager()
  // ws (WSContext) → sessionId の対応。onClose/onMessage で参照する。
  const sessionIdByWs = new WeakMap<WSContext, string>()

  const upgrade: WSEvents = {
    onOpen: (_event, ws) => {
      ws.send(
        encodePayload({
          op: GatewayOp.Hello,
          d: { heartbeat_interval: HEARTBEAT_INTERVAL_MS },
        })
      )
    },
    onMessage: (event, ws) => {
      // event.data は WSMessageReceive (string | Blob | ArrayBufferLike) だが、
      // Gateway クライアントは常に JSON テキストフレームを送る想定のため、
      // 文字列以外は不正なメッセージとして無視する。
      if (typeof event.data !== 'string') return
      const payload = decodePayload(event.data)
      if (!payload) return

      switch (payload.op) {
        case GatewayOp.Identify: {
          if (!isIdentifyData(payload.d)) {
            ws.close(
              GatewayCloseCode.AuthenticationFailed,
              'Authentication failed'
            )
            break
          }
          handleIdentify(
            db,
            options,
            sessionManager,
            sessionIdByWs,
            ws,
            payload.d
          )
          break
        }
        case GatewayOp.Resume: {
          if (!isResumeData(payload.d)) {
            ws.send(encodePayload({ op: GatewayOp.InvalidSession, d: false }))
            break
          }
          handleResume(sessionManager, sessionIdByWs, ws, payload.d)
          break
        }
        case GatewayOp.Heartbeat: {
          handleHeartbeat(sessionManager, sessionIdByWs, ws)
          break
        }
        default: {
          // 未知の opcode は無視する（実 Discord もクライアントからの未知opは無視する）
          break
        }
      }
    },
    onClose: (_event, ws) => {
      const sessionId = sessionIdByWs.get(ws)
      if (sessionId) sessionManager.remove(sessionId)
    },
  }

  return { upgrade, sessionManager }
}

/**
 * セッションに RECONNECT (op7) を送信し、クライアントに再接続（再 Identify または
 * Resume）を促したうえで切断する。サーバー都合でセッションを終了させたい場合
 * （プロセス終了時のグレースフルシャットダウン等）に使用する。
 * @param session - 対象セッション
 */
export function sendReconnect(session: Session): void {
  session.ws.send(encodePayload({ op: GatewayOp.Reconnect, d: null }))
  session.ws.close(1000, 'Reconnect requested')
}
