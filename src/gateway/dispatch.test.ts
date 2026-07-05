import { describe, it, expect, vi } from 'vitest'
import { SessionManager } from './session'
import { sendDispatch, broadcastToBot } from './dispatch'
import { GatewayIntentBits } from 'discord-api-types/v10'

function fakeWs() {
  return { send: vi.fn(), close: vi.fn() }
}

describe('sendDispatch', () => {
  it('sends a Dispatch payload and advances seq / replay buffer', () => {
    const manager = new SessionManager()
    const ws = fakeWs()
    const session = manager.create({
      botId: 'b1',
      token: 'Bot x',
      intents: 0,
      ws: ws as never,
    })

    sendDispatch(manager, session, 'MESSAGE_CREATE', { id: 'm1' })

    expect(ws.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(
      (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    )
    expect(sent).toEqual({ op: 0, t: 'MESSAGE_CREATE', s: 1, d: { id: 'm1' } })
    expect(session.replayBuffer).toHaveLength(1)
  })
})

describe('broadcastToBot', () => {
  it('sends only to sessions whose intents include the required bit', () => {
    const manager = new SessionManager()
    const wsWithIntent = fakeWs()
    const wsWithoutIntent = fakeWs()
    manager.create({
      botId: 'b1',
      token: 'Bot x',
      intents: GatewayIntentBits.GuildMessages,
      ws: wsWithIntent as never,
    })
    manager.create({
      botId: 'b1',
      token: 'Bot x',
      intents: 0,
      ws: wsWithoutIntent as never,
    })

    broadcastToBot(
      manager,
      'b1',
      'MESSAGE_CREATE',
      { id: 'm1' },
      GatewayIntentBits.GuildMessages
    )

    expect(wsWithIntent.send).toHaveBeenCalledTimes(1)
    expect(wsWithoutIntent.send).not.toHaveBeenCalled()
  })

  it('sends to all sessions when no intent is required', () => {
    const manager = new SessionManager()
    const ws = fakeWs()
    manager.create({ botId: 'b1', token: 'Bot x', intents: 0, ws: ws as never })

    broadcastToBot(manager, 'b1', 'GUILD_CREATE', { id: 'g1' })

    expect(ws.send).toHaveBeenCalledTimes(1)
  })
})
