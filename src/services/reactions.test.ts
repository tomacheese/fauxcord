import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../database'
import type { Database } from '../database'
import { didAddReaction, removeReaction } from './reactions'
import { gatewayBus } from '../gateway/bus'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'

describe('reactions service', () => {
  let database: Database
  let channelId: string
  let messageId: string
  const userId = '555555555555555555'

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    const bot = seedBot(database)
    const guild = seedGuild(database, bot)
    channelId = seedChannel(database, guild)
    messageId = seedMessage(database, channelId, '111111111111111111', bot)
  })

  afterEach(() => {
    closeDatabase(database)
  })

  describe('addReaction', () => {
    it('emits message.reaction.add and returns true on a genuine new reaction', () => {
      const listener = vi.fn()
      gatewayBus.on('message.reaction.add', listener)
      try {
        const isResult = didAddReaction(database, messageId, userId, '👍')
        expect(isResult).toBe(true)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ channelId, messageId, userId })
        )
      } finally {
        gatewayBus.off('message.reaction.add', listener)
      }
    })

    it('does not emit message.reaction.add when the reaction already exists (INSERT OR IGNORE no-op)', () => {
      didAddReaction(database, messageId, userId, '👍')

      const listener = vi.fn()
      gatewayBus.on('message.reaction.add', listener)
      try {
        const isResult = didAddReaction(database, messageId, userId, '👍')
        // Return value semantics are unchanged: still reports success even
        // though no new row was inserted.
        expect(isResult).toBe(true)
        expect(listener).not.toHaveBeenCalled()
      } finally {
        gatewayBus.off('message.reaction.add', listener)
      }
    })
  })

  describe('removeReaction', () => {
    it('emits message.reaction.remove when a reaction was actually deleted', () => {
      didAddReaction(database, messageId, userId, '👍')

      const listener = vi.fn()
      gatewayBus.on('message.reaction.remove', listener)
      try {
        removeReaction(database, messageId, userId, '👍')
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ channelId, messageId, userId })
        )
      } finally {
        gatewayBus.off('message.reaction.remove', listener)
      }
    })

    it('does not emit message.reaction.remove when there was nothing to delete', () => {
      const listener = vi.fn()
      gatewayBus.on('message.reaction.remove', listener)
      try {
        // No reaction was ever added, so the DELETE removes zero rows.
        removeReaction(database, messageId, userId, '👍')
        expect(listener).not.toHaveBeenCalled()
      } finally {
        gatewayBus.off('message.reaction.remove', listener)
      }
    })
  })
})
