/**
 * Discord Gateway WebSocket handler.
 *
 * Builds the `WSEvents` passed to Hono's `upgradeWebSocket` and handles
 * Hello/Identify/Heartbeat/Resume/Ready/Invalid Session/Reconnect.
 */

import type { WSContext, WSEvents } from 'hono/ws'
import type { Database } from '../db'
import { SessionManager, type Session } from './session'
import { GatewayOp, GatewayCloseCode } from './opcodes'
import { encodePayload, decodePayload } from './protocol'
import type { IdentifyData, ResumeData } from './protocol'

/** Heartbeat interval (ms) announced in HELLO; matches real Discord's default. */
const HEARTBEAT_INTERVAL_MS = 41_250
/** Time (ms) to wait for a Heartbeat before closing the session */
const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2

/** Bot info resolved from an IDENTIFY token, used to build the READY user object */
interface IdentifiedBot {
  userId: string
  username: string
  discriminator: string
  avatar: string | null
}

/**
 * Resolves the Bot for an IDENTIFY token. When DISABLE_AUTH=true, any token
 * is accepted (matching REST behavior) and unregistered tokens are treated
 * as MockBot.
 *
 * Real Discord Gateway clients send the raw bot token in IDENTIFY's `token`
 * field, without the `"Bot "` prefix used in the REST `Authorization`
 * header (`bots.token` is stored with that prefix, per `/_test/setup`'s
 * documented `"Bot <token>"` format). The lookup normalizes the IDENTIFY
 * token by adding the prefix when missing, so both the real-protocol
 * unprefixed form and an already-prefixed form resolve to the same row.
 * @param db - Database
 * @param disableAuth - Auth-bypass flag
 * @param token - The `token` field from IDENTIFY
 * @returns The resolved Bot info, or undefined on authentication failure
 */
function resolveBotForIdentify(
  db: Database,
  disableAuth: boolean,
  token: string
): IdentifiedBot | undefined {
  const lookupToken = token.startsWith('Bot ') ? token : `Bot ${token}`
  const row = db
    .prepare(
      'SELECT user_id, username, discriminator, avatar FROM bots WHERE token = ?'
    )
    .get(lookupToken) as
    | {
        user_id: string
        username: string
        discriminator: string
        avatar: string | null
      }
    | undefined
  if (row) {
    return {
      userId: row.user_id,
      username: row.username,
      discriminator: row.discriminator,
      avatar: row.avatar,
    }
  }
  if (disableAuth) {
    return {
      userId: '0',
      username: 'MockBot',
      discriminator: '0',
      avatar: null,
    }
  }
  return undefined
}

/**
 * Validates the structural well-formedness of the Intent bitfield (rejects
 * negative or non-integer values). Privileged Intent permission checks are
 * out of scope, so those are always allowed.
 * @param intents - The `intents` field from IDENTIFY
 * @returns true if valid
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
 * Converts an http(s) baseUrl into a ws(s) URL.
 * @param baseUrl - The baseUrl to convert
 * @returns The ws(s) URL
 */
function toWsUrl(baseUrl: string): string {
  if (baseUrl.startsWith('https://'))
    return `wss://${baseUrl.slice('https://'.length)}`
  if (baseUrl.startsWith('http://'))
    return `ws://${baseUrl.slice('http://'.length)}`
  return baseUrl
}

/**
 * (Re)arms the Heartbeat timeout timer.
 * @param sessionManager - Session manager
 * @param ws - The connected WebSocket context
 * @param sessionId - Session ID
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
    try {
      ws.close(GatewayCloseCode.SessionTimedOut, 'Session timed out')
    } catch {
      // The socket may already be closed (e.g. `onClose` no longer removes
      // the session immediately, see the missing `onClose` handler below),
      // in which case `ws.close` can throw synchronously. Swallow it so the
      // session is still reaped below.
    }
    sessionManager.remove(sessionId)
  }, HEARTBEAT_TIMEOUT_MS)
}

/**
 * Handles IDENTIFY (op2) and sends READY (op0) on successful authentication.
 * @param db - Database
 * @param options - baseUrl and disableAuth
 * @param sessionManager - Session manager
 * @param sessionIdByWs - Map of WSContext to sessionId
 * @param ws - The connected WebSocket context
 * @param data - The IDENTIFY payload
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
    ws: ws.raw as never, // hono/ws's WSContext.raw is the underlying ws.WebSocket instance
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
        // Real Discord's READY `user` is the full own-user object (matching
        // GET /users/@me's shape), not just {id, username, bot}. Some
        // clients build a strict own-user model straight from this field and
        // raise before their `ready` event ever fires if it's incomplete.
        // `verified: true` and the other dummy values mirror
        // src/services/users.ts's getBotUser() (which independently needed
        // the same `verified` field added, since some clients -- e.g.
        // interactions.py -- build their own-user model from the REST
        // `/users/@me` login response instead of this Gateway field).
        user: {
          id: bot.userId,
          username: bot.username,
          discriminator: bot.discriminator,
          avatar: bot.avatar,
          bot: true,
          flags: 0,
          public_flags: 0,
          global_name: null,
          mfa_enabled: false,
          locale: 'en-US',
          verified: true,
        },
        guilds: [],
        session_id: session.sessionId,
        resume_gateway_url: toWsUrl(options.baseUrl),
        // `private_channels` is not part of discord-api-types's
        // GatewayReadyDispatchData (long deprecated, always empty), but real
        // Discord still sends it and Discord.Net's ReadyEvent model reads
        // `data.PrivateChannels.Length` unconditionally, throwing a
        // NullReferenceException ("Processing READY failed") when the field
        // is absent. Sending an empty array matches real Discord's behavior
        // and costs nothing for clients that ignore it.
        private_channels: [],
        // `application` is required by the real Gateway READY payload
        // (GatewayReadyDispatchData in discord-api-types); some clients
        // (e.g. Oceanic.js) fail to parse READY without it. `flags: 0` is a
        // dummy value, matching the REST `/applications/@me` mock.
        application: { id: bot.userId, flags: 0 },
      },
    })
  )
}

/**
 * Handles RESUME (op6).
 * @param sessionManager - Session manager
 * @param sessionIdByWs - Map of WSContext to sessionId
 * @param ws - The connected WebSocket context
 * @param data - The RESUME payload
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
 * Handles HEARTBEAT (op1), replying with ACK (op11) and rearming the
 * timeout timer.
 * @param sessionManager - Session manager
 * @param sessionIdByWs - Map of WSContext to sessionId
 * @param ws - The connected WebSocket context
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
 * Builds the Gateway WebSocket handler.
 * @param db - Database (used for IDENTIFY token validation and MockBot
 * creation)
 * @param options - baseUrl and disableAuth
 * @returns The WSEvents to pass to Hono's upgradeWebSocket, plus the
 * SessionManager used for Dispatch delivery
 */
export function createGatewayWebSocketHandler(
  db: Database,
  options: { baseUrl: string; disableAuth: boolean }
): { upgrade: WSEvents; sessionManager: SessionManager } {
  const sessionManager = new SessionManager()
  // Maps ws (WSContext) to sessionId; referenced from onClose/onMessage.
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
      // event.data is WSMessageReceive (string | Blob | ArrayBufferLike),
      // but Gateway clients are expected to always send JSON text frames,
      // so anything non-string is ignored as an invalid message.
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
          // Unknown opcodes are ignored (real Discord also ignores unknown
          // opcodes from clients).
          break
        }
      }
    },
    // No onClose handler: a closed socket must not immediately remove the
    // session, otherwise a transient disconnect could never be resumed (the
    // session and its replay buffer would be gone before the client can send
    // RESUME). The Heartbeat timeout (armed on IDENTIFY/RESUME) removes
    // sessions whose clients never return within the timeout window, which
    // bounds the lifetime of orphaned sessions.
  }

  return { upgrade, sessionManager }
}

/**
 * Sends RECONNECT (op7) to a session, prompting the client to reconnect
 * (either re-IDENTIFY or RESUME) before disconnecting it. Use this when the
 * server needs to end a session on its own terms (e.g. graceful shutdown on
 * process exit).
 * @param session - Target session
 */
export function sendReconnect(session: Session): void {
  try {
    session.ws.send(encodePayload({ op: GatewayOp.Reconnect, d: null }))
    session.ws.close(1000, 'Reconnect requested')
  } catch {
    // The socket may already be closed or errored, in which case `ws` throws
    // synchronously. Swallow it so the shutdown/reconnect loop continues for
    // the remaining sessions.
  }
}
