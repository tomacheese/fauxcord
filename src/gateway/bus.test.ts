import { describe, it, expect, vi } from 'vitest'
import { gatewayBus } from './bus'

describe('gatewayBus', () => {
  it('delivers emitted events to registered listeners', () => {
    const listener = vi.fn()
    gatewayBus.on('message.create', listener)
    gatewayBus.emit('message.create', {
      guildId: 'g1',
      channelId: 'c1',
      message: { id: 'm1' },
    })
    expect(listener).toHaveBeenCalledWith({
      guildId: 'g1',
      channelId: 'c1',
      message: { id: 'm1' },
    })
    gatewayBus.off('message.create', listener)
  })
})
