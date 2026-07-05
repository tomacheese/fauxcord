import { GatewayOp } from './opcodes'
import { encodePayload } from './protocol'
import { hasIntent } from './intents'
import type { Session, SessionManager } from './session'

/**
 * Sends a Dispatch (op0) event to a single session, updating its seq and
 * replay buffer.
 * @param manager - Session manager
 * @param session - Destination session
 * @param eventName - Dispatch event name (e.g. "MESSAGE_CREATE")
 * @param data - Event data
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
 * Broadcasts a Dispatch event to all sessions belonging to the given Bot.
 * If requiredIntent is given, only sessions holding that Intent receive it.
 * @param manager - Session manager
 * @param botId - ID of the destination Bot
 * @param eventName - Dispatch event name
 * @param data - Event data
 * @param requiredIntent - Intent bit required to receive the event (sent
 * unconditionally if omitted)
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

/**
 * Broadcasts a Dispatch event to all connected sessions. If requiredIntent
 * is given, only sessions holding that Intent receive it.
 * @param manager - Session manager
 * @param eventName - Dispatch event name
 * @param data - Event data
 * @param requiredIntent - Intent bit required to receive the event (sent
 * unconditionally if omitted)
 */
export function broadcastToAll(
  manager: SessionManager,
  eventName: string,
  data: unknown,
  requiredIntent?: number
): void {
  for (const session of manager.getAll()) {
    if (
      requiredIntent !== undefined &&
      !hasIntent(session.intents, requiredIntent)
    ) {
      continue
    }
    sendDispatch(manager, session, eventName, data)
  }
}
