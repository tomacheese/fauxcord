import { describe, expect, it } from 'vitest'
import { initializeDatabase } from '../db'
import { seedBot, seedGuild, seedStageChannel } from '../test-helpers'
import { createStageInstance, getStageInstance } from './stage-instances'

describe('stage instance service', () => {
  it('persists a stage instance against its stage channel', () => {
    const db = initializeDatabase(':memory:')
    const token = seedBot(db, 'Bot stage-service')
    const guildId = seedGuild(db, token)
    const { stageChannelId } = seedStageChannel(db, guildId)
    const instance = createStageInstance(db, {
      guildId,
      channelId: stageChannelId,
      topic: 'Town hall',
    })
    expect(getStageInstance(db, stageChannelId)).toMatchObject({
      id: instance.id,
      guild_id: guildId,
      topic: 'Town hall',
    })
  })
})
