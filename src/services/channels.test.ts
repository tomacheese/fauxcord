import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import {
  seedBot,
  seedGuild,
  seedChannel,
  seedVoiceChannel,
  seedGroupDmChannel,
} from '../test-helpers'
import {
  createGuildChannel,
  getChannel,
  getGuildChannels,
  putChannelOverwrite,
  getChannelOverwrites,
  getChannelOverwritesForChannels,
  deleteChannelOverwrite,
  setVoiceStatus,
  addChannelRecipient,
  removeChannelRecipient,
  getChannelRecipientUsers,
} from './channels'
import { createTestUser } from './test-control'
import type { Database } from '../db'

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
  let guildId: string
  let channelId: string

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    const token = seedBot(db)
    guildId = seedGuild(db, token)
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

  it('bulk-loads overwrites for multiple channels, grouped by channel', () => {
    const channelId2 = seedChannel(db, guildId, '555555555555555555')
    putChannelOverwrite(db, channelId, '444444444444444444', {
      type: 0,
      allow: '1024',
      deny: '0',
    })
    putChannelOverwrite(db, channelId2, '666666666666666666', {
      type: 1,
      allow: '0',
      deny: '2048',
    })

    const grouped = getChannelOverwritesForChannels(db, [channelId, channelId2])
    expect(grouped.get(channelId)).toEqual([
      { id: '444444444444444444', type: 0, allow: '1024', deny: '0' },
    ])
    expect(grouped.get(channelId2)).toEqual([
      { id: '666666666666666666', type: 1, allow: '0', deny: '2048' },
    ])
    // An empty input yields an empty map (no query issued).
    expect(getChannelOverwritesForChannels(db, []).size).toBe(0)
  })

  it('getGuildChannels reflects each channel own overwrites', () => {
    const chA = channelId
    const chB = seedChannel(db, guildId, '888888888888888888')
    putChannelOverwrite(db, chA, '444444444444444444', {
      type: 0,
      allow: '8',
      deny: '0',
    })

    const channels = getGuildChannels(db, guildId)
    const a = channels.find((c) => c.id === chA)
    const b = channels.find((c) => c.id === chB)
    expect(a?.permission_overwrites).toEqual([
      { id: '444444444444444444', type: 0, allow: '8', deny: '0' },
    ])
    expect(b?.permission_overwrites).toEqual([])
  })
})

describe('setVoiceStatus', () => {
  let db: Database

  beforeEach(() => {
    db = initializeDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('sets and surfaces the voice_status field on the channel', () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedVoiceChannel(db, guild)

    const updated = setVoiceStatus(db, channel, 'now playing music')
    expect(updated?.voice_status).toBe('now playing music')

    const fetched = getChannel(db, channel)
    expect(fetched?.voice_status).toBe('now playing music')
  })

  it('clears voice_status when set to null', () => {
    const bot = seedBot(db, 'Bot testtoken')
    const guild = seedGuild(db, bot)
    const channel = seedVoiceChannel(db, guild)

    setVoiceStatus(db, channel, 'temp')
    setVoiceStatus(db, channel, null)

    const fetched = getChannel(db, channel)
    expect(fetched?.voice_status).toBeUndefined()
  })

  it('returns null for an unknown channel', () => {
    const result = setVoiceStatus(db, '999999999999999999', 'x')
    expect(result).toBeNull()
  })
})

describe('channel recipients', () => {
  let db: Database

  beforeEach(() => {
    db = initializeDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('adds and lists recipients on a group DM channel', () => {
    const channel = seedGroupDmChannel(db)
    const userId = createTestUser(db, { username: 'Alice' }).id

    addChannelRecipient(db, channel, userId)
    const recipients = getChannelRecipientUsers(db, channel)

    expect(recipients).toHaveLength(1)
    expect(recipients[0].id).toBe(userId)
    expect(recipients[0].username).toBe('Alice')
  })

  it('removes a recipient', () => {
    const channel = seedGroupDmChannel(db)
    const userId = createTestUser(db, { username: 'Bob' }).id

    addChannelRecipient(db, channel, userId)
    removeChannelRecipient(db, channel, userId)

    expect(getChannelRecipientUsers(db, channel)).toHaveLength(0)
  })

  it('surfaces recipients on getChannel for a group DM', () => {
    const channel = seedGroupDmChannel(db)
    const userId = createTestUser(db, { username: 'Carol' }).id
    addChannelRecipient(db, channel, userId)

    const fetched = getChannel(db, channel)
    expect(fetched?.recipients).toHaveLength(1)
  })
})
