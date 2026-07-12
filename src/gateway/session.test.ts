import { describe, it, expect, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { SessionManager } from './session'
import { GatewayOp } from './opcodes'

function fakeWs(): WebSocket {
  return { send: vi.fn(), close: vi.fn() } as unknown as WebSocket
}

describe('SessionManager', () => {
  it('creates a session with a unique sessionId and tracks it by botId', () => {
    const manager = new SessionManager()
    const session = manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: 513,
      ws: fakeWs(),
    })
    expect(session.sessionId).toBeTruthy()
    expect(session.seq).toBe(0)
    expect(manager.get(session.sessionId)).toBe(session)
    expect(manager.getByBotId('bot1')).toEqual([session])
  })

  it('allows multiple concurrent sessions for the same token', () => {
    const manager = new SessionManager()
    const s1 = manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: 0,
      ws: fakeWs(),
    })
    const s2 = manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: 0,
      ws: fakeWs(),
    })
    expect(s1.sessionId).not.toBe(s2.sessionId)
    expect(manager.getByBotId('bot1')).toHaveLength(2)
  })

  it('removes a session', () => {
    const manager = new SessionManager()
    const session = manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: 0,
      ws: fakeWs(),
    })
    manager.remove(session.sessionId)
    expect(manager.get(session.sessionId)).toBeUndefined()
    expect(manager.getByBotId('bot1')).toEqual([])
  })

  it('returns all connected sessions across bots via getAll', () => {
    const manager = new SessionManager()
    const s1 = manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: 0,
      ws: fakeWs(),
    })
    const s2 = manager.create({
      botId: 'bot2',
      token: 'Bot y',
      intents: 0,
      ws: fakeWs(),
    })
    expect(manager.getAll()).toEqual([s1, s2])
  })

  it('increments seq and keeps up to 100 events in the replay buffer', () => {
    const manager = new SessionManager()
    const session = manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: 0,
      ws: fakeWs(),
    })
    for (let index = 0; index < 105; index++) {
      const seq = manager.nextSeq(session)
      manager.pushToReplayBuffer(session, {
        op: GatewayOp.Dispatch,
        d: {},
        s: seq,
        t: 'X',
      })
    }
    expect(session.seq).toBe(105)
    expect(session.replayBuffer).toHaveLength(100)
    expect(session.replayBuffer[0]?.seq).toBe(6) // first 5 of 1..105 were evicted
  })

  it('replays events after the given seq, or returns undefined if evicted', () => {
    const manager = new SessionManager()
    const session = manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: 0,
      ws: fakeWs(),
    })
    for (let index = 0; index < 3; index++) {
      const seq = manager.nextSeq(session)
      manager.pushToReplayBuffer(session, {
        op: GatewayOp.Dispatch,
        d: {},
        s: seq,
        t: 'X',
      })
    }
    expect(manager.replayFrom(session, 1)).toHaveLength(2) // seq 2, 3
    expect(manager.replayFrom(session, 0)).toHaveLength(3)
    expect(manager.replayFrom(session, -1)).toBeUndefined() // seq older than what's in the buffer
  })
})
