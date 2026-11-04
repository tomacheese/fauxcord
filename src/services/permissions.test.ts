import { beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, type Database } from '../db'
import {
  seedBot,
  seedChannel,
  seedGuild,
  seedMember,
  seedRole,
} from '../test-helpers'
import { putChannelOverwrite } from './channels'
import {
  getChannelMemberPermissions,
  getChannelRolePermissions,
  getGuildMemberPermissions,
  getGuildRolePermissions,
} from './permissions'

const ADMINISTRATOR = 1n << 3n
const ALL = (1n << 64n) - 1n
const VIEW = 1n << 10n
const SEND = 1n << 11n
const EMBED = 1n << 14n

let db: Database
let guildId: string
let channelId: string
let ownerId: string

/**
 * Sets a role's guild-level permission bitfield.
 * @param roleId - Role ID
 * @param permissions - Permission bitfield
 */
function setRolePermissions(roleId: string, permissions: bigint): void {
  db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(
    permissions.toString(),
    roleId
  )
}

/**
 * Assigns a role to a member.
 * @param userId - Member user ID
 * @param roleId - Role ID
 */
function assignRole(userId: string, roleId: string): void {
  db.prepare(
    'INSERT INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'
  ).run(guildId, userId, roleId)
}

/**
 * Creates a channel permission overwrite.
 * @param id - Role or member ID
 * @param type - 0 = role, 1 = member
 * @param allow - Allowed bits
 * @param deny - Denied bits
 */
function overwrite(
  id: string,
  type: number,
  allow: bigint,
  deny: bigint
): void {
  putChannelOverwrite(db, channelId, id, {
    type,
    allow: allow.toString(),
    deny: deny.toString(),
  })
}

beforeEach(() => {
  db = initializeDatabase(':memory:')
  const token = seedBot(db)
  guildId = seedGuild(db, token)
  db.prepare(
    `INSERT INTO roles (id, guild_id, name, permissions, position)
     VALUES (?, ?, '@everyone', '0', 0)`
  ).run(guildId, guildId)
  channelId = seedChannel(db, guildId)
  ownerId = db
    .prepare('SELECT owner_id FROM guilds WHERE id = ?')
    .pluck()
    .get(guildId) as string
  seedMember(db, guildId, ownerId)
})

describe('getGuildMemberPermissions', () => {
  it('returns null when the member is not in the guild', () => {
    expect(getGuildMemberPermissions(db, guildId, '999')).toBeNull()
  })

  it('returns all bits for the owner', () => {
    expect(getGuildMemberPermissions(db, guildId, ownerId)).toBe(ALL)
  })

  it('returns the @everyone permissions for a member without roles', () => {
    setRolePermissions(guildId, VIEW)
    const member = seedMember(db, guildId)
    expect(getGuildMemberPermissions(db, guildId, member)).toBe(VIEW)
  })

  it('treats a missing @everyone row as zero', () => {
    db.prepare('DELETE FROM roles WHERE id = ?').run(guildId)
    const member = seedMember(db, guildId)
    expect(getGuildMemberPermissions(db, guildId, member)).toBe(0n)
  })

  it('ORs the permissions of all member roles', () => {
    setRolePermissions(guildId, VIEW)
    const a = seedRole(db, guildId)
    const b = seedRole(db, guildId)
    setRolePermissions(a, SEND)
    setRolePermissions(b, EMBED)
    const member = seedMember(db, guildId)
    assignRole(member, a)
    assignRole(member, b)
    expect(getGuildMemberPermissions(db, guildId, member)).toBe(
      VIEW | SEND | EMBED
    )
  })

  it('returns all bits for a member with an ADMINISTRATOR role', () => {
    const admin = seedRole(db, guildId)
    setRolePermissions(admin, ADMINISTRATOR)
    const member = seedMember(db, guildId)
    assignRole(member, admin)
    expect(getGuildMemberPermissions(db, guildId, member)).toBe(ALL)
  })
})

describe('getGuildRolePermissions', () => {
  it('returns null for an unknown role', () => {
    expect(getGuildRolePermissions(db, guildId, '999')).toBeNull()
  })

  it('returns only @everyone for role_id == guild_id', () => {
    setRolePermissions(guildId, VIEW)
    expect(getGuildRolePermissions(db, guildId, guildId)).toBe(VIEW)
  })

  it('combines the role with @everyone', () => {
    setRolePermissions(guildId, VIEW)
    const role = seedRole(db, guildId)
    setRolePermissions(role, SEND)
    expect(getGuildRolePermissions(db, guildId, role)).toBe(VIEW | SEND)
  })

  it('returns all bits for an ADMINISTRATOR role', () => {
    const role = seedRole(db, guildId)
    setRolePermissions(role, ADMINISTRATOR)
    expect(getGuildRolePermissions(db, guildId, role)).toBe(ALL)
  })

  it('does not see roles of another guild', () => {
    const other = seedGuild(db, 'Bot testtoken', '333333333333333333')
    const role = seedRole(db, other)
    expect(getGuildRolePermissions(db, guildId, role)).toBeNull()
  })
})

describe('getChannelMemberPermissions', () => {
  it('returns null when the member is not in the guild', () => {
    expect(
      getChannelMemberPermissions(db, guildId, channelId, '999')
    ).toBeNull()
  })

  it('returns all bits for the owner regardless of overwrites', () => {
    overwrite(guildId, 0, 0n, VIEW)
    expect(getChannelMemberPermissions(db, guildId, channelId, ownerId)).toBe(
      ALL
    )
  })

  it('returns all bits for an administrator regardless of overwrites', () => {
    const admin = seedRole(db, guildId)
    setRolePermissions(admin, ADMINISTRATOR)
    const member = seedMember(db, guildId)
    assignRole(member, admin)
    overwrite(guildId, 0, 0n, VIEW)
    expect(getChannelMemberPermissions(db, guildId, channelId, member)).toBe(
      ALL
    )
  })

  it('equals the guild permissions when there are no overwrites', () => {
    setRolePermissions(guildId, VIEW | SEND)
    const member = seedMember(db, guildId)
    expect(getChannelMemberPermissions(db, guildId, channelId, member)).toBe(
      VIEW | SEND
    )
  })

  it('applies the @everyone overwrite deny then allow', () => {
    setRolePermissions(guildId, VIEW | SEND)
    overwrite(guildId, 0, EMBED, SEND)
    const member = seedMember(db, guildId)
    expect(getChannelMemberPermissions(db, guildId, channelId, member)).toBe(
      VIEW | EMBED
    )
  })

  it('lets a role overwrite win over the @everyone overwrite', () => {
    setRolePermissions(guildId, VIEW)
    overwrite(guildId, 0, 0n, VIEW)
    const role = seedRole(db, guildId)
    overwrite(role, 0, VIEW, 0n)
    const member = seedMember(db, guildId)
    assignRole(member, role)
    expect(getChannelMemberPermissions(db, guildId, channelId, member)).toBe(
      VIEW
    )
  })

  it('combines several role overwrites (deny OR, allow OR)', () => {
    setRolePermissions(guildId, VIEW | SEND)
    const a = seedRole(db, guildId)
    const b = seedRole(db, guildId)
    overwrite(a, 0, EMBED, SEND)
    overwrite(b, 0, 0n, VIEW)
    const member = seedMember(db, guildId)
    assignRole(member, a)
    assignRole(member, b)
    expect(getChannelMemberPermissions(db, guildId, channelId, member)).toBe(
      EMBED
    )
  })

  it('lets a member overwrite win over role overwrites', () => {
    setRolePermissions(guildId, VIEW)
    const role = seedRole(db, guildId)
    overwrite(role, 0, 0n, VIEW)
    const member = seedMember(db, guildId)
    assignRole(member, role)
    overwrite(member, 1, VIEW, 0n)
    expect(getChannelMemberPermissions(db, guildId, channelId, member)).toBe(
      VIEW
    )
  })
})

describe('getChannelRolePermissions', () => {
  it('returns null for an unknown role', () => {
    expect(getChannelRolePermissions(db, guildId, channelId, '999')).toBeNull()
  })

  it('returns all bits for an ADMINISTRATOR role', () => {
    const role = seedRole(db, guildId)
    setRolePermissions(role, ADMINISTRATOR)
    overwrite(guildId, 0, 0n, VIEW)
    expect(getChannelRolePermissions(db, guildId, channelId, role)).toBe(ALL)
  })

  it('applies @everyone overwrite for role_id == guild_id once', () => {
    setRolePermissions(guildId, VIEW | SEND)
    overwrite(guildId, 0, EMBED, SEND)
    expect(getChannelRolePermissions(db, guildId, channelId, guildId)).toBe(
      VIEW | EMBED
    )
  })

  it('applies @everyone overwrite then the role overwrite', () => {
    setRolePermissions(guildId, VIEW)
    const role = seedRole(db, guildId)
    setRolePermissions(role, SEND)
    overwrite(guildId, 0, 0n, VIEW)
    overwrite(role, 0, EMBED, SEND)
    expect(getChannelRolePermissions(db, guildId, channelId, role)).toBe(EMBED)
  })
})
