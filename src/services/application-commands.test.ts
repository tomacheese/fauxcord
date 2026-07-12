import { describe, it, expect, beforeEach } from 'vitest'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import {
  getCommands,
  getCommand,
  createCommand,
  updateCommand,
  deleteCommand,
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
