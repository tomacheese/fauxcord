import type { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import type { GatewayPayload } from './protocol'

/** リプレイバッファに保持するイベント数の上限 */
const REPLAY_BUFFER_SIZE = 100

/** 単一の Gateway 接続（セッション）を表す */
export interface Session {
  /** セッション ID（Resume 時に使用） */
  sessionId: string
  /** 接続元 Bot の ID（bots.token に対応するユーザー ID） */
  botId: string
  /** Identify で送られた Bot トークン */
  token: string
  /** 直近の Dispatch シーケンス番号 */
  seq: number
  /** Identify で受け取った Intent ビットフィールド */
  intents: number
  /** 接続中の WebSocket */
  ws: WebSocket
  /** Resume 用のリプレイバッファ（直近 REPLAY_BUFFER_SIZE 件） */
  replayBuffer: { seq: number; event: GatewayPayload<unknown> }[]
  /** Heartbeat タイムアウト監視用タイマー */
  heartbeatTimer: NodeJS.Timeout | undefined
  /** 直近に Heartbeat を受信した時刻（ms epoch） */
  lastHeartbeatAt: number
}

/**
 * Gateway セッションの生成・検索・削除・リプレイバッファ管理を担う。
 */
export class SessionManager {
  private readonly sessionsById = new Map<string, Session>()
  private readonly sessionIdsByBotId = new Map<string, Set<string>>()

  /**
   * 新しいセッションを作成し登録する。
   * @param params - セッション初期化パラメータ
   * @returns 作成されたセッション
   */
  create(params: {
    botId: string
    token: string
    intents: number
    ws: WebSocket
  }): Session {
    const session: Session = {
      sessionId: randomUUID().replaceAll('-', ''),
      botId: params.botId,
      token: params.token,
      seq: 0,
      intents: params.intents,
      ws: params.ws,
      replayBuffer: [],
      heartbeatTimer: undefined,
      lastHeartbeatAt: Date.now(),
    }
    this.sessionsById.set(session.sessionId, session)
    const set = this.sessionIdsByBotId.get(session.botId) ?? new Set<string>()
    set.add(session.sessionId)
    this.sessionIdsByBotId.set(session.botId, set)
    return session
  }

  /**
   * セッション ID からセッションを取得する。
   * @param sessionId - セッション ID
   * @returns セッション。存在しない場合は undefined
   */
  get(sessionId: string): Session | undefined {
    return this.sessionsById.get(sessionId)
  }

  /**
   * 指定した Bot ID に紐づく全セッションを取得する。
   * @param botId - Bot の ID
   * @returns セッションの配列
   */
  getByBotId(botId: string): Session[] {
    const ids = this.sessionIdsByBotId.get(botId)
    if (!ids) return []
    return [...ids]
      .map((id) => this.sessionsById.get(id))
      .filter((s): s is Session => s !== undefined)
  }

  /**
   * 現在接続中の全セッションを取得する。
   * @returns セッションの配列
   */
  getAll(): Session[] {
    return [...this.sessionsById.values()]
  }

  /**
   * セッションを削除する。
   * @param sessionId - 削除対象のセッション ID
   */
  remove(sessionId: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return
    if (session.heartbeatTimer) clearTimeout(session.heartbeatTimer)
    this.sessionsById.delete(sessionId)
    this.sessionIdsByBotId.get(session.botId)?.delete(sessionId)
  }

  /**
   * シーケンス番号を1つ進めて返す。
   * @param session - 対象セッション
   * @returns 新しいシーケンス番号
   */
  nextSeq(session: Session): number {
    session.seq += 1
    return session.seq
  }

  /**
   * リプレイバッファにイベントを追加する。上限を超えた古いイベントは破棄する。
   * @param session - 対象セッション
   * @param event - 追加するイベント
   */
  pushToReplayBuffer(session: Session, event: GatewayPayload<unknown>): void {
    session.replayBuffer.push({ seq: event.s ?? session.seq, event })
    if (session.replayBuffer.length > REPLAY_BUFFER_SIZE) {
      session.replayBuffer.shift()
    }
  }

  /**
   * 指定した seq より後のイベントをリプレイ用に取得する。
   * @param session - 対象セッション
   * @param seq - クライアントが最後に受信した seq
   * @returns リプレイすべきイベント一覧。seq がバッファより古く再現できない場合は undefined
   */
  replayFrom(
    session: Session,
    seq: number
  ): { seq: number; event: GatewayPayload<unknown> }[] | undefined {
    if (session.replayBuffer.length === 0) {
      return seq === session.seq ? [] : undefined
    }
    const oldestSeq = session.replayBuffer[0]?.seq ?? 0
    if (seq < oldestSeq - 1) {
      return undefined
    }
    return session.replayBuffer.filter((entry) => entry.seq > seq)
  }
}
