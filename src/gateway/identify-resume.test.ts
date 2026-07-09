import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { GatewayIntentBits } from 'discord-api-types/v10'
import {
  createTestGatewayServer,
  seedBot,
  seedGuild,
  seedChannel,
} from '../test-helpers'
import { GatewayOp, GatewayCloseCode } from './opcodes'

/**
 * Waits for the next JSON message frame on a websocket.
 * @param ws - the websocket to listen on
 * @returns the decoded payload
 */
function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (raw: Buffer) => {
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>)
    })
  })
}

/**
 * Waits for the websocket to close and resolves with the close code.
 * @param ws - the websocket to listen on
 * @returns the close code sent by the server
 */
function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('close', (code: number) => {
      resolve(code)
    })
  })
}

describe('IDENTIFY payload validation', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('closes with 4004 when the token is not registered', async () => {
    const { url, close: c } = await createTestGatewayServer()
    close = c
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    const closePromise = nextClose(ws)
    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot unregistered', intents: 0 },
      })
    )
    expect(await closePromise).toBe(GatewayCloseCode.AuthenticationFailed)
  })

  it('authenticates when the IDENTIFY token omits the "Bot " prefix (real client behavior)', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    seedBot(db, 'Bot noprefixtoken')
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'noprefixtoken', intents: 0 },
      })
    )
    const ready = await nextMessage(ws)
    expect(ready.op).toBe(GatewayOp.Dispatch)
    expect(ready.t).toBe('READY')
    ws.close()
  })

  it('includes the `application` field in READY (required by GatewayReadyDispatchData)', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const userId = '999999999999999999'
    seedBot(db, 'Bot appfieldtoken', userId)
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot appfieldtoken', intents: 0 },
      })
    )
    const ready = await nextMessage(ws)
    const readyData = ready.d as { application?: { id: string; flags: number } }
    expect(readyData.application).toEqual({ id: userId, flags: 0 })
    ws.close()
  })

  it("includes an empty `private_channels` array in READY (Discord.Net's ReadyEvent reads .Length unconditionally)", async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    seedBot(db, 'Bot privatechannelstoken')
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot privatechannelstoken', intents: 0 },
      })
    )
    const ready = await nextMessage(ws)
    const readyData = ready.d as { private_channels?: unknown[] }
    expect(readyData.private_channels).toEqual([])
    ws.close()
  })

  it('lists pre-existing guilds as unavailable stubs in READY (not an empty array)', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const bot = seedBot(db, 'Bot readystubtoken')
    const guild = seedGuild(db, bot, 'ReadyStubGuild')
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot readystubtoken', intents: 0 },
      })
    )
    const ready = await nextMessage(ws)
    const readyData = ready.d as {
      guilds?: { id: string; unavailable: boolean }[]
    }
    expect(readyData.guilds).toEqual([{ id: guild, unavailable: true }])
    ws.close()
  })

  it("includes a complete `user` object in READY (required by strict client models such as interactions.py's ClientUser)", async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const userId = '888888888888888888'
    seedBot(db, 'Bot userfieldtoken', userId)
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot userfieldtoken', intents: 0 },
      })
    )
    const ready = await nextMessage(ws)
    const readyData = ready.d as {
      user?: {
        id: string
        username: string
        discriminator: string
        avatar: string | null
        bot: boolean
        verified: boolean
      }
    }
    expect(readyData.user).toMatchObject({
      id: userId,
      discriminator: expect.any(String),
      avatar: null,
      bot: true,
      verified: true,
    })
    ws.close()
  })

  it('closes with 4013 when intents are invalid', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    seedBot(db, 'Bot badintents')
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    const closePromise = nextClose(ws)
    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot badintents', intents: -1 },
      })
    )
    expect(await closePromise).toBe(GatewayCloseCode.InvalidIntents)
  })

  it('closes with 4004 (instead of crashing) when d is missing', async () => {
    const { url, close: c } = await createTestGatewayServer()
    close = c
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    const closePromise = nextClose(ws)
    ws.send(JSON.stringify({ op: GatewayOp.Identify }))
    expect(await closePromise).toBe(GatewayCloseCode.AuthenticationFailed)
  })
})

describe('RESUME payload validation', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('replies with Invalid Session (op9, d:false) for an unknown session_id', async () => {
    const { url, close: c } = await createTestGatewayServer()
    close = c
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    const invalidSessionPromise = nextMessage(ws)
    ws.send(
      JSON.stringify({
        op: GatewayOp.Resume,
        d: { token: 'Bot x', session_id: 'nonexistent', seq: 0 },
      })
    )
    const invalidSession = await invalidSessionPromise
    expect(invalidSession.op).toBe(GatewayOp.InvalidSession)
    expect(invalidSession.d).toBe(false)
    ws.close()
  })

  it('replies with Invalid Session (op9, d:false) for a malformed RESUME (missing d)', async () => {
    const { url, close: c } = await createTestGatewayServer()
    close = c
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    const invalidSessionPromise = nextMessage(ws)
    ws.send(JSON.stringify({ op: GatewayOp.Resume }))
    const invalidSession = await invalidSessionPromise
    expect(invalidSession.op).toBe(GatewayOp.InvalidSession)
    expect(invalidSession.d).toBe(false)
    ws.close()
  })

  it('resumes on a new connection: replays missed events then sends RESUMED', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const bot = seedBot(db, 'Bot resumetoken')
    const guild = seedGuild(db, bot, 'ResumeGuild')
    const channel = seedChannel(db, guild, 'general')

    const ws1 = new WebSocket(url)
    await nextMessage(ws1) // HELLO
    ws1.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: {
          token: 'Bot resumetoken',
          intents: GatewayIntentBits.GuildMessages,
        },
      })
    )
    const ready = await nextMessage(ws1)
    const sessionId = (ready.d as { session_id: string }).session_id
    // A real client tracks `s` from every Dispatch it receives, including
    // READY itself (which consumes seq 1). Resuming with a literal seq:0
    // would claim the client never even saw READY, which is unreplayable
    // (READY is not kept in the replay buffer) and correctly rejected by the
    // server as an Invalid Session — so the last-seen seq to resume from is
    // READY's own `s`, not a hardcoded 0.
    const lastSeq = ready.s as number

    const messageCreatePromise = nextMessage(ws1)
    const httpUrl = url.replace('ws://', 'http://')
    await fetch(`${httpUrl}/api/v10/channels/${channel}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bot resumetoken',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'resume me' }),
    })
    const messageCreate = await messageCreatePromise
    expect(messageCreate.t).toBe('MESSAGE_CREATE')

    // Genuinely disconnect ws1: the server no longer removes a session when
    // its socket closes (see server.ts), so the session and its replay buffer
    // survive a transient disconnect and remain resumable on a new socket.
    const ws1ClosePromise = nextClose(ws1)
    ws1.close()
    await ws1ClosePromise

    const ws2 = new WebSocket(url)
    await nextMessage(ws2) // HELLO

    const received: Record<string, unknown>[] = []
    const resumedPromise = new Promise<void>((resolve) => {
      ws2.on('message', (raw: Buffer) => {
        const payload = JSON.parse(raw.toString()) as Record<string, unknown>
        received.push(payload)
        if (payload.t === 'RESUMED') resolve()
      })
    })

    ws2.send(
      JSON.stringify({
        op: GatewayOp.Resume,
        d: { token: 'Bot resumetoken', session_id: sessionId, seq: lastSeq },
      })
    )
    await resumedPromise

    expect(received[0]?.t).toBe('MESSAGE_CREATE')
    expect(received.at(-1)?.t).toBe('RESUMED')

    ws1.close()
    ws2.close()
  })
})

describe('HEARTBEAT', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('replies with HEARTBEAT_ACK (op11)', async () => {
    const { url, close: c } = await createTestGatewayServer()
    close = c
    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO

    const ackPromise = nextMessage(ws)
    ws.send(JSON.stringify({ op: GatewayOp.Heartbeat, d: null }))
    const ack = await ackPromise
    expect(ack.op).toBe(GatewayOp.HeartbeatAck)
    ws.close()
  })

  // The 4009 (SessionTimedOut) close path requires HEARTBEAT_TIMEOUT_MS
  // (~82.5s) of real inactivity, which is impractical for a real-socket test.
  // vi.useFakeTimers() is not used here because this suite drives an actual
  // TCP/WebSocket connection (via the `ws` package and Node's HTTP server),
  // and faking timers would also stall the network I/O the test depends on,
  // making the test flaky or hang rather than deterministic.
})

describe('Intent filtering', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('does not deliver MESSAGE_CREATE to a session without the GuildMessages intent', async () => {
    const { db, url, close: c } = await createTestGatewayServer()
    close = c
    const bot = seedBot(db, 'Bot nointent')
    const guild = seedGuild(db, bot, 'NoIntentGuild')
    const channel = seedChannel(db, guild, 'general')

    const ws = new WebSocket(url)
    await nextMessage(ws) // HELLO
    ws.send(
      JSON.stringify({
        op: GatewayOp.Identify,
        d: { token: 'Bot nointent', intents: 0 },
      })
    )
    await nextMessage(ws) // READY

    let received = false
    ws.on('message', (raw: Buffer) => {
      const payload = JSON.parse(raw.toString()) as Record<string, unknown>
      if (payload.t === 'MESSAGE_CREATE') received = true
    })

    const httpUrl = url.replace('ws://', 'http://')
    await fetch(`${httpUrl}/api/v10/channels/${channel}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bot nointent',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'should not arrive' }),
    })

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(received).toBe(false)

    ws.close()
  })
})
