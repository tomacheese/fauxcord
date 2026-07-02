import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild } from '../test-helpers.js'
import { createGuildChannel } from './channels.js'
import type { Database } from '../db.js'

describe('createGuildChannel', () => {
  let db: Database
  let guildId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    const token = seedBot(db)
    guildId = seedGuild(db, token)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('creates a channel with the given name and default type', () => {
    const channel = createGuildChannel(db, {
      guildId,
      name: 'general',
      position: 0,
    })

    expect(channel.name).toBe('general')
    expect(channel.type).toBe(0)
    expect(channel.guild_id).toBe(guildId)
    expect(channel.permission_overwrites).toEqual([])
  })

  it('honors an explicit type, topic, nsfw, and parent_id', () => {
    const channel = createGuildChannel(db, {
      guildId,
      name: 'announcements',
      type: 5,
      topic: 'Server news',
      nsfw: true,
      parentId: null,
      position: 1,
    })

    expect(channel.type).toBe(5)
    expect(channel.topic).toBe('Server news')
    expect(channel.nsfw).toBe(true)
  })
})
