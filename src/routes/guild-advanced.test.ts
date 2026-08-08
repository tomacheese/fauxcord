import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../db'
import { closeDatabase } from '../db'
import {
  createFullTestApp,
  seedBot,
  seedChannel,
  seedGuild,
  seedMember,
  seedMessage,
  seedRole,
  seedVoiceChannel,
} from '../test-helpers'
import type { FullTestContext } from '../test-helpers'

describe('advanced guild routes', () => {
  let context: FullTestContext
  let db: Database
  let token: string
  let userId: string
  let guildId: string
  let channelId: string
  let voiceChannelId: string

  beforeEach(() => {
    context = createFullTestApp()
    db = context.db
    token = seedBot(db, 'Bot guild-advanced', '911111111111111111')
    userId = '911111111111111111'
    guildId = seedGuild(db, token, '922222222222222222')
    channelId = seedChannel(db, guildId, '933333333333333333')
    voiceChannelId = seedVoiceChannel(db, guildId, '944444444444444444')
    seedMember(db, guildId, userId)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  const jsonHeaders = () => ({
    Authorization: token,
    'Content-Type': 'application/json',
  })

  it('persists auto-moderation, bulk-ban, channel-position, onboarding, and role-position writes', async () => {
    const ruleRes = await context.app.request(
      `/api/v10/guilds/${guildId}/auto-moderation/rules`,
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          name: 'Default keywords',
          event_type: 1,
          trigger_type: 4,
          trigger_metadata: { allow_list: [], presets: [1] },
          actions: [{ type: 1, metadata: { custom_message: 'blocked' } }],
        }),
      }
    )
    expect(ruleRes.status).toBe(200)
    const rule = (await ruleRes.json()) as { id: string }
    const ruleList = await context.app.request(
      `/api/v10/guilds/${guildId}/auto-moderation/rules`,
      { headers: { Authorization: token } }
    )
    expect((await ruleList.json()) as { id: string }[]).toContainEqual(
      expect.objectContaining({ id: rule.id })
    )

    const bannedId = '955555555555555555'
    db.prepare(
      "INSERT INTO users (id, username) VALUES (?, 'Bulk target')"
    ).run(bannedId)
    const bulkBan = await context.app.request(
      `/api/v10/guilds/${guildId}/bulk-ban`,
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ user_ids: [bannedId] }),
      }
    )
    expect(await bulkBan.json()).toEqual({
      banned_users: [bannedId],
      failed_users: [],
    })

    const moveChannel = await context.app.request(
      `/api/v10/guilds/${guildId}/channels`,
      {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify([{ id: channelId, position: 7 }]),
      }
    )
    expect(moveChannel.status).toBe(204)
    expect(
      db.prepare('SELECT position FROM channels WHERE id = ?').get(channelId)
    ).toEqual({ position: 7 })

    const onboarding = await context.app.request(
      `/api/v10/guilds/${guildId}/onboarding`,
      {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({
          prompts: [],
          default_channel_ids: [channelId],
          enabled: true,
          mode: 0,
        }),
      }
    )
    expect(await onboarding.json()).toMatchObject({
      guild_id: guildId,
      enabled: true,
      default_channel_ids: [channelId],
    })

    const roleId = seedRole(db, guildId, 'movable')
    const roles = await context.app.request(
      `/api/v10/guilds/${guildId}/roles`,
      {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify([{ id: roleId, position: 4 }]),
      }
    )
    expect(roles.status).toBe(200)
    expect(
      (await roles.json()) as { id: string; position: number }[]
    ).toContainEqual(expect.objectContaining({ id: roleId, position: 4 }))
  })

  it('supports scheduled-event, sound, sticker, template, voice, welcome, and widget lifecycles', async () => {
    const eventRes = await context.app.request(
      `/api/v10/guilds/${guildId}/scheduled-events`,
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          name: 'Launch',
          privacy_level: 2,
          entity_type: 3,
          scheduled_start_time: '2030-01-01T00:00:00.000Z',
          scheduled_end_time: '2030-01-01T01:00:00.000Z',
          entity_metadata: { location: 'Fauxcord' },
        }),
      }
    )
    expect(eventRes.status).toBe(200)
    const event = (await eventRes.json()) as { id: string }
    const exceptionRes = await context.app.request(
      `/api/v10/guilds/${guildId}/scheduled-events/${event.id}/exceptions`,
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          scheduled_start_time: '2030-01-02T00:00:00.000Z',
          scheduled_end_time: '2030-01-02T01:00:00.000Z',
        }),
      }
    )
    expect(exceptionRes.status).toBe(200)

    const soundRes = await context.app.request(
      `/api/v10/guilds/${guildId}/soundboard-sounds`,
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          name: 'Airhorn',
          sound_id: '966666666666666666',
        }),
      }
    )
    expect(soundRes.status).toBe(201)
    expect(await soundRes.json()).toMatchObject({ name: 'Airhorn' })

    const stickerBody = new FormData()
    stickerBody.set('name', 'shipit')
    stickerBody.set('description', 'Ship it')
    stickerBody.set('tags', 'ship')
    stickerBody.set(
      'file',
      new File(['sticker'], 'sticker.png', { type: 'image/png' })
    )
    const stickerRes = await context.app.request(
      `/api/v10/guilds/${guildId}/stickers`,
      {
        method: 'POST',
        headers: { Authorization: token },
        body: stickerBody,
      }
    )
    expect(stickerRes.status).toBe(201)

    const templateRes = await context.app.request(
      `/api/v10/guilds/${guildId}/templates`,
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: 'Starter' }),
      }
    )
    const template = (await templateRes.json()) as { code: string }
    const publicTemplate = await context.app.request(
      `/api/v10/guilds/templates/${template.code}`
    )
    expect(publicTemplate.status).toBe(200)

    const voicePatch = await context.app.request(
      `/api/v10/guilds/${guildId}/voice-states/@me`,
      {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({
          channel_id: voiceChannelId,
          suppress: false,
        }),
      }
    )
    expect(voicePatch.status).toBe(204)

    const welcome = await context.app.request(
      `/api/v10/guilds/${guildId}/welcome-screen`,
      {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({
          enabled: true,
          description: 'Welcome!',
          welcome_channels: [],
        }),
      }
    )
    expect(await welcome.json()).toEqual({
      description: 'Welcome!',
      welcome_channels: [],
    })

    const widgetPatch = await context.app.request(
      `/api/v10/guilds/${guildId}/widget`,
      {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ enabled: true, channel_id: channelId }),
      }
    )
    expect(await widgetPatch.json()).toEqual({
      enabled: true,
      channel_id: channelId,
    })
    const png = await context.app.request(
      `/api/v10/guilds/${guildId}/widget.png`,
      { headers: { Authorization: token } }
    )
    expect(png.headers.get('content-type')).toContain('image/png')
    const pngBody = await png.arrayBuffer()
    expect(pngBody.byteLength).toBeGreaterThan(0)
  })

  it('exposes deterministic guild queries and validates malformed writes', async () => {
    seedMessage(db, channelId, userId, token, 'search needle')
    const paths = [
      'audit-logs',
      'integrations',
      'members/search?query=Test',
      'messages/search?content=needle',
      'preview',
      'prune?days=7',
      'regions',
      'requests',
      'roles/member-counts',
      'threads/active',
      'vanity-url',
      'widget.json',
    ]
    for (const path of paths) {
      const response = await context.app.request(
        `/api/v10/guilds/${guildId}/${path}`,
        { headers: { Authorization: token } }
      )
      expect(response.status, path).toBe(200)
    }

    const invalid = await context.app.request(
      `/api/v10/guilds/${guildId}/auto-moderation/rules`,
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: '{}',
      }
    )
    expect(invalid.status).toBe(400)
    expect((await invalid.json()) as { code: number }).toMatchObject({
      code: 50_035,
    })

    const unauthenticated = await context.app.request(
      `/api/v10/guilds/${guildId}/audit-logs`
    )
    expect(unauthenticated.status).toBe(401)
  })
})
