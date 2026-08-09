import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initializeDatabase } from '../db'
import {
  createAutoModerationRule,
  createGuildScheduledEvent,
  createGuildSoundboardSound,
  createGuildTemplate,
  deleteAutoModerationRule,
  getAutoModerationRule,
  getGuildScheduledEvent,
  getGuildSoundboardSound,
  getGuildTemplate,
  updateAutoModerationRule,
} from './guild-advanced'
import {
  seedBot,
  seedGuild,
  seedMember,
  seedVoiceChannel,
} from '../test-helpers'
import type { Database } from '../db'

describe('guild advanced service', () => {
  let db: Database
  let guildId: string
  let userId: string
  let voiceChannelId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    const token = seedBot(db)
    userId = (
      db.prepare('SELECT user_id FROM bots WHERE token = ?').get(token) as {
        user_id: string
      }
    ).user_id
    guildId = seedGuild(db, token)
    seedMember(db, guildId, userId)
    voiceChannelId = seedVoiceChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('persists an auto-moderation rule through create, update, and delete', () => {
    const created = createAutoModerationRule(db, guildId, userId, {
      name: 'blocked words',
      event_type: 1,
      trigger_type: 1,
      actions: [{ type: 1, metadata: {} }],
    })
    expect(getAutoModerationRule(db, guildId, created.id)?.name).toBe(
      'blocked words'
    )

    const updated = updateAutoModerationRule(db, guildId, created.id, {
      name: 'updated words',
      enabled: false,
    })
    expect(updated).toMatchObject({ name: 'updated words', enabled: false })

    expect(deleteAutoModerationRule(db, guildId, created.id)).toBe(true)
    expect(getAutoModerationRule(db, guildId, created.id)).toBeNull()
  })

  it('persists scheduled event, soundboard sound, and template resources', () => {
    const event = createGuildScheduledEvent(db, guildId, userId, {
      name: 'Town hall',
      channel_id: voiceChannelId,
      scheduled_start_time: '2030-01-01T00:00:00.000Z',
      privacy_level: 2,
      entity_type: 2,
    })
    expect(getGuildScheduledEvent(db, guildId, event.id)).toMatchObject({
      id: event.id,
      name: 'Town hall',
    })

    const sound = createGuildSoundboardSound(db, guildId, userId, {
      name: 'Airhorn',
      sound_id: '899999999999999999',
      volume: 0.5,
    })
    expect(getGuildSoundboardSound(db, guildId, sound.sound_id)).toMatchObject({
      name: 'Airhorn',
      volume: 0.5,
    })

    const template = createGuildTemplate(db, guildId, userId, {
      name: 'Starter Guild',
      description: 'A reusable guild',
    })
    expect(getGuildTemplate(db, template.code)).toMatchObject({
      code: template.code,
      name: 'Starter Guild',
      source_guild_id: guildId,
    })
  })
})
