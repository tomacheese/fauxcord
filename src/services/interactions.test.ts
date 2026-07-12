import { describe, it, expect, beforeEach, vi } from 'vitest'
import { initializeDatabase } from '../db'
import type { Database } from '../db'
import { gatewayBus } from '../gateway/bus'
import {
  createInteraction,
  getInteractionFollowupTarget,
  handleInteractionCallback,
} from './interactions'

const BASE_URL = 'http://localhost:3000'

describe('interactions service', () => {
  let db: Database
  const applicationId = '111111111111111111'
  const channelId = '222222222222222222'
  const userId = '333333333333333333'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    db.prepare(
      "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'AppUser', '0', 1)"
    ).run(applicationId)
    db.prepare(
      "INSERT INTO channels (id, guild_id, type, name) VALUES (?, NULL, 0, 'general')"
    ).run(channelId)
    db.prepare(
      "INSERT INTO users (id, username, discriminator, bot) VALUES (?, 'Caller', '0', 0)"
    ).run(userId)
  })

  it('creates an interaction and emits interaction.create', () => {
    const spy = vi.fn()
    gatewayBus.on('interaction.create', spy)

    const interaction = createInteraction(db, {
      interactionId: 'int1',
      applicationId,
      token: 'token1',
      type: 2,
      channelId,
      userId,
      data: { name: 'ping' },
    })

    expect(interaction.id).toBe('int1')
    expect(interaction.application_id).toBe(applicationId)
    expect(interaction.channel_id).toBe(channelId)
    expect(interaction.user).toMatchObject({ id: userId })
    expect(spy).toHaveBeenCalledWith({
      applicationId,
      interaction: expect.objectContaining({ id: 'int1' }),
    })

    gatewayBus.off('interaction.create', spy)
  })

  it('resolves a followup target for a known interaction token', () => {
    createInteraction(db, {
      interactionId: 'int2',
      applicationId,
      token: 'token2',
      type: 2,
      channelId,
      userId,
    })
    const target = getInteractionFollowupTarget(db, applicationId, 'token2')
    expect(target).toEqual({ channelId, initialResponseMessageId: null })
  })

  it('returns null for an unknown followup token', () => {
    expect(
      getInteractionFollowupTarget(db, applicationId, 'unknown')
    ).toBeNull()
  })

  it('handles a type-4 callback by creating a message and recording responded', () => {
    createInteraction(db, {
      interactionId: 'int3',
      applicationId,
      token: 'token3',
      type: 2,
      channelId,
      userId,
    })

    const result = handleInteractionCallback(
      db,
      'int3',
      'token3',
      { type: 4, data: { content: 'pong' } },
      BASE_URL
    )
    expect(result).toEqual({ ok: true })

    const target = getInteractionFollowupTarget(db, applicationId, 'token3')
    expect(target?.initialResponseMessageId).not.toBeNull()
  })

  it('returns not_found for an unknown interaction', () => {
    const result = handleInteractionCallback(
      db,
      'missing',
      'missing',
      { type: 5 },
      BASE_URL
    )
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns already_responded on a second callback', () => {
    createInteraction(db, {
      interactionId: 'int4',
      applicationId,
      token: 'token4',
      type: 2,
      channelId,
      userId,
    })
    handleInteractionCallback(db, 'int4', 'token4', { type: 5 }, BASE_URL)
    const second = handleInteractionCallback(
      db,
      'int4',
      'token4',
      { type: 5 },
      BASE_URL
    )
    expect(second).toEqual({ ok: false, reason: 'already_responded' })
  })
})
