/** Gateway 上でやり取りされる汎用ペイロード形式 */
export interface GatewayPayload<T> {
  /** opcode */
  op: number
  /** イベント固有のデータ */
  d: T
  /** Dispatch のシーケンス番号（Dispatch 以外は null/undefined） */
  s?: number | null
  /** Dispatch イベント名（Dispatch 以外は null/undefined） */
  t?: string | null
}

/** HELLO (op10) のデータ */
export interface HelloData {
  /** クライアントが送るべき Heartbeat 間隔 (ms) */
  heartbeat_interval: number
}

/** IDENTIFY (op2) のデータ */
export interface IdentifyData {
  /** Bot トークン（"Bot " プレフィックスを含む） */
  token: string
  /** Intent ビットフィールド */
  intents: number
  /** クライアントのプロパティ情報（未検証のまま許容） */
  properties?: Record<string, unknown>
}

/** RESUME (op6) のデータ */
export interface ResumeData {
  /** Bot トークン */
  token: string
  /** 再開対象のセッション ID */
  session_id: string
  /** 最後に受信したシーケンス番号 */
  seq: number
}

/**
 * Gateway ペイロードを JSON テキストへエンコードする。
 * @param payload - エンコード対象のペイロード
 * @returns JSON 文字列
 */
export function encodePayload(payload: GatewayPayload<unknown>): string {
  return JSON.stringify(payload)
}

/**
 * JSON テキストを Gateway ペイロードへデコードする。
 * @param raw - WebSocket から受信した生テキスト
 * @returns デコードされたペイロード。不正な JSON の場合は undefined
 */
export function decodePayload(
  raw: string
): GatewayPayload<unknown> | undefined {
  try {
    return JSON.parse(raw) as GatewayPayload<unknown>
  } catch {
    return undefined
  }
}
