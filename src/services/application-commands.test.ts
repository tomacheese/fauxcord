import { describe, it, expect, beforeEach } from 'vitest'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import { seedBot } from '../test-helpers'
import {
  getCommands,
  getCommand,
  createCommand,
  updateCommand,
  deleteCommand,
  bulkOverwriteCommands,
  getAllCommandPermissions,
  getCommandPermissions,
  setCommandPermissions,
} from './application-commands'

describe('application-commands service (global scope)', () => {
  let db: Database
  const applicationId = '111111111111111111'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
  })

  it('creates and retrieves a global command', () => {
    const result = createCommand(db, applicationId, null, {
      name: 'ping',
      description: 'Replies with pong',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.command.name).toBe('ping')
    expect(result.command.application_id).toBe(applicationId)
    expect(result.command.guild_id).toBeUndefined()

    const fetched = getCommand(db, applicationId, null, result.command.id)
    expect(fetched?.name).toBe('ping')
  })

  it('lowercases CHAT_INPUT command names', () => {
    const result = createCommand(db, applicationId, null, {
      name: 'Ping',
      description: 'x',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.command.name).toBe('ping')
  })

  it('rejects a duplicate (application_id, guild_id, type, name)', () => {
    createCommand(db, applicationId, null, { name: 'ping', description: 'x' })
    const second = createCommand(db, applicationId, null, {
      name: 'ping',
      description: 'y',
    })
    expect(second.ok).toBe(false)
  })

  it('lists all global commands for an application', () => {
    createCommand(db, applicationId, null, { name: 'ping', description: 'x' })
    createCommand(db, applicationId, null, { name: 'pong', description: 'y' })
    const list = getCommands(db, applicationId, null)
    expect(list).toHaveLength(2)
  })

  it('updates a command in place', () => {
    const created = createCommand(db, applicationId, null, {
      name: 'ping',
      description: 'x',
    })
    if (!created.ok) throw new Error('setup failed')
    const updated = updateCommand(db, applicationId, null, created.command.id, {
      description: 'updated',
    })
    expect(updated.ok).toBe(true)
    if (updated.ok) expect(updated.command.description).toBe('updated')
  })

  it('returns not_found when updating a nonexistent command', () => {
    const result = updateCommand(db, applicationId, null, 'missing', {
      description: 'x',
    })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('deletes a command', () => {
    const created = createCommand(db, applicationId, null, {
      name: 'ping',
      description: 'x',
    })
    if (!created.ok) throw new Error('setup failed')
    expect(deleteCommand(db, applicationId, null, created.command.id)).toBe(
      true
    )
    expect(getCommand(db, applicationId, null, created.command.id)).toBeNull()
  })
})

describe('application-commands service (guild scope + bulk overwrite)', () => {
  let db: Database
  const applicationId = '111111111111111111'
  const guildId = '222222222222222222'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    // guilds.bot_token references bots(token), so a bot row must exist first.
    seedBot(db, 'Bot testtoken', applicationId)
    db.prepare(
      "INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, 'g', ?, 'Bot testtoken')"
    ).run(guildId, applicationId)
  })

  it('creates a guild-scoped command independent from global commands of the same name', () => {
    createCommand(db, applicationId, null, { name: 'ping', description: 'x' })
    const guildResult = createCommand(db, applicationId, guildId, {
      name: 'ping',
      description: 'y',
    })
    expect(guildResult.ok).toBe(true)
    expect(getCommands(db, applicationId, null)).toHaveLength(1)
    expect(getCommands(db, applicationId, guildId)).toHaveLength(1)
  })

  it('bulk-overwrites commands, preserving the ID of an unchanged name+type match', () => {
    const first = createCommand(db, applicationId, guildId, {
      name: 'ping',
      description: 'x',
    })
    if (!first.ok) throw new Error('setup failed')

    const overwritten = bulkOverwriteCommands(db, applicationId, guildId, [
      { name: 'ping', description: 'updated' },
      { name: 'pong', description: 'new' },
    ])

    expect(overwritten).toHaveLength(2)
    const ping = overwritten.find((cmd) => cmd.name === 'ping')
    expect(ping?.id).toBe(first.command.id)
    expect(ping?.description).toBe('updated')
    expect(getCommands(db, applicationId, guildId)).toHaveLength(2)
  })

  it('removes commands absent from the bulk overwrite payload', () => {
    createCommand(db, applicationId, guildId, { name: 'ping', description: 'x' })
    createCommand(db, applicationId, guildId, { name: 'pong', description: 'y' })

    bulkOverwriteCommands(db, applicationId, guildId, [
      { name: 'ping', description: 'x' },
    ])

    expect(getCommands(db, applicationId, guildId)).toHaveLength(1)
  })
})

describe('application-commands service (permissions)', () => {
  let db: Database
  const applicationId = '111111111111111111'
  const guildId = '222222222222222222'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    seedBot(db, 'Bot testtoken', applicationId)
    db.prepare(
      "INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, 'g', ?, 'Bot testtoken')"
    ).run(guildId, applicationId)
  })

  it('returns an empty permissions array for a command with no overrides', () => {
    const created = createCommand(db, applicationId, guildId, {
      name: 'ping',
      description: 'x',
    })
    if (!created.ok) throw new Error('setup failed')
    const permissions = getCommandPermissions(
      db,
      applicationId,
      guildId,
      created.command.id
    )
    expect(permissions).toEqual({
      id: created.command.id,
      application_id: applicationId,
      guild_id: guildId,
      permissions: [],
    })
  })

  it('returns null for permissions of an unknown command', () => {
    expect(
      getCommandPermissions(db, applicationId, guildId, 'missing')
    ).toBeNull()
  })

  it('sets and retrieves command permissions', () => {
    const created = createCommand(db, applicationId, guildId, {
      name: 'ping',
      description: 'x',
    })
    if (!created.ok) throw new Error('setup failed')

    setCommandPermissions(db, applicationId, guildId, created.command.id, [
      { id: 'role1', type: 1, permission: true },
    ])

    const permissions = getCommandPermissions(
      db,
      applicationId,
      guildId,
      created.command.id
    )
    expect(permissions?.permissions).toEqual([
      { id: 'role1', type: 1, permission: true },
    ])
    expect(getAllCommandPermissions(db, applicationId, guildId)).toHaveLength(
      1
    )
  })
})
