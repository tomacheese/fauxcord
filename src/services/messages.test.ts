import { describe, it, expect } from 'vitest'
import { toMessageObject, type MessageRow, type UserRow } from './messages'

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
    const object = toMessageObject(
      row,
      author,
      [],
      [],
      [{ emoji: '👍', count: 2 }],
      'http://localhost:3000'
    )
    expect(object.reactions).toHaveLength(1)
    const reaction = object.reactions?.[0]
    expect(reaction?.count).toBe(2)
    expect(reaction?.me).toBe(false)
    expect(reaction?.me_burst).toBe(false)
    expect(reaction?.burst_colors).toEqual([])
    expect(reaction?.count_details).toEqual({ burst: 0, normal: 2 })
    expect(reaction?.emoji).toEqual({ id: null, name: '👍' })
  })

  it('omits the reactions field entirely when there are no reactions', () => {
    const object = toMessageObject(
      row,
      author,
      [],
      [],
      [],
      'http://localhost:3000'
    )
    expect(object.reactions).toBeUndefined()
  })
})
