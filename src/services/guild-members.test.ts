import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../database'
import type { Database } from '../database'
import { didAddMemberRole, didRemoveMemberRole } from './guild-members'
import { gatewayBus } from '../gateway/bus'

describe('Guilds Service', () => {
  let database: Database

  beforeEach(() => {
    database = initializeDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('addMemberRole', () => {
    const guildId = '222222222222222222'
    const userId = '555555555555555555'
    const roleId = '444444444444444444'

    beforeEach(() => {
      database
        .prepare(
          "INSERT INTO users (id, username, bot) VALUES (?, 'TestBot', 1)"
        )
        .run('111111111111111111')
      database
        .prepare(
          "INSERT INTO bots (token, user_id, username) VALUES (?, ?, 'TestBot')"
        )
        .run('Bot testtoken', '111111111111111111')
      database
        .prepare(
          'INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
        )
        .run(guildId, 'Test Guild', '111111111111111111', 'Bot testtoken')
      database
        .prepare("INSERT INTO users (id, username) VALUES (?, 'TestMember')")
        .run(userId)
      database
        .prepare('INSERT INTO guild_members (guild_id, user_id) VALUES (?, ?)')
        .run(guildId, userId)
      database
        .prepare(
          'INSERT INTO roles (id, guild_id, name, position) VALUES (?, ?, ?, 1)'
        )
        .run(roleId, guildId, 'Test Role')
    })

    it('adds a role to an existing member and returns true', () => {
      const isResult = didAddMemberRole(database, guildId, userId, roleId)
      expect(isResult).toBe(true)

      const row = database
        .prepare(
          'SELECT 1 FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'
        )
        .get(guildId, userId, roleId)
      expect(row).toBeDefined()
    })

    it('is idempotent when the role is already assigned', () => {
      didAddMemberRole(database, guildId, userId, roleId)
      const isResult = didAddMemberRole(database, guildId, userId, roleId)
      expect(isResult).toBe(true)

      const rows = database
        .prepare(
          'SELECT * FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'
        )
        .all(guildId, userId, roleId)
      expect(rows.length).toBe(1)
    })

    it('returns false when the member does not exist', () => {
      const isResult = didAddMemberRole(
        database,
        guildId,
        '999999999999999999',
        roleId
      )
      expect(isResult).toBe(false)
    })

    it('returns false when the role does not exist', () => {
      const isResult = didAddMemberRole(
        database,
        guildId,
        userId,
        '999999999999999999'
      )
      expect(isResult).toBe(false)

      const row = database
        .prepare(
          'SELECT 1 FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'
        )
        .get(guildId, userId, '999999999999999999')
      expect(row).toBeUndefined()
    })

    it('emits guild.member.update with the updated member on success', () => {
      const listener = vi.fn()
      gatewayBus.on('guild.member.update', listener)
      try {
        didAddMemberRole(database, guildId, userId, roleId)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ guildId })
        )
      } finally {
        gatewayBus.off('guild.member.update', listener)
      }
    })

    it('does not emit guild.member.update when getGuildMember returns null (inconsistent DB state)', () => {
      // Simulate a member row whose user record has gone missing, which makes
      // getGuildMember() return null even though the initial membership check
      // (which only looks at guild_members) passes.
      database.pragma('foreign_keys = OFF')
      database.prepare('DELETE FROM users WHERE id = ?').run(userId)

      const listener = vi.fn()
      gatewayBus.on('guild.member.update', listener)
      try {
        const isResult = didAddMemberRole(database, guildId, userId, roleId)
        expect(isResult).toBe(true)
        expect(listener).not.toHaveBeenCalled()
      } finally {
        gatewayBus.off('guild.member.update', listener)
      }
    })
  })

  describe('removeMemberRole', () => {
    const guildId = '222222222222222222'
    const userId = '555555555555555555'
    const roleId = '444444444444444444'

    beforeEach(() => {
      database
        .prepare(
          "INSERT INTO users (id, username, bot) VALUES (?, 'TestBot', 1)"
        )
        .run('111111111111111111')
      database
        .prepare(
          "INSERT INTO bots (token, user_id, username) VALUES (?, ?, 'TestBot')"
        )
        .run('Bot testtoken', '111111111111111111')
      database
        .prepare(
          'INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
        )
        .run(guildId, 'Test Guild', '111111111111111111', 'Bot testtoken')
      database
        .prepare("INSERT INTO users (id, username) VALUES (?, 'TestMember')")
        .run(userId)
      database
        .prepare('INSERT INTO guild_members (guild_id, user_id) VALUES (?, ?)')
        .run(guildId, userId)
      database
        .prepare(
          'INSERT INTO roles (id, guild_id, name, position) VALUES (?, ?, ?, 1)'
        )
        .run(roleId, guildId, 'Test Role')
      database
        .prepare(
          'INSERT INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'
        )
        .run(guildId, userId, roleId)
    })

    it('removes an assigned role and returns true', () => {
      const isResult = didRemoveMemberRole(database, guildId, userId, roleId)
      expect(isResult).toBe(true)

      const row = database
        .prepare(
          'SELECT 1 FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'
        )
        .get(guildId, userId, roleId)
      expect(row).toBeUndefined()
    })

    it('is idempotent when the role is not assigned', () => {
      didRemoveMemberRole(database, guildId, userId, roleId)
      const isResult = didRemoveMemberRole(database, guildId, userId, roleId)
      expect(isResult).toBe(true)
    })

    it('returns false when the member does not exist', () => {
      const isResult = didRemoveMemberRole(
        database,
        guildId,
        '999999999999999999',
        roleId
      )
      expect(isResult).toBe(false)
    })

    it('emits guild.member.update with the updated member on success', () => {
      const listener = vi.fn()
      gatewayBus.on('guild.member.update', listener)
      try {
        didRemoveMemberRole(database, guildId, userId, roleId)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ guildId })
        )
      } finally {
        gatewayBus.off('guild.member.update', listener)
      }
    })

    it('does not emit guild.member.update when getGuildMember returns null (inconsistent DB state)', () => {
      // Simulate a member row whose user record has gone missing, which makes
      // getGuildMember() return null even though the initial membership check
      // (which only looks at guild_members) passes.
      database.pragma('foreign_keys = OFF')
      database.prepare('DELETE FROM users WHERE id = ?').run(userId)

      const listener = vi.fn()
      gatewayBus.on('guild.member.update', listener)
      try {
        const isResult = didRemoveMemberRole(database, guildId, userId, roleId)
        expect(isResult).toBe(true)
        expect(listener).not.toHaveBeenCalled()
      } finally {
        gatewayBus.off('guild.member.update', listener)
      }
    })
  })
})
