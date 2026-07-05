import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { GatewayIntentBits } from 'discord-api-types/v10'
import { createTestGatewayServer, seedBot, seedGuild } from '../test-helpers'
import { GatewayOp } from './opcodes'

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
    const guild = seedGuild(db, bot, 'GWGuild2')

    const ws = new WebSocket(url)
    await new Promise((resolve) => ws.once('message', resolve)) // Consume HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot gwtoken2', intents: GatewayIntentBits.Guilds },
      })
    )
    await new Promise((resolve) => ws.once('message', resolve)) // Consume READY

    const dispatchPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (raw: Buffer) => {
        resolve(JSON.parse(raw.toString()))
      })
    })

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

    const dispatch = await dispatchPromise
    expect(dispatch.t).toBe('CHANNEL_CREATE')
    expect((dispatch.d as { name: string }).name).toBe('new-channel')

    ws.close()
  })
})
