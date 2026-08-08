import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from '../db'
import { runInTransaction } from '../db'
import { DiscordErrorCode, validationError } from '../errors'
import type { AppEnv } from '../middleware/auth'
import { parseJsonBody } from '../lib/route-helpers'
import { getGuild } from '../services/guilds'
import {
  getGuildMember,
  getGuildMembers,
  updateGuildMember,
} from '../services/guild-members'
import { getGuildRoles, getRole, updateRole } from '../services/guild-roles'
import { listVoiceRegions } from '../services/catalog'
import { getGuildEmojis } from '../services/guild-emojis'
import { toThreadMemberObject, toThreadObject } from '../services/threads'
import type { ThreadMemberRow, ThreadRow } from '../services/threads'
import {
  createAutoModerationRule,
  createGuildScheduledEvent,
  createGuildSoundboardSound,
  createGuildSticker,
  createGuildTemplate,
  createScheduledEventException,
  deleteAutoModerationRule,
  deleteGuildScheduledEvent,
  deleteGuildSoundboardSound,
  deleteGuildSticker,
  deleteGuildTemplate,
  deleteScheduledEventException,
  getAutoModerationRule,
  getGuildOnboarding,
  getGuildPresentation,
  getGuildScheduledEvent,
  getGuildSoundboardSound,
  getGuildSticker,
  getGuildTemplate,
  getGuildVoiceState,
  getGuildWelcomeScreen,
  getGuildWidget,
  getGuildWidgetJson,
  getScheduledEventException,
  getScheduledEventUserCounts,
  listAutoModerationRules,
  listGuildScheduledEvents,
  listGuildSoundboardSounds,
  listGuildStickers,
  listGuildTemplates,
  listScheduledEventUsers,
  setGuildOnboarding,
  setGuildVoiceState,
  setGuildWelcomeScreen,
  setGuildWidget,
  updateAutoModerationRule,
  updateGuildScheduledEvent,
  updateGuildSoundboardSound,
  updateGuildSticker,
  updateGuildTemplate,
  updateScheduledEventException,
} from '../services/guild-advanced'
import { generateSnowflake } from '../snowflake'

type JsonObject = Record<string, unknown>

function unknown(c: Context<AppEnv>, code: number, message: string): Response {
  return c.json({ message, code }, 404)
}

function invalid(c: Context<AppEnv>, field: string): Response {
  return c.json(
    validationError({
      [field]: {
        _errors: [
          { code: 'BASE_TYPE_REQUIRED', message: 'This field is required' },
        ],
      },
    }).body,
    400
  )
}

function requireGuildAccess(
  c: Context<AppEnv>,
  db: Database,
  guildId: string
): Response | JsonObject {
  const row = db
    .prepare('SELECT bot_token FROM guilds WHERE id = ?')
    .get(guildId) as { bot_token: string } | undefined
  if (!row) return unknown(c, DiscordErrorCode.UNKNOWN_GUILD, 'Unknown Guild')
  const bot = c.get('bot')
  if (bot?.token !== row.bot_token) {
    return c.json(
      { message: 'Missing Access', code: DiscordErrorCode.MISSING_ACCESS },
      403
    )
  }
  return row
}

function ensureAuxiliaryTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_join_requests (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      application_status INTEGER,
      rejection_reason TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS guild_incident_actions (
      guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
      invites_disabled_until TEXT,
      dms_disabled_until TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS guild_integrations (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name TEXT,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS guild_prune_runs (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      days INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function joinRequestObject(row: {
  id: string
  guild_id: string
  user_id: string
  application_status: number | null
  rejection_reason: string | null
  reviewed_at: string | null
  created_at: string
}): JsonObject {
  return {
    id: row.id,
    created_at: new Date(`${row.created_at}Z`).toISOString(),
    reviewed_at: row.reviewed_at,
    application_status: row.application_status,
    rejection_reason: row.rejection_reason,
    guild_id: row.guild_id,
    user_id: row.user_id,
  }
}

/** Creates public guild-template routes mounted before authentication. */
export function createGuildAdvancedPublicRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/guilds/templates/:code', (c) => {
    const template = getGuildTemplate(db, c.req.param('code'))
    return template
      ? c.json(template)
      : unknown(c, DiscordErrorCode.UNKNOWN_GUILD, 'Unknown Guild Template')
  })
  return app
}

/** Creates authenticated advanced guild routes. */
export function createGuildAdvancedRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  ensureAuxiliaryTables(db)

  app.get('/guilds/:guildId/audit-logs', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return c.json({
      audit_log_entries: [],
      users: [],
      integrations: [],
      webhooks: [],
      guild_scheduled_events: listGuildScheduledEvents(db, guildId),
      threads: [],
      application_commands: [],
      auto_moderation_rules: listAutoModerationRules(db, guildId),
    })
  })

  app.get('/guilds/:guildId/auto-moderation/rules', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return c.json(listAutoModerationRules(db, guildId))
  })
  app.post('/guilds/:guildId/auto-moderation/rules', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    if (
      typeof payload.name !== 'string' ||
      !Array.isArray(payload.actions) ||
      typeof payload.trigger_type !== 'number'
    ) {
      return invalid(c, 'name')
    }
    return c.json(
      createAutoModerationRule(
        db,
        guildId,
        c.get('bot')?.user_id ?? '',
        payload
      )
    )
  })
  app.get('/guilds/:guildId/auto-moderation/rules/:ruleId', (c) => {
    const { guildId, ruleId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const rule = getAutoModerationRule(db, guildId, ruleId)
    return rule
      ? c.json(rule)
      : unknown(c, 10_023, 'Unknown Auto Moderation Rule')
  })
  app.patch('/guilds/:guildId/auto-moderation/rules/:ruleId', async (c) => {
    const { guildId, ruleId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const rule = updateAutoModerationRule(
      db,
      guildId,
      ruleId,
      await parseJsonBody(c)
    )
    return rule
      ? c.json(rule)
      : unknown(c, 10_023, 'Unknown Auto Moderation Rule')
  })
  app.delete('/guilds/:guildId/auto-moderation/rules/:ruleId', (c) => {
    const { guildId, ruleId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return deleteAutoModerationRule(db, guildId, ruleId)
      ? c.body(null, 204)
      : unknown(c, 10_023, 'Unknown Auto Moderation Rule')
  })

  app.post('/guilds/:guildId/bulk-ban', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    if (!Array.isArray(payload.user_ids) || payload.user_ids.length === 0) {
      return invalid(c, 'user_ids')
    }
    const banned: string[] = []
    const failed: string[] = []
    runInTransaction(db, () => {
      for (const value of payload.user_ids as unknown[]) {
        if (
          typeof value !== 'string' ||
          !db.prepare('SELECT 1 FROM users WHERE id = ?').get(value)
        ) {
          if (typeof value === 'string') failed.push(value)
          continue
        }
        db.prepare(
          'INSERT OR REPLACE INTO guild_bans (guild_id, user_id) VALUES (?, ?)'
        ).run(guildId, value)
        db.prepare(
          'DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?'
        ).run(guildId, value)
        banned.push(value)
      }
    })
    return c.json({ banned_users: banned, failed_users: failed })
  })

  app.patch('/guilds/:guildId/channels', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload: unknown = await c.req.json().catch(() => null)
    if (!Array.isArray(payload)) return invalid(c, 'body')
    runInTransaction(db, () => {
      for (const item of payload) {
        if (typeof item !== 'object' || item === null || !('id' in item)) {
          continue
        }
        const value = item as JsonObject
        db.prepare(
          `UPDATE channels SET position = COALESCE(?, position),
               parent_id = COALESCE(?, parent_id)
             WHERE guild_id = ? AND id = ?`
        ).run(
          value.position ?? null,
          value.parent_id ?? null,
          guildId,
          value.id
        )
      }
    })
    return c.body(null, 204)
  })

  app.put('/guilds/:guildId/incident-actions', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    db.prepare(
      `INSERT INTO guild_incident_actions
         (guild_id, invites_disabled_until, dms_disabled_until, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         invites_disabled_until = excluded.invites_disabled_until,
         dms_disabled_until = excluded.dms_disabled_until,
         updated_at = excluded.updated_at`
    ).run(
      guildId,
      payload.invites_disabled_until ?? null,
      payload.dms_disabled_until ?? null
    )
    return c.json({
      invites_disabled_until: payload.invites_disabled_until ?? null,
      dms_disabled_until: payload.dms_disabled_until ?? null,
    })
  })

  app.get('/guilds/:guildId/integrations', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return c.json([])
  })
  app.delete('/guilds/:guildId/integrations/:integrationId', (c) => {
    const { guildId, integrationId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    db.prepare(
      'UPDATE guild_integrations SET deleted = 1 WHERE guild_id = ? AND id = ?'
    ).run(guildId, integrationId)
    return c.body(null, 204)
  })

  app.get('/guilds/:guildId/members/search', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const query = (c.req.query('query') ?? '').toLowerCase()
    const limit = Math.min(Number(c.req.query('limit') ?? 1000), 1000)
    return c.json(
      getGuildMembers(db, guildId, 1000)
        .filter((member) =>
          `${member.nick ?? ''} ${member.user.username}`
            .toLowerCase()
            .includes(query)
        )
        .slice(0, limit)
    )
  })

  app.put('/guilds/:guildId/members/:userId', async (c) => {
    const { guildId, userId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    if (typeof payload.access_token !== 'string')
      return invalid(c, 'access_token')
    if (getGuildMember(db, guildId, userId)) {
      updateGuildMember(db, guildId, userId, {
        nick: typeof payload.nick === 'string' ? payload.nick : null,
      })
      return c.body(null, 204)
    }
    db.prepare(
      `INSERT OR IGNORE INTO users (id, username, discriminator, bot)
       VALUES (?, 'AddedMember', '0', 0)`
    ).run(userId)
    db.prepare(
      `INSERT INTO guild_members (guild_id, user_id, nick)
       VALUES (?, ?, ?)`
    ).run(
      guildId,
      userId,
      typeof payload.nick === 'string' ? payload.nick : null
    )
    return c.json(getGuildMember(db, guildId, userId), 201)
  })

  app.get('/guilds/:guildId/messages/search', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    if (c.req.query('indexing') === 'true') {
      return c.json(
        {
          message: 'Index not ready',
          code: 11_000,
          documents_indexed: 0,
          retry_after: 1,
        },
        202
      )
    }
    const content = c.req.query('content') ?? ''
    const count = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE c.guild_id = ? AND m.content LIKE ?`
        )
        .get(guildId, `%${content}%`) as { count: number }
    ).count
    return c.json({
      messages: [],
      doing_deep_historical_index: false,
      total_results: count,
    })
  })

  app.get('/guilds/:guildId/new-member-welcome', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const welcome = getGuildWelcomeScreen(db, guildId)
    if (!welcome.enabled) return c.body(null, 204)
    return c.json({
      guild_id: guildId,
      enabled: true,
      new_member_actions: [],
      resource_channels: [],
    })
  })

  app.get('/guilds/:guildId/onboarding', (c) => {
    const access = requireGuildAccess(c, db, c.req.param('guildId'))
    return access instanceof Response
      ? access
      : c.json(getGuildOnboarding(db, c.req.param('guildId')))
  })
  app.put('/guilds/:guildId/onboarding', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    if (
      !Array.isArray(payload.prompts) ||
      !Array.isArray(payload.default_channel_ids)
    ) {
      return invalid(c, 'prompts')
    }
    return c.json(setGuildOnboarding(db, guildId, payload))
  })

  app.get('/guilds/:guildId/preview', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const guild = getGuild(db, guildId, true)
    const presentation = getGuildPresentation(db, guildId)
    return c.json({
      id: guildId,
      name: guild?.name ?? 'Unknown Guild',
      icon: guild?.icon ?? null,
      description: presentation.description,
      home_header: null,
      splash: presentation.splash,
      discovery_splash: presentation.discovery_splash,
      features: presentation.features,
      approximate_member_count: guild?.approximate_member_count ?? 0,
      approximate_presence_count: 0,
      emojis: getGuildEmojis(db, guildId),
      stickers: listGuildStickers(db, guildId),
    })
  })

  app.get('/guilds/:guildId/prune', (c) => {
    const access = requireGuildAccess(c, db, c.req.param('guildId'))
    return access instanceof Response ? access : c.json({ pruned: 0 })
  })
  app.post('/guilds/:guildId/prune', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    if (
      payload.days !== undefined &&
      (typeof payload.days !== 'number' || payload.days < 1)
    ) {
      return invalid(c, 'days')
    }
    db.prepare(
      'INSERT INTO guild_prune_runs (id, guild_id, days) VALUES (?, ?, ?)'
    ).run(
      generateSnowflake(),
      guildId,
      typeof payload.days === 'number' ? payload.days : 7
    )
    return c.json({ pruned: 0 })
  })
  app.get('/guilds/:guildId/regions', (c) => {
    const access = requireGuildAccess(c, db, c.req.param('guildId'))
    return access instanceof Response ? access : c.json(listVoiceRegions())
  })

  app.get('/guilds/:guildId/requests', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const rows = db
      .prepare(
        'SELECT * FROM guild_join_requests WHERE guild_id = ? ORDER BY id'
      )
      .all(guildId) as Parameters<typeof joinRequestObject>[0][]
    return c.json({
      total: rows.length,
      guild_join_requests: rows.map((row) => joinRequestObject(row)),
    })
  })
  app.patch('/guilds/:guildId/requests/:requestId', async (c) => {
    const { guildId, requestId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    const userId =
      typeof payload.user_id === 'string'
        ? payload.user_id
        : (c.get('bot')?.user_id ?? '')
    db.prepare(
      `INSERT OR IGNORE INTO guild_join_requests (id, guild_id, user_id)
       VALUES (?, ?, ?)`
    ).run(requestId, guildId, userId)
    db.prepare(
      `UPDATE guild_join_requests SET application_status = ?, rejection_reason = ?,
       reviewed_at = ? WHERE guild_id = ? AND id = ?`
    ).run(
      payload.application_status ?? 'APPROVED',
      payload.rejection_reason ?? null,
      new Date().toISOString(),
      guildId,
      requestId
    )
    const row = db
      .prepare(
        'SELECT * FROM guild_join_requests WHERE guild_id = ? AND id = ?'
      )
      .get(guildId, requestId) as Parameters<typeof joinRequestObject>[0]
    return c.json(joinRequestObject(row))
  })

  app.patch('/guilds/:guildId/roles', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload: unknown = await c.req.json().catch(() => null)
    if (!Array.isArray(payload)) return invalid(c, 'body')
    for (const item of payload) {
      if (!(
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        'position' in item
      )) {
        continue
      }

      const value = item as { id: string; position: number }
      updateRole(db, guildId, value.id, { position: value.position })
    }
    return c.json(getGuildRoles(db, guildId))
  })
  app.get('/guilds/:guildId/roles/member-counts', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const rows = db
      .prepare(
        `SELECT role_id, COUNT(*) AS count FROM member_roles
       WHERE guild_id = ? GROUP BY role_id`
      )
      .all(guildId) as { role_id: string; count: number }[]
    return c.json(
      Object.fromEntries(rows.map((row) => [row.role_id, row.count]))
    )
  })
  app.get('/guilds/:guildId/roles/:roleId', (c) => {
    const { guildId, roleId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const role = getRole(db, guildId, roleId)
    return role
      ? c.json(role)
      : unknown(c, DiscordErrorCode.UNKNOWN_ROLE, 'Unknown Role')
  })

  app.get('/guilds/:guildId/scheduled-events', (c) => {
    const access = requireGuildAccess(c, db, c.req.param('guildId'))
    return access instanceof Response
      ? access
      : c.json(listGuildScheduledEvents(db, c.req.param('guildId')))
  })
  app.post('/guilds/:guildId/scheduled-events', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    if (
      typeof payload.name !== 'string' ||
      typeof payload.scheduled_start_time !== 'string'
    ) {
      return invalid(c, 'name')
    }
    return c.json(
      createGuildScheduledEvent(
        db,
        guildId,
        c.get('bot')?.user_id ?? '',
        payload
      )
    )
  })
  app.get('/guilds/:guildId/scheduled-events/:eventId/users/counts', (c) => {
    const { guildId, eventId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return getGuildScheduledEvent(db, guildId, eventId)
      ? c.json(getScheduledEventUserCounts(db, eventId))
      : unknown(c, 10_066, 'Unknown Guild Scheduled Event')
  })
  app.get('/guilds/:guildId/scheduled-events/:eventId/users', (c) => {
    const { guildId, eventId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return getGuildScheduledEvent(db, guildId, eventId)
      ? c.json(listScheduledEventUsers(db, eventId))
      : unknown(c, 10_066, 'Unknown Guild Scheduled Event')
  })
  app.get(
    '/guilds/:guildId/scheduled-events/:eventId/:exceptionId/users',
    (c) => {
      const { guildId, eventId, exceptionId } = c.req.param()
      const access = requireGuildAccess(c, db, guildId)
      if (access instanceof Response) return access
      return getScheduledEventException(db, eventId, exceptionId)
        ? c.json(listScheduledEventUsers(db, eventId, exceptionId))
        : unknown(c, 10_066, 'Unknown Guild Scheduled Event')
    }
  )
  app.post(
    '/guilds/:guildId/scheduled-events/:eventId/exceptions',
    async (c) => {
      const { guildId, eventId } = c.req.param()
      const access = requireGuildAccess(c, db, guildId)
      if (access instanceof Response) return access
      if (!getGuildScheduledEvent(db, guildId, eventId))
        return unknown(c, 10_066, 'Unknown Guild Scheduled Event')
      return c.json(
        createScheduledEventException(db, eventId, await parseJsonBody(c))
      )
    }
  )
  app.patch(
    '/guilds/:guildId/scheduled-events/:eventId/exceptions/:exceptionId',
    async (c) => {
      const { guildId, eventId, exceptionId } = c.req.param()
      const access = requireGuildAccess(c, db, guildId)
      if (access instanceof Response) return access
      const value = updateScheduledEventException(
        db,
        eventId,
        exceptionId,
        await parseJsonBody(c)
      )
      return value
        ? c.json(value)
        : unknown(c, 10_066, 'Unknown Guild Scheduled Event')
    }
  )
  app.delete(
    '/guilds/:guildId/scheduled-events/:eventId/exceptions/:exceptionId',
    (c) => {
      const { guildId, eventId, exceptionId } = c.req.param()
      const access = requireGuildAccess(c, db, guildId)
      if (access instanceof Response) return access
      return deleteScheduledEventException(db, eventId, exceptionId)
        ? c.body(null, 204)
        : unknown(c, 10_066, 'Unknown Guild Scheduled Event')
    }
  )
  app.get('/guilds/:guildId/scheduled-events/:eventId', (c) => {
    const { guildId, eventId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const event = getGuildScheduledEvent(db, guildId, eventId)
    return event
      ? c.json(event)
      : unknown(c, 10_066, 'Unknown Guild Scheduled Event')
  })
  app.patch('/guilds/:guildId/scheduled-events/:eventId', async (c) => {
    const { guildId, eventId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const event = updateGuildScheduledEvent(
      db,
      guildId,
      eventId,
      await parseJsonBody(c)
    )
    return event
      ? c.json(event)
      : unknown(c, 10_066, 'Unknown Guild Scheduled Event')
  })
  app.delete('/guilds/:guildId/scheduled-events/:eventId', (c) => {
    const { guildId, eventId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return deleteGuildScheduledEvent(db, guildId, eventId)
      ? c.body(null, 204)
      : unknown(c, 10_066, 'Unknown Guild Scheduled Event')
  })

  app.get('/guilds/:guildId/soundboard-sounds', (c) => {
    const access = requireGuildAccess(c, db, c.req.param('guildId'))
    return access instanceof Response
      ? access
      : c.json({ items: listGuildSoundboardSounds(db, c.req.param('guildId')) })
  })
  app.post('/guilds/:guildId/soundboard-sounds', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    if (typeof payload.name !== 'string') return invalid(c, 'name')
    return c.json(
      createGuildSoundboardSound(
        db,
        guildId,
        c.get('bot')?.user_id ?? '',
        payload
      ),
      201
    )
  })
  app.get('/guilds/:guildId/soundboard-sounds/:soundId', (c) => {
    const { guildId, soundId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const sound = getGuildSoundboardSound(db, guildId, soundId)
    return sound
      ? c.json(sound)
      : unknown(c, 10_012, 'Unknown Soundboard Sound')
  })
  app.patch('/guilds/:guildId/soundboard-sounds/:soundId', async (c) => {
    const { guildId, soundId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const sound = updateGuildSoundboardSound(
      db,
      guildId,
      soundId,
      await parseJsonBody(c)
    )
    return sound
      ? c.json(sound)
      : unknown(c, 10_012, 'Unknown Soundboard Sound')
  })
  app.delete('/guilds/:guildId/soundboard-sounds/:soundId', (c) => {
    const { guildId, soundId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return deleteGuildSoundboardSound(db, guildId, soundId)
      ? c.body(null, 204)
      : unknown(c, 10_012, 'Unknown Soundboard Sound')
  })

  app.get('/guilds/:guildId/stickers', (c) => {
    const access = requireGuildAccess(c, db, c.req.param('guildId'))
    return access instanceof Response
      ? access
      : c.json(listGuildStickers(db, c.req.param('guildId')))
  })
  app.post('/guilds/:guildId/stickers', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const form = await c.req.formData().catch(() => null)
    const name = form?.get('name')
    const description = form?.get('description')
    const tags = form?.get('tags')
    const file = form?.get('file')
    if (
      typeof name !== 'string' ||
      typeof tags !== 'string' ||
      !(file instanceof File)
    ) {
      return invalid(c, 'file')
    }
    return c.json(
      createGuildSticker(db, guildId, c.get('bot')?.user_id ?? '', {
        name,
        description: typeof description === 'string' ? description : null,
        tags,
      }),
      201
    )
  })
  app.get('/guilds/:guildId/stickers/:stickerId', (c) => {
    const { guildId, stickerId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const sticker = getGuildSticker(db, guildId, stickerId)
    return sticker ? c.json(sticker) : unknown(c, 10_038, 'Unknown Sticker')
  })
  app.patch('/guilds/:guildId/stickers/:stickerId', async (c) => {
    const { guildId, stickerId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const sticker = updateGuildSticker(
      db,
      guildId,
      stickerId,
      await parseJsonBody(c)
    )
    return sticker ? c.json(sticker) : unknown(c, 10_038, 'Unknown Sticker')
  })
  app.delete('/guilds/:guildId/stickers/:stickerId', (c) => {
    const { guildId, stickerId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return deleteGuildSticker(db, guildId, stickerId)
      ? c.body(null, 204)
      : unknown(c, 10_038, 'Unknown Sticker')
  })

  app.get('/guilds/:guildId/templates', (c) => {
    const access = requireGuildAccess(c, db, c.req.param('guildId'))
    return access instanceof Response
      ? access
      : c.json(listGuildTemplates(db, c.req.param('guildId')))
  })
  app.post('/guilds/:guildId/templates', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const payload = await parseJsonBody(c)
    if (typeof payload.name !== 'string') return invalid(c, 'name')
    return c.json(
      createGuildTemplate(db, guildId, c.get('bot')?.user_id ?? '', payload)
    )
  })
  app.put('/guilds/:guildId/templates/:code', (c) => {
    const { guildId, code } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const template = updateGuildTemplate(db, guildId, code)
    return template
      ? c.json(template)
      : unknown(c, 10_057, 'Unknown Guild Template')
  })
  app.patch('/guilds/:guildId/templates/:code', async (c) => {
    const { guildId, code } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const template = updateGuildTemplate(
      db,
      guildId,
      code,
      await parseJsonBody(c)
    )
    return template
      ? c.json(template)
      : unknown(c, 10_057, 'Unknown Guild Template')
  })
  app.delete('/guilds/:guildId/templates/:code', (c) => {
    const { guildId, code } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const template = deleteGuildTemplate(db, guildId, code)
    return template
      ? c.json(template)
      : unknown(c, 10_057, 'Unknown Guild Template')
  })

  app.get('/guilds/:guildId/threads/active', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const rows = db
      .prepare(
        'SELECT * FROM channels WHERE guild_id = ? AND type IN (10, 11, 12) AND archived = 0 ORDER BY id'
      )
      .all(guildId) as ThreadRow[]
    const memberRows = db
      .prepare(
        `SELECT tm.thread_id, tm.user_id, tm.join_timestamp, tm.flags
       FROM thread_members tm JOIN channels c ON c.id = tm.thread_id
       WHERE c.guild_id = ? AND c.archived = 0 ORDER BY tm.thread_id, tm.user_id`
      )
      .all(guildId) as ThreadMemberRow[]
    return c.json({
      threads: rows.map((row) => toThreadObject(db, row)),
      members: memberRows.map((row) => toThreadMemberObject(row)),
      has_more: false,
    })
  })
  app.get('/guilds/:guildId/vanity-url', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    return c.json({
      code: getGuildPresentation(db, guildId).vanity_url_code,
      uses: 0,
    })
  })

  app.get('/guilds/:guildId/voice-states/@me', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const state = getGuildVoiceState(db, guildId, c.get('bot')?.user_id ?? '')
    return state
      ? c.json(state)
      : unknown(c, DiscordErrorCode.UNKNOWN_MEMBER, 'Unknown Member')
  })
  app.patch('/guilds/:guildId/voice-states/@me', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    setGuildVoiceState(
      db,
      guildId,
      c.get('bot')?.user_id ?? '',
      await parseJsonBody(c)
    )
    return c.body(null, 204)
  })
  app.get('/guilds/:guildId/voice-states/:userId', (c) => {
    const { guildId, userId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const state = getGuildVoiceState(db, guildId, userId)
    return state
      ? c.json(state)
      : unknown(c, DiscordErrorCode.UNKNOWN_MEMBER, 'Unknown Member')
  })
  app.patch('/guilds/:guildId/voice-states/:userId', async (c) => {
    const { guildId, userId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    if (!getGuildMember(db, guildId, userId))
      return unknown(c, DiscordErrorCode.UNKNOWN_MEMBER, 'Unknown Member')
    setGuildVoiceState(db, guildId, userId, await parseJsonBody(c))
    return c.body(null, 204)
  })

  app.get('/guilds/:guildId/welcome-screen', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const { description, welcome_channels: channels } = getGuildWelcomeScreen(
      db,
      guildId
    )
    return c.json({ description, welcome_channels: channels })
  })
  app.patch('/guilds/:guildId/welcome-screen', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    if (access instanceof Response) return access
    const { description, welcome_channels: channels } = setGuildWelcomeScreen(
      db,
      guildId,
      await parseJsonBody(c)
    )
    return c.json({ description, welcome_channels: channels })
  })
  app.get('/guilds/:guildId/widget', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    return access instanceof Response
      ? access
      : c.json(getGuildWidget(db, guildId))
  })
  app.patch('/guilds/:guildId/widget', async (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    return access instanceof Response
      ? access
      : c.json(setGuildWidget(db, guildId, await parseJsonBody(c)))
  })
  app.get('/guilds/:guildId/widget.json', (c) => {
    const { guildId } = c.req.param()
    const access = requireGuildAccess(c, db, guildId)
    return access instanceof Response
      ? access
      : c.json(getGuildWidgetJson(db, guildId))
  })
  app.get('/guilds/:guildId/widget.png', (c) => {
    const access = requireGuildAccess(c, db, c.req.param('guildId'))
    if (access instanceof Response) return access
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    return c.body(png, 200, { 'Content-Type': 'image/png' })
  })

  return app
}
