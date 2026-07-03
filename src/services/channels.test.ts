import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db.js'
import { seedBot, seedGuild, seedChannel } from '../test-helpers.js'
import {
  createGuildChannel,
  getChannel,
  putChannelOverwrite,
  getChannelOverwrites,
  deleteChannelOverwrite,
} from './channels.js'
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

describe('channel permission overwrites service', () => {
  let db: Database
  let channelId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    const token = seedBot(db)
    const guildId = seedGuild(db, token)
    channelId = seedChannel(db, guildId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('upserts and reflects an overwrite in getChannel', () => {
    putChannelOverwrite(db, channelId, '444444444444444444', {
      type: 0,
      allow: '1024',
      deny: '2048',
    })

    const channel = getChannel(db, channelId)
    expect(channel?.permission_overwrites).toEqual([
      { id: '444444444444444444', type: 0, allow: '1024', deny: '2048' },
    ])

    // upsert: same id updates in place, no duplicate
    putChannelOverwrite(db, channelId, '444444444444444444', {
      type: 0,
      allow: '8',
      deny: '0',
    })
    expect(getChannelOverwrites(db, channelId)).toEqual([
      { id: '444444444444444444', type: 0, allow: '8', deny: '0' },
    ])

    deleteChannelOverwrite(db, channelId, '444444444444444444')
    expect(getChannelOverwrites(db, channelId)).toEqual([])
  })
})
