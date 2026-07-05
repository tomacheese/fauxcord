import { describe, it, expect, vi } from 'vitest'
import { GatewayIntentBits } from 'discord-api-types/v10'
import { SessionManager } from './session'
import { gatewayBus } from './bus'
import { registerGatewaySubscriptions } from './subscribe'

describe('registerGatewaySubscriptions', () => {
  it('broadcasts message.create to all connected sessions', () => {
    const manager = new SessionManager()
    const ws = { send: vi.fn(), close: vi.fn() }
    // GuildMessages を持つセッションのみ配信対象となるため、Intent を明示する
    // （registerGatewaySubscriptions は message.create を GuildMessages Intent で
    // フィルタして配信する仕様のため）
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
})
