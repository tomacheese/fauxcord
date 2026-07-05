/** Generic payload envelope exchanged over the Gateway */
export interface GatewayPayload<T> {
  /** opcode */
  op: number
  /** Event-specific data */
  d: T
  /** Dispatch sequence number (null/undefined for non-Dispatch payloads) */
  s?: number | null
  /** Dispatch event name (null/undefined for non-Dispatch payloads) */
  t?: string | null
}

/** Data for HELLO (op10) */
export interface HelloData {
  /** Heartbeat interval (ms) the client should use */
  heartbeat_interval: number
}

/** Data for IDENTIFY (op2) */
export interface IdentifyData {
  /** Bot token (including the "Bot " prefix) */
  token: string
  /** Intent bitfield */
  intents: number
  /** Client property info (accepted without validation) */
  properties?: Record<string, unknown>
}

/** Data for RESUME (op6) */
export interface ResumeData {
  /** Bot token */
  token: string
  /** ID of the session to resume */
  session_id: string
  /** Last sequence number received */
  seq: number
}

/**
 * Encodes a Gateway payload as JSON text.
 * @param payload - Payload to encode
 * @returns JSON string
 */
export function encodePayload(payload: GatewayPayload<unknown>): string {
  return JSON.stringify(payload)
}

/**
 * Decodes JSON text into a Gateway payload.
 * @param raw - Raw text received from the WebSocket
 * @returns The decoded payload, or undefined if the JSON is invalid
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
