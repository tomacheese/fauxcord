import { GatewayOp } from './opcodes'
import { encodePayload } from './protocol'
import { hasIntent } from './intents'
import type { Session, SessionManager } from './session'

/**
 * 単一セッションへ Dispatch (op0) イベントを送信し、seq とリプレイバッファを更新する。
 * @param manager - セッションマネージャ
 * @param session - 送信先セッション
 * @param eventName - Dispatch イベント名（例: "MESSAGE_CREATE"）
 * @param data - イベントデータ
 */
export function sendDispatch(
  manager: SessionManager,
  session: Session,
  eventName: string,
  data: unknown
): void {
  const seq = manager.nextSeq(session)
  const payload = {
    op: GatewayOp.Dispatch as number,
    t: eventName,
    s: seq,
    d: data,
  }
  manager.pushToReplayBuffer(session, payload)
  session.ws.send(encodePayload(payload))
}

/**
 * 指定した Bot に紐づく全セッションへ Dispatch イベントをブロードキャストする。
 * requiredIntent が指定された場合、その Intent を持つセッションにのみ送信する。
 * @param manager - セッションマネージャ
 * @param botId - 配信先 Bot の ID
 * @param eventName - Dispatch イベント名
 * @param data - イベントデータ
 * @param requiredIntent - 送信に必要な Intent ビット（省略時は無条件で送信）
 */
export function broadcastToBot(
  manager: SessionManager,
  botId: string,
  eventName: string,
  data: unknown,
  requiredIntent?: number
): void {
  for (const session of manager.getByBotId(botId)) {
    if (
      requiredIntent !== undefined &&
      !hasIntent(session.intents, requiredIntent)
    ) {
      continue
    }
    sendDispatch(manager, session, eventName, data)
  }
}
