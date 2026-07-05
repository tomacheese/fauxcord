import { describe, it, expect } from 'vitest'
import { GatewayIntentBits } from 'discord-api-types/v10'
import { hasIntent } from './intents'

describe('hasIntent', () => {
  it('returns true when the bit is set', () => {
    const intents = GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages
    expect(hasIntent(intents, GatewayIntentBits.GuildMessages)).toBe(true)
  })

  it('returns false when the bit is not set', () => {
    const intents = GatewayIntentBits.Guilds
    expect(hasIntent(intents, GatewayIntentBits.GuildMessages)).toBe(false)
  })
})
