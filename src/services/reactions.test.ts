import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import type { Database } from '../db'
import { addReaction, removeReaction } from './reactions'
import { gatewayBus } from '../gateway/bus'
import { seedBot, seedGuild, seedChannel, seedMessage } from '../test-helpers'

describe('reactions service', () => {
  let db: Database
  let channelId: string
  let messageId: string
  const userId = '555555555555555555'

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    const bot = seedBot(db)
    const guild = seedGuild(db, bot)
    channelId = seedChannel(db, guild)
    messageId = seedMessage(db, channelId, '111111111111111111', bot)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  describe('addReaction', () => {
    it('emits message.reaction.add and returns true on a genuine new reaction', () => {
      const listener = vi.fn()
      gatewayBus.on('message.reaction.add', listener)
      try {
        const result = addReaction(db, messageId, userId, '👍')
        expect(result).toBe(true)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ channelId, messageId, userId })
        )
      } finally {
        gatewayBus.off('message.reaction.add', listener)
      }
    })

    it('does not emit message.reaction.add when the reaction already exists (INSERT OR IGNORE no-op)', () => {
      addReaction(db, messageId, userId, '👍')

      const listener = vi.fn()
      gatewayBus.on('message.reaction.add', listener)
      try {
        const result = addReaction(db, messageId, userId, '👍')
        // Return value semantics are unchanged: still reports success even
        // though no new row was inserted.
        expect(result).toBe(true)
        expect(listener).not.toHaveBeenCalled()
      } finally {
        gatewayBus.off('message.reaction.add', listener)
      }
    })
  })

  describe('removeReaction', () => {
    it('emits message.reaction.remove when a reaction was actually deleted', () => {
      addReaction(db, messageId, userId, '👍')

      const listener = vi.fn()
      gatewayBus.on('message.reaction.remove', listener)
      try {
        removeReaction(db, messageId, userId, '👍')
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
        removeReaction(db, messageId, userId, '👍')
        expect(listener).not.toHaveBeenCalled()
      } finally {
        gatewayBus.off('message.reaction.remove', listener)
      }
    })
  })
})
