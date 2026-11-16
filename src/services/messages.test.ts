import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  toMessageObject,
  createMessage,
  updateMessage,
  type MessageRow,
  type UserRow,
} from './messages'
import { initializeDatabase, closeDatabase, type Database } from '../db'
import { gatewayBus } from '../gateway/bus'
import { seedBot, seedGuild, seedChannel } from '../test-helpers'

describe('toMessageObject', () => {
  const row: MessageRow = {
    id: '1',
    channel_id: '2',
    author_id: '3',
    author_token: 'Bot test',
    content: 'hello',
    tts: 0,
    mention_everyone: 0,
    pinned: 0,
    type: 0,
    flags: 0,
    referenced_message_id: null,
    created_at: '2026-01-01 00:00:00',
    edited_at: null,
  }
  const author: UserRow = {
    id: '3',
    username: 'bot',
    discriminator: '0',
    avatar: null,
    bot: 1,
  }

  it('includes the full Reaction shape (count_details, me_burst, burst_colors)', () => {
    // Real Discord's Reaction object (discord-api-types APIReaction) requires
    // count_details/me_burst/burst_colors — omitting them causes a real
    // NullReferenceException in Discord.Net.Rest's RestReaction.Create,
    // confirmed via the compat/dotnet-discordnet verifier.
    const obj = toMessageObject(
      row,
      author,
      [],
      [],
      [{ emoji: '👍', count: 2 }],
      'http://localhost:3000'
    )
    expect(obj.reactions).toHaveLength(1)
    const reaction = obj.reactions?.[0]
    expect(reaction?.count).toBe(2)
    expect(reaction?.me).toBe(false)
    expect(reaction?.me_burst).toBe(false)
    expect(reaction?.burst_colors).toEqual([])
    expect(reaction?.count_details).toEqual({ burst: 0, normal: 2 })
    expect(reaction?.emoji).toEqual({ id: null, name: '👍' })
  })

  it('omits the reactions field entirely when there are no reactions', () => {
    const obj = toMessageObject(
      row,
      author,
      [],
      [],
      [],
      'http://localhost:3000'
    )
    expect(obj.reactions).toBeUndefined()
  })
})

describe('poll in message hydration and Gateway events', () => {
  const BASE_URL = 'http://localhost:3000'
  const AUTHOR_ID = '111111111111111111'
  let db: Database
  let channelId: string
  let created: { message: Record<string, unknown> }[]
  let updated: { message: Record<string, unknown> }[]
  const onCreate = (payload: { message: Record<string, unknown> }): void => {
    created.push(payload)
  }
  const onUpdate = (payload: { message: Record<string, unknown> }): void => {
    updated.push(payload)
  }

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    const token = seedBot(db)
    channelId = seedChannel(db, seedGuild(db, token))
    created = []
    updated = []
    gatewayBus.on('message.create', onCreate)
    gatewayBus.on('message.update', onUpdate)
  })

  afterEach(() => {
    gatewayBus.off('message.create', onCreate)
    gatewayBus.off('message.update', onUpdate)
    closeDatabase(db)
  })

  const pollParams = {
    question: 'Best pizza?',
    answers: [{ text: 'Margherita' }, { text: 'Pepperoni' }],
  }

  it('includes the poll in the message.create payload', () => {
    const msg = createMessage(
      db,
      {
        channelId,
        authorId: AUTHOR_ID,
        authorToken: 'Bot testtoken',
        messageId: '222222222222222222',
        poll: pollParams,
      },
      BASE_URL
    )

    expect(msg.poll?.question).toEqual({ text: 'Best pizza?' })
    expect(msg.poll?.answers.map((a) => a.answer_id)).toEqual([1, 2])
    expect(created).toHaveLength(1)
    expect(created[0].message.poll).toEqual(msg.poll)
  })

  it('keeps the poll in the message.update payload', () => {
    const msg = createMessage(
      db,
      {
        channelId,
        authorId: AUTHOR_ID,
        authorToken: 'Bot testtoken',
        messageId: '222222222222222222',
        content: 'before',
        poll: pollParams,
      },
      BASE_URL
    )

    updateMessage(db, msg.id, { content: 'after' }, BASE_URL)

    expect(updated).toHaveLength(1)
    expect(updated[0].message.poll).toEqual(msg.poll)
  })

  it('omits the poll key on messages without a poll', () => {
    const msg = createMessage(
      db,
      {
        channelId,
        authorId: AUTHOR_ID,
        authorToken: 'Bot testtoken',
        messageId: '222222222222222222',
        content: 'plain',
      },
      BASE_URL
    )

    expect('poll' in msg).toBe(false)
    expect('poll' in created[0].message).toBe(false)
  })
})
