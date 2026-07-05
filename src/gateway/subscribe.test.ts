import { describe, it, expect, vi } from 'vitest'
import { GatewayIntentBits } from 'discord-api-types/v10'
import { SessionManager } from './session'
import { gatewayBus } from './bus'
import { registerGatewaySubscriptions } from './subscribe'

describe('registerGatewaySubscriptions', () => {
  it('broadcasts message.create to all connected sessions', () => {
    const manager = new SessionManager()
    const ws = { send: vi.fn(), close: vi.fn() }
    // Only sessions with GuildMessages receive this event, so the Intent is
    // set explicitly (registerGatewaySubscriptions filters message.create
    // delivery by the GuildMessages Intent).
    manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: GatewayIntentBits.GuildMessages,
      ws: ws as never,
    })
    const unsubscribe = registerGatewaySubscriptions(manager)

    gatewayBus.emit('message.create', {
      guildId: 'g1',
      channelId: 'c1',
      message: { id: 'm1' },
    })

    expect(ws.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(
      (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    ) as { t: string; d: unknown }
    expect(sent.t).toBe('MESSAGE_CREATE')
    expect(sent.d).toEqual({ id: 'm1' })

    unsubscribe()
  })

  it('only delivers guild.create to sessions with the Guilds intent', () => {
    const manager = new SessionManager()
    const wsWithoutIntent = { send: vi.fn(), close: vi.fn() }
    const wsWithIntent = { send: vi.fn(), close: vi.fn() }
    // No Guilds intent: must not receive GUILD_CREATE.
    manager.create({
      botId: 'bot1',
      token: 'Bot x',
      intents: GatewayIntentBits.GuildMessages,
      ws: wsWithoutIntent as never,
    })
    // Has the Guilds intent: must receive GUILD_CREATE.
    manager.create({
      botId: 'bot2',
      token: 'Bot y',
      intents: GatewayIntentBits.Guilds,
      ws: wsWithIntent as never,
    })
    const unsubscribe = registerGatewaySubscriptions(manager)

    gatewayBus.emit('guild.create', { guild: { id: 'g1' } })

    expect(wsWithoutIntent.send).not.toHaveBeenCalled()
    expect(wsWithIntent.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(
      (wsWithIntent.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    ) as { t: string; d: unknown }
    expect(sent.t).toBe('GUILD_CREATE')
    expect(sent.d).toEqual({ id: 'g1' })

    unsubscribe()
  })
})
