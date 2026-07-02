import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db.js'
import type { Database } from '../db.js'
import { addMemberRole, removeMemberRole } from './guilds.js'

describe('Guilds Service', () => {
  let db: Database

  beforeEach(() => {
    db = initializeDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('addMemberRole', () => {
    const guildId = '222222222222222222'
    const userId = '555555555555555555'
    const roleId = '444444444444444444'

    beforeEach(() => {
      db.prepare(
        "INSERT INTO users (id, username, bot) VALUES (?, 'TestBot', 1)"
      ).run('111111111111111111')
      db.prepare(
        "INSERT INTO bots (token, user_id, username) VALUES (?, ?, 'TestBot')"
      ).run('Bot testtoken', '111111111111111111')
      db.prepare(
        'INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
      ).run(guildId, 'Test Guild', '111111111111111111', 'Bot testtoken')
      db.prepare(
        "INSERT INTO users (id, username) VALUES (?, 'TestMember')"
      ).run(userId)
      db.prepare(
        'INSERT INTO guild_members (guild_id, user_id) VALUES (?, ?)'
      ).run(guildId, userId)
      db.prepare(
        'INSERT INTO roles (id, guild_id, name, position) VALUES (?, ?, ?, 1)'
      ).run(roleId, guildId, 'Test Role')
    })

    it('adds a role to an existing member and returns true', () => {
      const result = addMemberRole(db, guildId, userId, roleId)
      expect(result).toBe(true)

      const row = db
        .prepare(
          'SELECT 1 FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'
        )
        .get(guildId, userId, roleId)
      expect(row).toBeDefined()
    })

    it('is idempotent when the role is already assigned', () => {
      addMemberRole(db, guildId, userId, roleId)
      const result = addMemberRole(db, guildId, userId, roleId)
      expect(result).toBe(true)

      const rows = db
        .prepare(
          'SELECT * FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'
        )
        .all(guildId, userId, roleId)
      expect(rows.length).toBe(1)
    })

    it('returns false when the member does not exist', () => {
      const result = addMemberRole(db, guildId, '999999999999999999', roleId)
      expect(result).toBe(false)
    })
  })

  describe('removeMemberRole', () => {
    const guildId = '222222222222222222'
    const userId = '555555555555555555'
    const roleId = '444444444444444444'

    beforeEach(() => {
      db.prepare(
        "INSERT INTO users (id, username, bot) VALUES (?, 'TestBot', 1)"
      ).run('111111111111111111')
      db.prepare(
        "INSERT INTO bots (token, user_id, username) VALUES (?, ?, 'TestBot')"
      ).run('Bot testtoken', '111111111111111111')
      db.prepare(
        'INSERT INTO guilds (id, name, owner_id, bot_token) VALUES (?, ?, ?, ?)'
      ).run(guildId, 'Test Guild', '111111111111111111', 'Bot testtoken')
      db.prepare(
        "INSERT INTO users (id, username) VALUES (?, 'TestMember')"
      ).run(userId)
      db.prepare(
        'INSERT INTO guild_members (guild_id, user_id) VALUES (?, ?)'
      ).run(guildId, userId)
      db.prepare(
        'INSERT INTO roles (id, guild_id, name, position) VALUES (?, ?, ?, 1)'
      ).run(roleId, guildId, 'Test Role')
      db.prepare(
        'INSERT INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'
      ).run(guildId, userId, roleId)
    })

    it('removes an assigned role and returns true', () => {
      const result = removeMemberRole(db, guildId, userId, roleId)
      expect(result).toBe(true)

      const row = db
        .prepare(
          'SELECT 1 FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'
        )
        .get(guildId, userId, roleId)
      expect(row).toBeUndefined()
    })

    it('is idempotent when the role is not assigned', () => {
      removeMemberRole(db, guildId, userId, roleId)
      const result = removeMemberRole(db, guildId, userId, roleId)
      expect(result).toBe(true)
    })

    it('returns false when the member does not exist', () => {
      const result = removeMemberRole(
        db,
        guildId,
        '999999999999999999',
        roleId
      )
      expect(result).toBe(false)
    })
  })
})
