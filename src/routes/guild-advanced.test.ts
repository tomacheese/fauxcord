import { inflateSync } from 'node:zlib'
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
  seedScheduledEvent,
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
  })

  it('serves public widget data and a decodable PNG while retaining authentication for guild management', async () => {
    const widget = await context.app.request(
      `/api/v10/guilds/${guildId}/widget.json`
    )
    expect(widget.status).toBe(200)
    expect(await widget.json()).toMatchObject({ id: guildId })

    const png = await context.app.request(
      `/api/v10/guilds/${guildId}/widget.png?style=shield`
    )
    expect(png.status).toBe(200)
    expect(png.headers.get('content-type')).toContain('image/png')

    const bytes = Buffer.from(await png.arrayBuffer())
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )

    const chunkTypes: string[] = []
    const imageData: Buffer[] = []
    let offset = 8
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset)
      const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
      const data = bytes.subarray(offset + 8, offset + 8 + length)
      chunkTypes.push(type)
      if (type === 'IHDR') {
        expect(length).toBe(13)
        expect(data.readUInt32BE(0)).toBe(1)
        expect(data.readUInt32BE(4)).toBe(1)
      }
      if (type === 'IDAT') imageData.push(data)
      offset += length + 12
    }
    expect(offset).toBe(bytes.length)
    expect(chunkTypes).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(inflateSync(Buffer.concat(imageData))).toEqual(
      Buffer.from([1, 0, 255])
    )

    for (const protectedPath of ['audit-logs', 'widget']) {
      const protectedResponse = await context.app.request(
        `/api/v10/guilds/${guildId}/${protectedPath}`
      )
      expect(protectedResponse.status, protectedPath).toBe(401)
    }
  })

  it('rejects malformed Snowflake path parameters with Discord validation code 50035', async () => {
    const { eventId } = seedScheduledEvent(db, guildId, userId, voiceChannelId)
    const requests: {
      name: string
      path: string
      init?: RequestInit
    }[] = [
      {
        name: 'guild_id',
        path: '/api/v10/guilds/not-a-snowflake/audit-logs',
      },
      {
        name: 'rule_id',
        path: `/api/v10/guilds/${guildId}/auto-moderation/rules/not-a-snowflake`,
      },
      {
        name: 'integration_id',
        path: `/api/v10/guilds/${guildId}/integrations/not-a-snowflake`,
        init: { method: 'DELETE' },
      },
      {
        name: 'user_id on a member route',
        path: `/api/v10/guilds/${guildId}/members/not-a-snowflake`,
        init: {
          method: 'PUT',
          body: JSON.stringify({ access_token: 'member-token' }),
        },
      },
      {
        name: 'request_id',
        path: `/api/v10/guilds/${guildId}/requests/not-a-snowflake`,
        init: { method: 'PATCH', body: '{}' },
      },
      {
        name: 'role_id',
        path: `/api/v10/guilds/${guildId}/roles/not-a-snowflake`,
      },
      {
        name: 'event_id',
        path: `/api/v10/guilds/${guildId}/scheduled-events/not-a-snowflake`,
      },
      {
        name: 'exception_id',
        path: `/api/v10/guilds/${guildId}/scheduled-events/${eventId}/exceptions/not-a-snowflake`,
      },
      {
        name: 'exception_id on an event users route',
        path: `/api/v10/guilds/${guildId}/scheduled-events/${eventId}/not-a-snowflake/users`,
      },
      {
        name: 'sound_id',
        path: `/api/v10/guilds/${guildId}/soundboard-sounds/not-a-snowflake`,
      },
      {
        name: 'sticker_id',
        path: `/api/v10/guilds/${guildId}/stickers/not-a-snowflake`,
      },
      {
        name: 'user_id on a voice-state route',
        path: `/api/v10/guilds/${guildId}/voice-states/not-a-snowflake`,
      },
    ]

    for (const request of requests) {
      const response = await context.app.request(request.path, {
        ...request.init,
        headers: {
          Authorization: token,
          ...(request.init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })
      expect(response.status, request.name).toBe(400)
      expect(await response.json(), request.name).toMatchObject({
        code: 50_035,
      })
    }

    const publicWidget = await context.app.request(
      '/api/v10/guilds/not-a-snowflake/widget.json'
    )
    expect(publicWidget.status).toBe(400)
    expect(await publicWidget.json()).toMatchObject({ code: 50_035 })
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
