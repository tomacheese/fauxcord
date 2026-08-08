import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createSoundboardRoutes } from './soundboard'
import { createFullTestApp, seedChannel, seedGuild } from '../test-helpers'
import { closeDatabase } from '../db'
import type { AppEnv } from '../middleware/auth'
import { countSoundboardPlaybacks } from '../services/soundboard'

describe('Soundboard API', () => {
  describe('GET /soundboard-default-sounds', () => {
    it('returns an empty array', async () => {
      const app = new Hono<AppEnv>()
      app.route('/', createSoundboardRoutes())

      const res = await app.request('/soundboard-default-sounds', {
        headers: { Authorization: 'Bot testtoken' },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[]
      expect(body).toEqual([])
    })

    it('returns 401 when no Authorization header is provided', async () => {
      const { app, db } = createFullTestApp()
      const res = await app.request('/api/v10/soundboard-default-sounds')
      expect(res.status).toBe(401)
      closeDatabase(db)
    })
  })

  describe('POST /channels/:channelId/send-soundboard-sound', () => {
    it('records the requested playback for the authenticated bot', async () => {
      const { app, db } = createFullTestApp()
      const token = 'Bot soundboard-playback'
      const userId = '811111111111111111'
      db.prepare(
        "INSERT INTO users (id, username, bot) VALUES (?, 'SoundboardBot', 1)"
      ).run(userId)
      db.prepare(
        "INSERT INTO bots (token, user_id, username) VALUES (?, ?, 'SoundboardBot')"
      ).run(token, userId)
      const guildId = seedGuild(db, token, '822222222222222222')
      const channelId = seedChannel(db, guildId, '833333333333333333')

      const res = await app.request(
        `/api/v10/channels/${channelId}/send-soundboard-sound`,
        {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sound_id: '844444444444444444' }),
        }
      )

      expect(res.status).toBe(204)
      expect(countSoundboardPlaybacks(db, channelId)).toBe(1)
      closeDatabase(db)
    })

    it('rejects a missing sound_id with Discord validation code 50035', async () => {
      const { app, db } = createFullTestApp()
      const token = 'Bot soundboard-validation'
      const userId = '855555555555555555'
      db.prepare(
        "INSERT INTO users (id, username, bot) VALUES (?, 'SoundboardBot', 1)"
      ).run(userId)
      db.prepare(
        "INSERT INTO bots (token, user_id, username) VALUES (?, ?, 'SoundboardBot')"
      ).run(token, userId)
      const guildId = seedGuild(db, token, '866666666666666666')
      const channelId = seedChannel(db, guildId, '877777777777777777')

      const res = await app.request(
        `/api/v10/channels/${channelId}/send-soundboard-sound`,
        {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: '{}',
        }
      )

      expect(res.status).toBe(400)
      expect((await res.json()) as { code: number }).toMatchObject({
        code: 50_035,
      })
      closeDatabase(db)
    })

    it('rejects a malformed channel Snowflake before looking up the channel', async () => {
      const { app, db } = createFullTestApp()
      const token = 'Bot soundboard-channel-validation'
      const userId = '888888888888888888'
      db.prepare(
        "INSERT INTO users (id, username, bot) VALUES (?, 'SoundboardBot', 1)"
      ).run(userId)
      db.prepare(
        "INSERT INTO bots (token, user_id, username) VALUES (?, ?, 'SoundboardBot')"
      ).run(token, userId)

      for (const malformedChannelId of ['01', '-1', 'not-a-snowflake']) {
        const res = await app.request(
          `/api/v10/channels/${malformedChannelId}/send-soundboard-sound`,
          {
            method: 'POST',
            headers: {
              Authorization: token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sound_id: '899999999999999999' }),
          }
        )

        expect(res.status, malformedChannelId).toBe(400)
        expect(await res.json(), malformedChannelId).toMatchObject({
          code: 50_035,
        })
      }
      closeDatabase(db)
    })

    it('accepts OpenAPI Snowflake boundaries and continues to channel lookup', async () => {
      const { app, db } = createFullTestApp()
      const token = 'Bot soundboard-channel-boundaries'
      const userId = '811111111111111112'
      db.prepare(
        "INSERT INTO users (id, username, bot) VALUES (?, 'SoundboardBot', 1)"
      ).run(userId)
      db.prepare(
        "INSERT INTO bots (token, user_id, username) VALUES (?, ?, 'SoundboardBot')"
      ).run(token, userId)

      for (const channelId of [
        '0',
        '7',
        '1234567890123456789012345678901234567890',
      ]) {
        const res = await app.request(
          `/api/v10/channels/${channelId}/send-soundboard-sound`,
          {
            method: 'POST',
            headers: {
              Authorization: token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sound_id: '899999999999999999' }),
          }
        )

        expect(res.status, channelId).toBe(404)
        expect(await res.json(), channelId).toMatchObject({ code: 10_003 })
      }
      closeDatabase(db)
    })
  })
})
