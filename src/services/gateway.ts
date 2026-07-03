/**
 * Gateway operations service
 *
 * Provides dummy Gateway connection information. Fauxcord does not implement
 * the WebSocket Gateway itself, but many Discord libraries call these REST
 * endpoints during login, so fixed dummy values are returned.
 */

// Used for compile-time type drift detection.
import type {
  APIGatewayInfo,
  APIGatewayBotInfo,
  APIGatewaySessionStartLimit,
} from 'discord-api-types/v10'

/** Gateway info returned by GET /gateway */
export interface GatewayInfo {
  /** The WSS URL that can be used for connecting to the gateway */
  url: string
}

/** Session start limit object returned inside GatewayBotInfo */
export interface GatewaySessionStartLimit {
  /** Total number of session starts allowed */
  total: number
  /** Remaining number of session starts allowed */
  remaining: number
  /** Milliseconds after which the limit resets */
  reset_after: number
  /** Identify requests allowed per 5 seconds */
  max_concurrency: number
}

/** Gateway info returned by GET /gateway/bot */
export interface GatewayBotInfo extends GatewayInfo {
  /** Recommended number of shards to use when connecting */
  shards: number
  /** Information on the current session start limit */
  session_start_limit: GatewaySessionStartLimit
}

/**
 * Compile-time guard: ensures GatewayInfo stays structurally compatible with
 * APIGatewayInfo. Fails to compile when discord-api-types renames or retypes
 * the field.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _GatewayInfoCompatGuard =
  Pick<APIGatewayInfo, 'url'> extends Pick<GatewayInfo, 'url'> ? true : never

/**
 * Compile-time guard: ensures GatewayBotInfo stays structurally compatible with
 * APIGatewayBotInfo.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _GatewayBotInfoCompatGuard =
  Pick<
    APIGatewayBotInfo,
    'url' | 'shards' | 'session_start_limit'
  > extends Pick<GatewayBotInfo, 'url' | 'shards' | 'session_start_limit'>
    ? true
    : never

/**
 * Compile-time guard: ensures GatewaySessionStartLimit stays structurally
 * compatible with APIGatewaySessionStartLimit.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SessionStartLimitCompatGuard =
  Pick<
    APIGatewaySessionStartLimit,
    'total' | 'remaining' | 'reset_after' | 'max_concurrency'
  > extends Pick<
    GatewaySessionStartLimit,
    'total' | 'remaining' | 'reset_after' | 'max_concurrency'
  >
    ? true
    : never

/**
 * Converts an HTTP(S) base URL into a WS(S) gateway URL.
 * @param baseUrl - Base URL (e.g. http://localhost:3000)
 * @returns WebSocket URL (e.g. ws://localhost:3000)
 */
function toGatewayUrl(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) {
    return `wss://${baseUrl.slice('https://'.length)}`
  }
  if (baseUrl.startsWith('http://')) {
    return `ws://${baseUrl.slice('http://'.length)}`
  }
  return baseUrl
}

/**
 * Returns dummy Gateway info for GET /gateway.
 * @param baseUrl - Base URL used to derive the gateway URL
 * @returns Gateway info
 */
export function getGatewayInfo(baseUrl: string): GatewayInfo {
  return { url: toGatewayUrl(baseUrl) }
}

/**
 * Returns dummy Gateway bot info for GET /gateway/bot.
 * @param baseUrl - Base URL used to derive the gateway URL
 * @returns Gateway bot info
 */
export function getGatewayBotInfo(baseUrl: string): GatewayBotInfo {
  return {
    url: toGatewayUrl(baseUrl),
    shards: 1,
    session_start_limit: {
      total: 1000,
      remaining: 1000,
      reset_after: 0,
      max_concurrency: 1,
    },
  }
}
