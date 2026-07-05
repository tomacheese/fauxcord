/**
 * Discord Gateway opcode constants.
 * @see https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-opcodes
 */
export const GatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const

/**
 * Close Code constants used when disconnecting the Gateway.
 * @see https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-close-event-codes
 */
export const GatewayCloseCode = {
  UnknownError: 4000,
  AuthenticationFailed: 4004,
  InvalidSeq: 4007,
  RateLimited: 4008,
  SessionTimedOut: 4009,
  InvalidIntents: 4013,
} as const
