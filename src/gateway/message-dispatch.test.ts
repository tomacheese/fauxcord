import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { GatewayIntentBits } from 'discord-api-types/v10'
import {
  createTestGatewayServer,
  seedBot,
  seedGuild,
  seedChannel,
} from '../test-helpers'
import { GatewayOp } from './opcodes'

describe('MESSAGE_CREATE dispatch (integration)', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('delivers MESSAGE_CREATE over the websocket after a REST message is created', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const bot = seedBot(db, 'Bot gwtoken')
    const guild = seedGuild(db, bot, 'GWGuild')
    const channel = seedChannel(db, guild, 'general')

    const ws = new WebSocket(url)
    await new Promise((resolve) => ws.once('message', resolve)) // Consume HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot gwtoken', intents: GatewayIntentBits.GuildMessages },
      })
    )
    await new Promise((resolve) => ws.once('message', resolve)) // Consume READY

    const dispatchPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (raw: Buffer) => {
        resolve(JSON.parse(raw.toString()))
      })
    })

    // Create a message via REST
    const httpUrl = url.replace('ws://', 'http://')
    await fetch(`${httpUrl}/api/v10/channels/${channel}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bot gwtoken',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'hello gateway' }),
    })

    const dispatch = await dispatchPromise
    expect(dispatch.t).toBe('MESSAGE_CREATE')
    expect((dispatch.d as { content: string }).content).toBe('hello gateway')

    ws.close()
  })
})
