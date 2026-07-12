import { describe, it, expect, beforeEach } from 'vitest'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import {
  createTestInteraction,
  deleteTestSetup,
  resetTestData,
} from './test-control'
import { createCommand } from './application-commands'

describe('createTestInteraction', () => {
  let db: Database
  const applicationId = '111111111111111111'
  const guildId = '222222222222222222'
  const channelId = '333333333333333333'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    db.prepare(
      "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'App', '0', 1)"
    ).run(applicationId)
    db.prepare(
      "INSERT INTO bots (token, user_id, username, discriminator) VALUES ('Bot t', ?, 'App', '0')"
    ).run(applicationId)
    db.prepare(
      "INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, 'g', ?, 'Bot t')"
    ).run(guildId, applicationId)
    db.prepare(
      "INSERT INTO channels (id, guild_id, type, name) VALUES (?, ?, 0, 'general')"
    ).run(channelId, guildId)
    createCommand(db, applicationId, guildId, {
      name: 'ping',
      description: 'x',
    })
  })

  it('creates an interaction against a registered guild command', () => {
    const result = createTestInteraction(db, {
      application_id: applicationId,
      command_name: 'ping',
      guild_id: guildId,
      channel_id: channelId,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.interaction.data?.name).toBe('ping')
    }
  })

  it('returns unknown_command for an unregistered command name', () => {
    const result = createTestInteraction(db, {
      application_id: applicationId,
      command_name: 'does-not-exist',
      guild_id: guildId,
      channel_id: channelId,
    })
    expect(result).toEqual({ ok: false, reason: 'unknown_command' })
  })

  it('falls back to a global command when no guild-scoped match exists', () => {
    createCommand(db, applicationId, null, {
      name: 'globalonly',
      description: 'x',
    })
    const result = createTestInteraction(db, {
      application_id: applicationId,
      command_name: 'globalonly',
      guild_id: guildId,
      channel_id: channelId,
    })
    expect(result.ok).toBe(true)
  })
})

describe('deleteTestSetup / resetTestData — application command & interaction cleanup', () => {
  let db: Database
  const token = 'Bot cleanuptoken'
  const applicationId = '444444444444444444'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    db.prepare(
      "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'App', '0', 1)"
    ).run(applicationId)
    db.prepare(
      'INSERT INTO bots (token, user_id, username, discriminator) VALUES (?, ?, ?, ?)'
    ).run(token, applicationId, 'App', '0')
    createCommand(db, applicationId, null, { name: 'ping', description: 'x' })
    createTestInteraction(db, {
      application_id: applicationId,
      command_name: 'ping',
    })
  })

  it('deleteTestSetup removes global commands and interactions for the bot', () => {
    deleteTestSetup(db, token)
    const commands = db
      .prepare('SELECT * FROM application_commands WHERE application_id = ?')
      .all(applicationId)
    const interactions = db
      .prepare('SELECT * FROM interactions WHERE application_id = ?')
      .all(applicationId)
    expect(commands).toHaveLength(0)
    expect(interactions).toHaveLength(0)
  })

  it('resetTestData removes interactions but keeps application_commands', () => {
    resetTestData(db, token)
    const commands = db
      .prepare('SELECT * FROM application_commands WHERE application_id = ?')
      .all(applicationId)
    const interactions = db
      .prepare('SELECT * FROM interactions WHERE application_id = ?')
      .all(applicationId)
    expect(commands).toHaveLength(1)
    expect(interactions).toHaveLength(0)
  })
})
