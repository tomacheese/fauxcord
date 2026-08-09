import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { GatewayIntentBits } from 'discord-api-types/v10'
import { createTestGatewayServer, seedBot, seedGuild } from '../test-helpers'
import { GatewayOp } from './opcodes'

/**
 * Queues every incoming WebSocket message as it arrives, so that messages
 * sent back-to-back by the server in the same synchronous burst (e.g. READY
 * immediately followed by GUILD_CREATE) are never dropped. A sequence of
 * `ws.once('message', ...)` calls made *after* the fact would miss a second
 * frame that arrived before the next listener was registered.
 * @param ws - The WebSocket to read from
 * @returns A function that resolves with the next queued message
 */
function createMessageReader(
  ws: WebSocket
): () => Promise<Record<string, unknown>> {
  const queue: Record<string, unknown>[] = []
  const waiters: ((message: Record<string, unknown>) => void)[] = []
  ws.on('message', (raw: Buffer) => {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>
    const waiter = waiters.shift()
    if (waiter) {
      waiter(message)
    } else {
      queue.push(message)
    }
  })
  return () =>
    new Promise((resolve) => {
      const queued = queue.shift()
      if (queued) {
        resolve(queued)
      } else {
        waiters.push(resolve)
      }
    })
}

describe('CHANNEL_CREATE dispatch (integration)', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('delivers CHANNEL_CREATE over the websocket after a REST channel is created', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const bot = seedBot(db, 'Bot gwtoken2')
    const guild = seedGuild(db, bot, '411111111111111111')

    const ws = new WebSocket(url)
    const nextMessage = createMessageReader(ws)
    await nextMessage() // HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot gwtoken2', intents: GatewayIntentBits.Guilds },
      })
    )
    await nextMessage() // READY
    // With the Guilds intent, READY is immediately followed by a GUILD_CREATE
    // for the pre-existing seeded guild (mirroring real Discord's post-READY
    // guild-availability dispatch) -- consume it before listening for the
    // CHANNEL_CREATE this test actually cares about.
    await nextMessage() // GUILD_CREATE

    // Create a channel via REST
    const httpUrl = url.replace('ws://', 'http://')
    await fetch(`${httpUrl}/api/v10/guilds/${guild}/channels`, {
      method: 'POST',
      headers: {
        Authorization: 'Bot gwtoken2',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'new-channel', type: 0 }),
    })

    const dispatch = await nextMessage()
    expect(dispatch.t).toBe('CHANNEL_CREATE')
    expect((dispatch.d as { name: string }).name).toBe('new-channel')

    ws.close()
  })
})

describe('GUILD_CREATE dispatch after READY (integration)', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('dispatches GUILD_CREATE for guilds the bot already belongs to, when the Guilds intent is set', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const bot = seedBot(db, 'Bot preexisting-guild')
    const guild = seedGuild(db, bot, 'PreexistingGuild')

    const ws = new WebSocket(url)
    const nextMessage = createMessageReader(ws)
    await nextMessage() // HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: {
          token: 'Bot preexisting-guild',
          intents: GatewayIntentBits.Guilds,
        },
      })
    )
    await nextMessage() // READY

    const dispatch = await nextMessage()
    expect(dispatch.t).toBe('GUILD_CREATE')
    expect((dispatch.d as { id: string }).id).toBe(guild)

    ws.close()
  })

  it('does not dispatch GUILD_CREATE for pre-existing guilds without the Guilds intent', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const bot = seedBot(db, 'Bot preexisting-guild-nointent')
    seedGuild(db, bot, 'PreexistingGuildNoIntent')

    const ws = new WebSocket(url)
    const nextMessage = createMessageReader(ws)
    await nextMessage() // HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot preexisting-guild-nointent', intents: 0 },
      })
    )
    await nextMessage() // READY

    // No further message should arrive; race the next message against a
    // short timeout to confirm GUILD_CREATE is withheld without the intent.
    const timeout = new Promise<'timeout'>((resolve) => {
      setTimeout(() => {
        resolve('timeout')
      }, 200)
    })
    expect(await Promise.race([nextMessage(), timeout])).toBe('timeout')

    ws.close()
  })
})
