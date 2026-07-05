import type { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import type { GatewayPayload } from './protocol'

/** Maximum number of events retained in the replay buffer */
const REPLAY_BUFFER_SIZE = 100

/** Represents a single Gateway connection (session) */
export interface Session {
  /** Session ID (used when resuming) */
  sessionId: string
  /** ID of the connecting Bot (the user ID associated with bots.token) */
  botId: string
  /** Bot token sent in IDENTIFY */
  token: string
  /** Most recent Dispatch sequence number */
  seq: number
  /** Intent bitfield received in IDENTIFY */
  intents: number
  /** The currently connected WebSocket */
  ws: WebSocket
  /** Replay buffer used for Resume (most recent REPLAY_BUFFER_SIZE entries) */
  replayBuffer: { seq: number; event: GatewayPayload<unknown> }[]
  /** Timer that monitors the Heartbeat timeout */
  heartbeatTimer: NodeJS.Timeout | undefined
  /** Timestamp of the last received Heartbeat (ms epoch) */
  lastHeartbeatAt: number
}

/**
 * Manages the creation, lookup, removal, and replay buffer of Gateway
 * sessions.
 */
export class SessionManager {
  private readonly sessionsById = new Map<string, Session>()
  private readonly sessionIdsByBotId = new Map<string, Set<string>>()

  /**
   * Creates and registers a new session.
   * @param params - Session initialization parameters
   * @returns The created session
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
   * Looks up a session by its session ID.
   * @param sessionId - Session ID
   * @returns The session, or undefined if it doesn't exist
   */
  get(sessionId: string): Session | undefined {
    return this.sessionsById.get(sessionId)
  }

  /**
   * Gets all sessions belonging to the given Bot ID.
   * @param botId - Bot ID
   * @returns Array of sessions
   */
  getByBotId(botId: string): Session[] {
    const ids = this.sessionIdsByBotId.get(botId)
    if (!ids) return []
    return [...ids]
      .map((id) => this.sessionsById.get(id))
      .filter((s): s is Session => s !== undefined)
  }

  /**
   * Gets all currently connected sessions.
   * @returns Array of sessions
   */
  getAll(): Session[] {
    return [...this.sessionsById.values()]
  }

  /**
   * Removes a session.
   * @param sessionId - ID of the session to remove
   */
  remove(sessionId: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return
    if (session.heartbeatTimer) clearTimeout(session.heartbeatTimer)
    this.sessionsById.delete(sessionId)
    this.sessionIdsByBotId.get(session.botId)?.delete(sessionId)
  }

  /**
   * Advances the sequence number by one and returns it.
   * @param session - Target session
   * @returns The new sequence number
   */
  nextSeq(session: Session): number {
    session.seq += 1
    return session.seq
  }

  /**
   * Appends an event to the replay buffer, discarding the oldest event once
   * the size limit is exceeded.
   * @param session - Target session
   * @param event - Event to append
   */
  pushToReplayBuffer(session: Session, event: GatewayPayload<unknown>): void {
    session.replayBuffer.push({ seq: event.s ?? session.seq, event })
    if (session.replayBuffer.length > REPLAY_BUFFER_SIZE) {
      session.replayBuffer.shift()
    }
  }

  /**
   * Gets the events after the given seq for replay.
   * @param session - Target session
   * @param seq - Last seq the client received
   * @returns The events to replay, or undefined if seq is older than the
   * buffer and can no longer be reconstructed
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
