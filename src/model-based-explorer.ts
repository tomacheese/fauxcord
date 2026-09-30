/* eslint-disable @typescript-eslint/no-use-before-define -- Scenario operations share a typed context and are grouped by resource behavior. */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import WebSocket from 'ws'
import { GatewayIntentBits } from 'discord-api-types/v10'
import { createRealServer } from './test-helpers'
import type { RealServerContext } from './test-helpers'

const API_PREFIX = '/api/v10'
const TOKEN = 'Bot model-explorer-local-only'
const GUILD_ID = '222222222222222222'
const PRIMARY_CHANNEL_ID = '333333333333333333'
const SECONDARY_CHANNEL_ID = '444444444444444444'
const BOT_USER_ID = '111111111111111111'
const MISSING_ID = '999999999999999999'
const REACTION = '👍'
const HTTP_TIMEOUT_MS = 5000

/** A stateful API command generated from a reproducible seed. */
export type ModelOperation =
  | { kind: 'create-channel'; ref: string; name: string }
  | { kind: 'delete-channel'; ref: string }
  | { kind: 'get-channel'; ref: string; expectMissing: boolean }
  | { kind: 'list-channels' }
  | {
      kind: 'create-message'
      ref: string
      channelRef: string
      content: string
    }
  | {
      kind: 'boundary-message'
      ref: string
      channelRef: string
      content: string
    }
  | { kind: 'get-message'; ref: string; channelRef: string }
  | {
      kind: 'edit-message'
      ref: string
      channelRef: string
      content: string
    }
  | { kind: 'delete-message'; ref: string; channelRef: string }
  | { kind: 'list-messages'; channelRef: string }
  | { kind: 'add-reaction'; ref: string; channelRef: string; emoji: string }
  | {
      kind: 'remove-reaction'
      ref: string
      channelRef: string
      emoji: string
    }
  | { kind: 'pin-message'; ref: string; channelRef: string }
  | { kind: 'unpin-message'; ref: string; channelRef: string }
  | { kind: 'wrong-channel-pin'; ref: string; channelRef: string }
  | { kind: 'wrong-channel-reaction'; ref: string; channelRef: string }
  | { kind: 'invalid-message'; content: string; expectedCode: number }
  | { kind: 'invalid-emoji'; ref: string; channelRef: string }
  | { kind: 'stale-message-read'; ref: string; channelRef: string }
  | { kind: 'stale-message-delete'; ref: string; channelRef: string }
  | { kind: 'wrong-channel-read'; ref: string; channelRef: string }
  | {
      kind: 'wrong-channel-edit'
      ref: string
      channelRef: string
      content: string
    }
  | { kind: 'post-to-deleted-channel'; channelRef: string; content: string }

/** Mutation hooks used only to prove that the checker catches injected faults. */
export type ExplorerMutation =
  | { kind: 'corrupt-create-response' }
  | { kind: 'skip-message-delete' }
  | { kind: 'drop-gateway-event'; event: string }

/** One HTTP request and its observed result during an operation. */
export interface RequestObservation {
  method: string
  path: string
  body?: unknown
  status: number
  response?: unknown
  forwarded?: boolean
}

/** An operation with its expected invariant and concrete HTTP evidence. */
export interface OperationObservation {
  index: number
  operation: ModelOperation
  expected: unknown
  requests: RequestObservation[]
  gateway?: unknown
  outcome: 'passed' | 'failed' | 'skipped'
}

/** A verified mismatch between a model invariant and the observed system. */
export interface ExplorerFinding {
  category: 'response' | 'state' | 'gateway' | 'scenario'
  invariant: string
  operationIndex: number
  operation: ModelOperation
  expected: unknown
  actual: unknown
  signature: string
}

/** Reproducible result of running a generated or supplied operation sequence. */
export interface ExplorationResult {
  formatVersion: 1
  seed: string
  passed: boolean
  generatedSteps: number
  executedSteps: number
  checks: string[]
  operations: ModelOperation[]
  trace: OperationObservation[]
  finding?: ExplorerFinding
  minimized?: {
    operations: ModelOperation[]
    trace: OperationObservation[]
  }
}

/** Options for running a model scenario. */
interface RunOptions {
  seed: string | number
  operations: ModelOperation[]
  mutation?: ExplorerMutation
  minimize?: boolean
  gatewayTimeoutMs?: number
}

/** Tracks the modeled state of a channel. */
interface ChannelState {
  id: string
  alive: boolean
  name: string
  fixed: boolean
}

/** Tracks the modeled state of a message. */
interface MessageState {
  id: string
  channelRef: string
  alive: boolean
  content: string
  pinned: boolean
  reactions: Set<string>
}

type JsonObject = Record<string, unknown>

/** Represents a decoded Gateway payload. */
interface GatewayPayload {
  op?: number
  t?: string
  d?: unknown
}

/** Keeps random selection and membership updates constant-time. */
class ReferencePool {
  private readonly references: string[] = []
  private readonly indexByReference = new Map<string, number>()

  /** Adds a reference unless it is already present. */
  add(reference: string): void {
    if (this.indexByReference.has(reference)) return
    this.indexByReference.set(reference, this.references.length)
    this.references.push(reference)
  }

  /** Removes a reference while preserving constant-time selection. */
  remove(reference: string): void {
    const index = this.indexByReference.get(reference)
    if (index === undefined) return
    const last = this.references.pop()
    if (last === undefined) throw new Error('Reference pool is inconsistent')
    this.indexByReference.delete(reference)
    if (index >= this.references.length) return
    this.references[index] = last
    this.indexByReference.set(last, index)
  }

  /** Returns the current references for read-only iteration. */
  get values(): readonly string[] {
    return this.references
  }
}

/** Tracks active message references in creation order. */
class MessageReferenceIndex {
  private readonly nodes = new Map<string, MessageReferenceNode>()
  private head?: MessageReferenceNode
  private tail?: MessageReferenceNode

  /** Appends a new active message reference. */
  add(reference: string): void {
    if (this.nodes.has(reference)) return
    const node: MessageReferenceNode = { reference, previous: this.tail }
    if (this.tail) this.tail.next = node
    else this.head = node
    this.tail = node
    this.nodes.set(reference, node)
  }

  /** Removes an active message reference. */
  remove(reference: string): void {
    const node = this.nodes.get(reference)
    if (!node) return
    if (node.previous) node.previous.next = node.next
    else this.head = node.next
    if (node.next) node.next.previous = node.previous
    else this.tail = node.previous
    this.nodes.delete(reference)
  }

  /** Returns active references in creation order. */
  toArray(): string[] {
    const references: string[] = []
    for (let node = this.head; node; node = node.next) {
      references.push(node.reference)
    }
    return references
  }

  /** Returns the newest active references in API response order. */
  latest(limit: number): string[] {
    const references: string[] = []
    for (
      let node = this.tail;
      node && references.length < limit;
      node = node.previous
    ) {
      references.push(node.reference)
    }
    return references
  }

  /** Removes every active message reference. */
  clear(): void {
    this.nodes.clear()
    this.head = undefined
    this.tail = undefined
  }
}

/** Links adjacent references in a channel's active message list. */
interface MessageReferenceNode {
  reference: string
  previous?: MessageReferenceNode
  next?: MessageReferenceNode
}

/** Deterministic xorshift32 generator used for operation and value selection. */
class SeededRandom {
  private state: number

  /** Initializes a nonzero 32-bit random state. */
  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d_2b_79_f5
  }

  /** Returns the next unsigned 32-bit value. */
  next(): number {
    let value = this.state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.state = value >>> 0
    return this.state
  }

  /** Returns an integer between zero and max (exclusive). */
  int(max: number): number {
    return this.next() % max
  }
}

/**
 * Generates a state-aware command sequence from a numeric seed.
 * @param seed - Unsigned 32-bit seed, in decimal or hexadecimal form
 * @param steps - Maximum command count
 * @returns Deterministic commands with references to modeled resources
 */
export function generateModelOperations(
  seed: string | number,
  steps: number
): ModelOperation[] {
  const random = new SeededRandom(parseSeed(seed))
  const operations: ModelOperation[] = []
  const channels = new Map<string, { alive: boolean }>([
    ['primary', { alive: true }],
    ['secondary', { alive: true }],
  ])
  const messages = new Map<
    string,
    {
      alive: boolean
      channelRef: string
      content: string
      pinned: boolean
      reactions: Set<string>
    }
  >()
  const activeChannelRefs = new ReferencePool()
  activeChannelRefs.add('primary')
  activeChannelRefs.add('secondary')
  const dynamicChannelRefs = new ReferencePool()
  const deletedChannelRefs = new ReferencePool()
  const activeMessageRefs = new ReferencePool()
  const deletedMessageRefs = new ReferencePool()
  const messageRefsByChannel = new Map<string, Set<string>>([
    ['primary', new Set()],
    ['secondary', new Set()],
  ])
  let nextChannel = 0
  let nextMessage = 0

  const choose = <T>(values: readonly T[]): T =>
    values[random.int(values.length)]
  const chooseOtherChannel = (channelRef: string): string => {
    const count = activeChannelRefs.values.length
    const start = random.int(count)
    for (let offset = 0; offset < count; offset++) {
      const candidate = activeChannelRefs.values[(start + offset) % count]
      if (candidate !== channelRef) return candidate
    }
    throw new Error(`No alternate active channel exists for ${channelRef}`)
  }

  for (let index = 0; index < steps; index++) {
    const liveChannels = activeChannelRefs.values
    const liveMessages = activeMessageRefs.values
    const deletedMessages = deletedMessageRefs.values
    const deletedChannels = deletedChannelRefs.values
    const choice = random.int(19)

    if (choice === 0 || liveMessages.length === 0) {
      const ref = `message-${nextMessage++}`
      const channelRef = choose(liveChannels)
      const content = `seed-${parseSeed(seed)}-message-${ref}`
      operations.push({ kind: 'create-message', ref, channelRef, content })
      messages.set(ref, {
        alive: true,
        channelRef,
        content,
        pinned: false,
        reactions: new Set(),
      })
      activeMessageRefs.add(ref)
      messageRefsByChannel.get(channelRef)?.add(ref)
      continue
    }

    const ref = choose(liveMessages)
    const message = messages.get(ref)
    if (!message) throw new Error(`Missing generated message state for ${ref}`)
    switch (choice) {
      case 1: {
        operations.push({
          kind: 'get-message',
          ref,
          channelRef: message.channelRef,
        })

        break
      }
      case 2: {
        const content = `edited-${random.next().toString(16)}-${ref}`
        operations.push({
          kind: 'edit-message',
          ref,
          channelRef: message.channelRef,
          content,
        })
        message.content = content

        break
      }
      case 3: {
        operations.push({
          kind: 'delete-message',
          ref,
          channelRef: message.channelRef,
        })
        message.alive = false
        activeMessageRefs.remove(ref)
        deletedMessageRefs.add(ref)

        break
      }
      case 4: {
        operations.push({
          kind: 'add-reaction',
          ref,
          channelRef: message.channelRef,
          emoji: REACTION,
        })
        message.reactions.add(REACTION)

        break
      }
      case 5: {
        operations.push({
          kind: 'remove-reaction',
          ref,
          channelRef: message.channelRef,
          emoji: REACTION,
        })
        message.reactions.delete(REACTION)

        break
      }
      case 6: {
        operations.push({
          kind: 'pin-message',
          ref,
          channelRef: message.channelRef,
        })
        message.pinned = true

        break
      }
      case 7: {
        operations.push({
          kind: 'unpin-message',
          ref,
          channelRef: message.channelRef,
        })
        message.pinned = false

        break
      }
      case 8: {
        operations.push({
          kind: 'list-messages',
          channelRef: message.channelRef,
        })

        break
      }
      default: {
        if (choice === 9 && liveChannels.length > 1) {
          operations.push({
            kind: 'wrong-channel-read',
            ref,
            channelRef: chooseOtherChannel(message.channelRef),
          })
        } else if (choice === 10 && liveChannels.length > 1) {
          operations.push({
            kind: 'wrong-channel-edit',
            ref,
            channelRef: chooseOtherChannel(message.channelRef),
            content: `wrong-channel-edit-${ref}`,
          })
        } else if (choice === 11 && liveChannels.length > 1) {
          operations.push({
            kind: 'wrong-channel-pin',
            ref,
            channelRef: chooseOtherChannel(message.channelRef),
          })
        } else if (choice === 12) {
          operations.push({
            kind: 'invalid-message',
            content: 'x'.repeat(2001),
            expectedCode: 50_035,
          })
        } else if (choice === 13) {
          operations.push({
            kind: 'invalid-emoji',
            ref,
            channelRef: message.channelRef,
          })
        } else if (choice === 14 && liveChannels.length > 1) {
          operations.push({
            kind: 'wrong-channel-reaction',
            ref,
            channelRef: chooseOtherChannel(message.channelRef),
          })
        } else if (choice === 18 && deletedMessages.length > 0) {
          const staleRef = choose(deletedMessages)
          const stale = messages.get(staleRef)
          if (!stale)
            throw new Error(
              `Missing generated stale message state for ${staleRef}`
            )
          operations.push({
            kind: 'stale-message-read',
            ref: staleRef,
            channelRef: stale.channelRef,
          })
        } else if (choice === 15 && liveChannels.length > 1) {
          if (dynamicChannelRefs.values.length > 0) {
            const channelRef = choose(dynamicChannelRefs.values)
            operations.push({ kind: 'delete-channel', ref: channelRef })
            const channel = channels.get(channelRef)
            if (!channel)
              throw new Error(
                `Missing generated channel state for ${channelRef}`
              )
            channel.alive = false
            activeChannelRefs.remove(channelRef)
            dynamicChannelRefs.remove(channelRef)
            deletedChannelRefs.add(channelRef)
            const messageRefs = messageRefsByChannel.get(channelRef) ?? []
            for (const messageRef of messageRefs) {
              const state = messages.get(messageRef)
              if (!state?.alive) continue
              state.alive = false
              activeMessageRefs.remove(messageRef)
              deletedMessageRefs.add(messageRef)
            }
          } else if (deletedChannels.length > 0) {
            const channelRef = choose(deletedChannels)
            operations.push({
              kind: 'get-channel',
              ref: channelRef,
              expectMissing: true,
            })
          } else {
            operations.push({ kind: 'list-channels' })
          }
        } else if (choice === 16 && deletedChannels.length > 0) {
          const channelRef = choose(deletedChannels)
          operations.push({
            kind: 'post-to-deleted-channel',
            channelRef,
            content: `stale-${ref}`,
          })
        } else if (choice === 17) {
          const boundaryRef = `message-${nextMessage++}`
          const channelRef = choose(liveChannels)
          const content = 'b'.repeat(2000)
          operations.push({
            kind: 'boundary-message',
            ref: boundaryRef,
            channelRef,
            content,
          })
          messages.set(boundaryRef, {
            alive: true,
            channelRef,
            content,
            pinned: false,
            reactions: new Set(),
          })
          activeMessageRefs.add(boundaryRef)
          messageRefsByChannel.get(channelRef)?.add(boundaryRef)
        } else if (random.int(4) === 0) {
          const channelRef = `channel-${nextChannel++}`
          const name = `generated-${channelRef}`
          operations.push({ kind: 'create-channel', ref: channelRef, name })
          channels.set(channelRef, { alive: true })
          activeChannelRefs.add(channelRef)
          dynamicChannelRefs.add(channelRef)
          messageRefsByChannel.set(channelRef, new Set())
        } else if (deletedMessages.length > 0) {
          const staleRef = choose(deletedMessages)
          const stale = messages.get(staleRef)
          if (!stale)
            throw new Error(
              `Missing generated stale message state for ${staleRef}`
            )
          operations.push({
            kind: 'stale-message-delete',
            ref: staleRef,
            channelRef: stale.channelRef,
          })
        } else {
          operations.push({ kind: 'list-channels' })
        }
      }
    }
  }

  return operations
}

/** Parses and validates an unsigned 32-bit seed. */
export function parseSeed(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xff_ff_ff_ff) {
    throw new Error(`Seed must be an unsigned 32-bit integer: ${String(value)}`)
  }
  return parsed >>> 0
}

/** Carries a structured invariant failure. */
class InvariantViolation extends Error {
  /** Creates an invariant failure with its finding. */
  constructor(readonly finding: ExplorerFinding) {
    super(finding.invariant)
  }
}

/** Stores the status and decoded body of an HTTP response. */
interface HttpResult {
  status: number
  body: unknown
}

/** Stores a pending Gateway frame predicate and its callbacks. */
interface EventWaiter {
  predicate: (payload: GatewayPayload) => boolean
  resolve: (payload: GatewayPayload) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Collects real Gateway frames and waits for a specific dispatch. */
export class GatewayObserver {
  private readonly packets: GatewayPayload[] = []
  private parseFailure: Error | undefined
  private readonly waiters = new Set<{
    predicate: (payload: GatewayPayload) => boolean
    resolve: (payload: GatewayPayload) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  /** Decodes and records incoming Gateway frames. */
  private readonly onMessage = (raw: WebSocket.RawData) => {
    let payload: GatewayPayload
    try {
      let text: string
      if (Buffer.isBuffer(raw)) text = raw.toString()
      else if (Array.isArray(raw)) text = Buffer.concat(raw).toString()
      else text = new TextDecoder().decode(raw)
      payload = JSON.parse(text) as GatewayPayload
    } catch (error) {
      this.parseFailure ??= new Error(
        `Invalid Gateway JSON frame: ${error instanceof Error ? error.message : String(error)}`
      )
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(this.parseFailure)
      }
      this.waiters.clear()
      return
    }
    if (
      this.mutation?.kind === 'drop-gateway-event' &&
      payload.t === this.mutation.event
    ) {
      return
    }
    this.accept(payload)
  }

  /** Queues unmatched frames and resolves matching waiters. */
  private accept(payload: GatewayPayload): void {
    let matched = false
    for (const waiter of this.waiters) {
      if (!waiter.predicate(payload)) continue
      matched = true
      clearTimeout(waiter.timer)
      this.waiters.delete(waiter)
      waiter.resolve(payload)
    }
    if (!matched) this.packets.push(payload)
  }

  /** Subscribes to the Gateway WebSocket. */
  constructor(
    private readonly socket: WebSocket,
    private readonly mutation: ExplorerMutation | undefined
  ) {
    socket.on('message', this.onMessage)
  }

  /** Waits for a decoded Gateway frame matching a predicate. */
  async waitFor(
    predicate: (payload: GatewayPayload) => boolean,
    timeoutMs: number
  ): Promise<GatewayPayload> {
    const index = this.packets.findIndex((packet) => predicate(packet))
    if (index !== -1) return this.packets.splice(index, 1)[0]
    if (this.parseFailure) throw this.parseFailure
    return await new Promise<GatewayPayload>((resolve, reject) => {
      const waiter: EventWaiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(
            new Error(
              `Timed out waiting for Gateway frame after ${timeoutMs} ms`
            )
          )
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  /** Waits for a dispatch with the requested event name. */
  waitForDispatch(event: string, timeoutMs: number): Promise<GatewayPayload> {
    return this.waitFor((payload) => payload.t === event, timeoutMs)
  }

  /** Adds a faulty dispatch for the isolated state mutation self-test. */
  inject(payload: GatewayPayload): void {
    this.accept(payload)
  }

  /** Removes listeners and closes the WebSocket. */
  async close(): Promise<void> {
    this.socket.off('message', this.onMessage)
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Gateway observer closed'))
    }
    this.waiters.clear()
    if (this.socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      this.socket.once('close', () => {
        resolve()
      })
      this.socket.close()
      const timer = setTimeout(() => {
        this.socket.terminate()
        resolve()
      }, 250)
      timer.unref()
    })
  }
}

/** Holds the state and helpers shared by one scenario. */
interface ScenarioContext {
  server: RealServerContext
  observer: GatewayObserver
  channels: Map<string, ChannelState>
  messages: Map<string, MessageState>
  messageRefsByChannel: Map<string, MessageReferenceIndex>
  trace: OperationObservation[]
  checks: string[]
  current?: OperationObservation
  mutation?: ExplorerMutation
  gatewayTimeoutMs: number
  request: (
    method: string,
    requestPath: string,
    body?: unknown
  ) => Promise<HttpResult>
}

/**
 * Runs an operation sequence against an isolated, real HTTP/Gateway server.
 * @param options - Seed and operations; tests may supply an isolated mutation
 * @returns Trace, checks, and the first verified mismatch if one occurs
 */
export async function runModelScenario(
  options: RunOptions
): Promise<ExplorationResult> {
  const result = await runScenarioOnce(options)
  if (!result.finding || !options.minimize) return result

  const minimized = await minimizeScenario(options, result.finding.signature)
  result.minimized = {
    operations: minimized.operations,
    trace: minimized.trace,
  }
  return result
}

/** Executes one operation sequence against a fresh server. */
async function runScenarioOnce(
  options: RunOptions
): Promise<ExplorationResult> {
  const trace: OperationObservation[] = []
  const checks: string[] = []
  const operations = options.operations
  const server = await createRealServer()
  let observer: GatewayObserver | undefined
  let finding: ExplorerFinding | undefined
  const channels = new Map<string, ChannelState>()
  const messages = new Map<string, MessageState>()
  const messageRefsByChannel = new Map<string, MessageReferenceIndex>()

  try {
    const setup = await fetch(`${server.baseUrl}/_test/setup`, {
      method: 'POST',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: TOKEN,
        user: { id: BOT_USER_ID, username: 'Model Explorer Bot' },
        guilds: [
          {
            id: GUILD_ID,
            name: 'Model Explorer Guild',
            channels: [
              { id: PRIMARY_CHANNEL_ID, name: 'primary', type: 0 },
              { id: SECONDARY_CHANNEL_ID, name: 'secondary', type: 0 },
            ],
          },
        ],
      }),
    })
    if (setup.status !== 201) {
      throw new Error(`Test environment setup failed with HTTP ${setup.status}`)
    }
    channels.set('primary', {
      id: PRIMARY_CHANNEL_ID,
      alive: true,
      name: 'primary',
      fixed: true,
    })
    messageRefsByChannel.set('primary', new MessageReferenceIndex())
    channels.set('secondary', {
      id: SECONDARY_CHANNEL_ID,
      alive: true,
      name: 'secondary',
      fixed: true,
    })
    messageRefsByChannel.set('secondary', new MessageReferenceIndex())

    const activeObserver = await connectGateway(server, options.mutation)
    observer = activeObserver
    const context: ScenarioContext = {
      server,
      observer: activeObserver,
      channels,
      messages,
      messageRefsByChannel,
      trace,
      checks,
      mutation: options.mutation,
      gatewayTimeoutMs: options.gatewayTimeoutMs ?? 1500,
      request: async (method, requestPath, body) =>
        await observedRequest(
          server,
          activeObserver,
          options.mutation,
          trace.at(-1),
          method,
          requestPath,
          body
        ),
    }

    for (const [index, operation] of operations.entries()) {
      const observation: OperationObservation = {
        index,
        operation,
        expected: expectedFor(operation),
        requests: [],
        outcome: 'passed',
      }
      trace.push(observation)
      context.current = observation
      try {
        await executeOperation(context, operation)
        checks.push(`${operation.kind}:${observation.outcome}`)
      } catch (error) {
        observation.outcome = 'failed'
        finding =
          error instanceof InvariantViolation
            ? error.finding
            : {
                category: 'scenario',
                invariant:
                  error instanceof Error ? error.message : String(error),
                operationIndex: index,
                operation,
                expected: observation.expected,
                actual: observation.requests.at(-1) ?? null,
                signature: `${operation.kind}:scenario`,
              }
        break
      }
    }
  } finally {
    await observer?.close()
    const gatewaySessions = server.sessionManager.getAll()
    for (const session of gatewaySessions) {
      server.sessionManager.remove(session.sessionId)
    }
    await server.close()
  }

  return {
    formatVersion: 1,
    seed: String(parseSeed(options.seed)),
    passed: finding === undefined,
    generatedSteps: operations.length,
    executedSteps: trace.filter(({ outcome }) => outcome !== 'skipped').length,
    checks,
    operations,
    trace,
    ...(finding && { finding }),
  }
}

/** Connects a local bot session and waits for its ready state. */
async function connectGateway(
  server: RealServerContext,
  mutation: ExplorerMutation | undefined
): Promise<GatewayObserver> {
  const socket = new WebSocket(server.baseUrl.replace(/^http:/, 'ws:'))
  const observer = new GatewayObserver(socket, mutation)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Gateway connection timed out'))
    }, 2000)
    socket.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  const hello = await observer.waitFor((payload) => payload.op === 10, 2000)
  if (hello.op !== 10) throw new Error('Gateway did not send HELLO')
  socket.send(
    JSON.stringify({
      op: 2,
      d: {
        token: TOKEN,
        intents:
          GatewayIntentBits.Guilds |
          GatewayIntentBits.GuildMessages |
          GatewayIntentBits.GuildMessageReactions,
      },
    })
  )
  await observer.waitForDispatch('READY', 2000)
  return observer
}

/** Sends and records one HTTP request and its response. */
async function observedRequest(
  server: RealServerContext,
  observer: GatewayObserver,
  mutation: ExplorerMutation | undefined,
  observation: OperationObservation | undefined,
  method: string,
  requestPath: string,
  body?: unknown
): Promise<HttpResult> {
  if (!observation) throw new Error('Request was made outside an operation')

  const skipsDelete =
    mutation?.kind === 'skip-message-delete' &&
    method === 'DELETE' &&
    /^\/api\/v10\/channels\/[^/]+\/messages\/[^/]+$/.test(requestPath)
  const response = skipsDelete
    ? new Response(null, { status: 204 })
    : await fetch(`${server.baseUrl}${requestPath}`, {
        method,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        headers: {
          Authorization: TOKEN,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      })

  if (skipsDelete) {
    const match = /^\/api\/v10\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(
      requestPath
    )
    if (match?.[1] && match[2]) {
      observer.inject({
        op: 0,
        t: 'MESSAGE_DELETE',
        d: { channel_id: match[1], id: match[2] },
      })
    }
  }

  let responseBody: unknown
  const raw = await response.text()
  if (raw.length > 0) {
    try {
      responseBody = JSON.parse(raw) as unknown
    } catch {
      responseBody = raw
    }
  }
  if (
    method === 'POST' &&
    mutation?.kind === 'corrupt-create-response' &&
    requestPath.endsWith('/messages') &&
    isRecord(responseBody)
  ) {
    responseBody = { ...responseBody, channel_id: SECONDARY_CHANNEL_ID }
  }

  observation.requests.push({
    method,
    path: requestPath,
    ...(body !== undefined && { body }),
    status: response.status,
    ...(responseBody !== undefined && { response: responseBody }),
    ...(skipsDelete && { forwarded: false }),
  })
  return { status: response.status, body: responseBody }
}

/** Dispatches an operation to its matching scenario handler. */
async function executeOperation(
  context: ScenarioContext,
  operation: ModelOperation
): Promise<void> {
  switch (operation.kind) {
    case 'create-channel': {
      await createChannel(context, operation)
      return
    }
    case 'delete-channel': {
      await deleteChannel(context, operation.ref)
      return
    }
    case 'get-channel': {
      await getChannel(context, operation)
      return
    }
    case 'list-channels': {
      await listChannels(context)
      return
    }
    case 'create-message':
    case 'boundary-message': {
      await createMessage(context, operation)
      return
    }
    case 'get-message': {
      await getMessage(context, operation)
      return
    }
    case 'edit-message': {
      await editMessage(context, operation)
      return
    }
    case 'delete-message': {
      await deleteMessage(context, operation)
      return
    }
    case 'list-messages': {
      await listMessages(context, operation.channelRef)
      return
    }
    case 'add-reaction': {
      await changeReaction(context, operation, true)
      return
    }
    case 'remove-reaction': {
      await changeReaction(context, operation, false)
      return
    }
    case 'pin-message': {
      await pinMessage(context, operation, true)
      return
    }
    case 'unpin-message': {
      await pinMessage(context, operation, false)
      return
    }
    case 'wrong-channel-pin': {
      await wrongChannelPin(context, operation)
      return
    }
    case 'wrong-channel-reaction': {
      await wrongChannelReaction(context, operation)
      return
    }
    case 'invalid-message': {
      await invalidMessage(context, operation)
      return
    }
    case 'invalid-emoji': {
      await invalidEmoji(context, operation)
      return
    }
    case 'stale-message-read': {
      await staleMessage(context, operation, false)
      return
    }
    case 'stale-message-delete': {
      await staleMessage(context, operation, true)
      return
    }
    case 'wrong-channel-read': {
      await wrongChannelMessage(context, operation, false)
      return
    }
    case 'wrong-channel-edit': {
      await wrongChannelMessage(context, operation, true)
      return
    }
    case 'post-to-deleted-channel': {
      await postToDeletedChannel(context, operation)
    }
  }
}

/** Creates a channel and verifies its response and dispatch. */
async function createChannel(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'create-channel' }>
): Promise<void> {
  const response = await context.request(
    'POST',
    `${API_PREFIX}/guilds/${GUILD_ID}/channels`,
    { name: operation.name, type: 0 }
  )
  expectStatus(context, response, 201, 'Channel creation must return 201')
  const channel = requireRecord(
    context,
    response.body,
    'Created channel response must be an object'
  )
  expectValue(
    context,
    'response',
    'created channel name matches request',
    operation.name,
    channel.name
  )
  expectValue(
    context,
    'response',
    'created channel belongs to modeled guild',
    GUILD_ID,
    channel.guild_id
  )
  const channelId = requireString(
    context,
    channel.id,
    'Created channel must have an ID'
  )
  context.channels.set(operation.ref, {
    id: channelId,
    alive: true,
    name: operation.name,
    fixed: false,
  })
  context.messageRefsByChannel.set(operation.ref, new MessageReferenceIndex())

  const event = await requireDispatch(context, 'CHANNEL_CREATE')
  const eventData = requireRecord(
    context,
    event.d,
    'CHANNEL_CREATE must contain a channel object'
  )
  expectValue(
    context,
    'gateway',
    'CHANNEL_CREATE identifies the created channel',
    channelId,
    eventData.id
  )
  expectValue(
    context,
    'gateway',
    'CHANNEL_CREATE carries the requested channel name',
    operation.name,
    eventData.name
  )
  currentObservation(context).gateway = event
  assertChannelInDatabase(context, channelId, operation.name, true)
  await assertGuildChannelList(context)
}

/** Deletes a channel and verifies its cascades and dispatch. */
async function deleteChannel(
  context: ScenarioContext,
  ref: string
): Promise<void> {
  const state = context.channels.get(ref)
  if (!state?.alive) {
    skipCurrent(context)
    return
  }
  if (state.fixed) {
    fail(
      context,
      'scenario',
      'Generated deletion must not remove fixture channels',
      'dynamic channel',
      ref
    )
  }

  const channelMessageRefs = context.messageRefsByChannel.get(ref)
  const channelMessageIds = (channelMessageRefs?.toArray() ?? [])
    .map((messageRef) => context.messages.get(messageRef))
    .filter((message): message is MessageState => message?.alive === true)
    .map(({ id }) => id)

  const response = await context.request(
    'DELETE',
    `${API_PREFIX}/channels/${state.id}`
  )
  expectStatus(context, response, 200, 'Channel deletion must return 200')
  const deleted = requireRecord(
    context,
    response.body,
    'Deleted channel response must be an object'
  )
  expectValue(
    context,
    'response',
    'deleted channel response identifies its target',
    state.id,
    deleted.id
  )
  const event = await requireDispatch(context, 'CHANNEL_DELETE')
  const eventData = requireRecord(
    context,
    event.d,
    'CHANNEL_DELETE must contain a channel object'
  )
  expectValue(
    context,
    'gateway',
    'CHANNEL_DELETE identifies the deleted channel',
    state.id,
    eventData.id
  )
  currentObservation(context).gateway = event

  state.alive = false
  const activeMessageRefs = channelMessageRefs?.toArray() ?? []
  for (const messageRef of activeMessageRefs) {
    const message = context.messages.get(messageRef)
    if (message) message.alive = false
  }
  channelMessageRefs?.clear()

  const channelResponse = await context.request(
    'GET',
    `${API_PREFIX}/channels/${state.id}`
  )
  expectDiscordError(
    context,
    channelResponse,
    404,
    10_003,
    'Deleted channel must be inaccessible'
  )
  await assertGuildChannelList(context)
  const testMessages = await context.request(
    'GET',
    `/_test/messages/${state.id}`
  )
  expectStatus(
    context,
    testMessages,
    200,
    'Test control must inspect deleted channel state'
  )
  const messageList = requireRecord(
    context,
    testMessages.body,
    'Test message state must be an object'
  )
  expectArrayLength(
    context,
    'state',
    'Deleting a channel removes its messages',
    0,
    messageList.messages
  )
  const leftovers = context.server.db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM messages WHERE channel_id = ?) AS messages,
        (SELECT COUNT(*) FROM pins WHERE channel_id = ?) AS pins`
    )
    .get(state.id, state.id) as {
    messages: number
    pins: number
  }
  const reactions =
    channelMessageIds.length > 0
      ? (
          context.server.db
            .prepare(
              `SELECT COUNT(*) AS count FROM reactions WHERE message_id IN (${channelMessageIds.map(() => '?').join(', ')})`
            )
            .get(...channelMessageIds) as { count: number }
        ).count
      : 0
  expectValue(
    context,
    'state',
    'Deleting a channel cascades dependent rows',
    { messages: 0, pins: 0, reactions: 0 },
    { ...leftovers, reactions }
  )
}

/** Reads a channel and checks its modeled fields. */
async function getChannel(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'get-channel' }>
): Promise<void> {
  const state = context.channels.get(operation.ref)
  if (!state && !operation.expectMissing) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    'GET',
    `${API_PREFIX}/channels/${state?.id ?? MISSING_ID}`
  )
  if (operation.expectMissing || !state?.alive) {
    expectDiscordError(
      context,
      response,
      404,
      10_003,
      'Missing channel must return Unknown Channel'
    )
    return
  }
  expectStatus(
    context,
    response,
    200,
    'Existing channel lookup must return 200'
  )
  const channel = requireRecord(
    context,
    response.body,
    'Channel response must be an object'
  )
  expectValue(
    context,
    'response',
    'channel lookup identifies its target',
    state.id,
    channel.id
  )
  expectValue(
    context,
    'response',
    'channel lookup preserves its name',
    state.name,
    channel.name
  )
}

/** Lists channels and compares them with modeled state. */
async function listChannels(context: ScenarioContext): Promise<void> {
  const response = await context.request(
    'GET',
    `${API_PREFIX}/guilds/${GUILD_ID}/channels`
  )
  expectStatus(context, response, 200, 'Guild channel listing must return 200')
  const channels = requireArray(
    context,
    response.body,
    'Guild channel listing must be an array'
  )
  const actualIds = channels
    .map((channel) => (isRecord(channel) ? channel.id : undefined))
    .filter((id): id is string => typeof id === 'string')
    .toSorted((left, right) => left.localeCompare(right))
  const expectedIds = context.channels
    .values()
    .filter(({ alive }) => alive)
    .map(({ id }) => id)
    .toArray()
    .toSorted((left, right) => left.localeCompare(right))
  expectValue(
    context,
    'state',
    'Guild channel list matches modeled channels',
    expectedIds,
    actualIds
  )
  assertChannelRows(context, expectedIds)
}

/** Checks the guild channel list against modeled state. */
async function assertGuildChannelList(context: ScenarioContext): Promise<void> {
  const response = await context.request(
    'GET',
    `${API_PREFIX}/guilds/${GUILD_ID}/channels`
  )
  expectStatus(context, response, 200, 'Guild channel listing must return 200')
  const channels = requireArray(
    context,
    response.body,
    'Guild channel listing must be an array'
  )
  const actualIds = channels
    .map((channel) => (isRecord(channel) ? channel.id : undefined))
    .filter((id): id is string => typeof id === 'string')
    .toSorted((left, right) => left.localeCompare(right))
  const expectedIds = context.channels
    .values()
    .filter(({ alive }) => alive)
    .map(({ id }) => id)
    .toArray()
    .toSorted((left, right) => left.localeCompare(right))
  expectValue(
    context,
    'state',
    'Guild channel list matches modeled channels',
    expectedIds,
    actualIds
  )
  assertChannelRows(context, expectedIds)
}

/** Checks persisted channel rows against expected IDs. */
function assertChannelRows(
  context: ScenarioContext,
  expectedIds: string[]
): void {
  const rows = context.server.db
    .prepare('SELECT id FROM channels WHERE guild_id = ? ORDER BY id')
    .all(GUILD_ID) as { id: string }[]
  const databaseIds = rows
    .map(({ id }) => id)
    .toSorted((left, right) => left.localeCompare(right))
  expectValue(
    context,
    'state',
    'Guild channel rows match API and model',
    expectedIds,
    databaseIds
  )
}

/** Checks a channel row and its expected existence. */
function assertChannelInDatabase(
  context: ScenarioContext,
  channelId: string,
  name: string,
  exists: boolean
): void {
  const row = context.server.db
    .prepare('SELECT id, name, guild_id FROM channels WHERE id = ?')
    .get(channelId) as
    { id: string; name: string; guild_id: string } | undefined
  expectValue(
    context,
    'state',
    'Channel row existence matches response',
    exists,
    row !== undefined
  )
  if (!exists || !row) return
  expectValue(
    context,
    'state',
    'Channel row name matches response',
    name,
    row.name
  )
  expectValue(
    context,
    'state',
    'Channel row belongs to the modeled guild',
    GUILD_ID,
    row.guild_id
  )
}

/** Creates a message and verifies response, state, and dispatch. */
async function createMessage(
  context: ScenarioContext,
  operation: Extract<
    ModelOperation,
    { kind: 'create-message' | 'boundary-message' }
  >
): Promise<void> {
  const channel = context.channels.get(operation.channelRef)
  if (!channel?.alive) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    'POST',
    `${API_PREFIX}/channels/${channel.id}/messages`,
    { content: operation.content }
  )
  expectStatus(context, response, 200, 'Message creation must return 200')
  const message = requireRecord(
    context,
    response.body,
    'Created message must be an object'
  )
  const messageId = requireString(
    context,
    message.id,
    'Created message must have an ID'
  )
  expectValue(
    context,
    'response',
    'created message content matches request',
    operation.content,
    message.content
  )
  expectValue(
    context,
    'response',
    'created message belongs to the requested channel',
    channel.id,
    message.channel_id
  )
  expectValue(
    context,
    'response',
    'created message author is the local bot',
    BOT_USER_ID,
    getRecord(message.author)?.id
  )
  const event = await requireDispatch(context, 'MESSAGE_CREATE')
  const eventData = requireRecord(
    context,
    event.d,
    'MESSAGE_CREATE must contain a message object'
  )
  expectValue(
    context,
    'gateway',
    'MESSAGE_CREATE identifies the created message',
    messageId,
    eventData.id
  )
  expectValue(
    context,
    'gateway',
    'MESSAGE_CREATE uses the requested channel',
    channel.id,
    eventData.channel_id
  )
  expectValue(
    context,
    'gateway',
    'MESSAGE_CREATE carries the message content',
    operation.content,
    eventData.content
  )
  currentObservation(context).gateway = event

  const state: MessageState = {
    id: messageId,
    channelRef: operation.channelRef,
    alive: true,
    content: operation.content,
    pinned: false,
    reactions: new Set(),
  }
  context.messages.set(operation.ref, state)
  context.messageRefsByChannel.get(operation.channelRef)?.add(operation.ref)
  await assertMessageState(context, operation.ref, state)
}

/** Reads a message and checks its modeled fields. */
async function getMessage(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'get-message' }>
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    'GET',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}`
  )
  expectStatus(
    context,
    response,
    200,
    'Existing message lookup must return 200'
  )
  const message = requireRecord(
    context,
    response.body,
    'Message response must be an object'
  )
  expectMessageFields(context, message, state, channel.id)
  assertDatabaseMessage(context, state)
}

/** Edits a message and verifies response, state, and dispatch. */
async function editMessage(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'edit-message' }>
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive || state.channelRef !== operation.channelRef) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    'PATCH',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}`,
    { content: operation.content }
  )
  expectStatus(context, response, 200, 'Message edit must return 200')
  const message = requireRecord(
    context,
    response.body,
    'Edited message must be an object'
  )
  expectValue(
    context,
    'response',
    'edited message content matches request',
    operation.content,
    message.content
  )
  expectValue(
    context,
    'response',
    'edited message retains its ID',
    state.id,
    message.id
  )
  expectValue(
    context,
    'response',
    'edited timestamp is present',
    true,
    typeof message.edited_timestamp === 'string'
  )
  const event = await requireDispatch(context, 'MESSAGE_UPDATE')
  const eventData = requireRecord(
    context,
    event.d,
    'MESSAGE_UPDATE must contain a message object'
  )
  expectValue(
    context,
    'gateway',
    'MESSAGE_UPDATE identifies the edited message',
    state.id,
    eventData.id
  )
  expectValue(
    context,
    'gateway',
    'MESSAGE_UPDATE carries the edited content',
    operation.content,
    eventData.content
  )
  currentObservation(context).gateway = event
  state.content = operation.content
  await assertMessageState(context, operation.ref, state)
}

/** Deletes a message and verifies dependent state and dispatch. */
async function deleteMessage(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'delete-message' }>
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive || state.channelRef !== operation.channelRef) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    'DELETE',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}`
  )
  expectStatus(context, response, 204, 'Message deletion must return 204')
  const event = await requireDispatch(context, 'MESSAGE_DELETE')
  const eventData = requireRecord(
    context,
    event.d,
    'MESSAGE_DELETE must contain a message reference'
  )
  expectValue(
    context,
    'gateway',
    'MESSAGE_DELETE identifies the deleted message',
    state.id,
    eventData.id
  )
  expectValue(
    context,
    'gateway',
    'MESSAGE_DELETE uses the owning channel',
    channel.id,
    eventData.channel_id
  )
  currentObservation(context).gateway = event
  state.alive = false
  context.messageRefsByChannel.get(operation.channelRef)?.remove(operation.ref)

  const getResponse = await context.request(
    'GET',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}`
  )
  expectValue(
    context,
    'state',
    'Deleted message must return Unknown Message',
    404,
    getResponse.status
  )
  if (getResponse.status === 404) {
    expectValue(
      context,
      'state',
      'Deleted message error code is Unknown Message',
      10_008,
      getRecord(getResponse.body)?.code
    )
  }
  assertDeletedMessageRows(context, state.id)
}

/** Lists channel messages and compares them with modeled state. */
async function listMessages(
  context: ScenarioContext,
  channelRef: string
): Promise<void> {
  const channel = context.channels.get(channelRef)
  if (!channel?.alive) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    'GET',
    `${API_PREFIX}/channels/${channel.id}/messages?limit=100`
  )
  expectStatus(
    context,
    response,
    200,
    'Channel message listing must return 200'
  )
  const messages = requireArray(
    context,
    response.body,
    'Channel message listing must be an array'
  )
  const actualIds = messages
    .map((message) => (isRecord(message) ? message.id : undefined))
    .filter((id): id is string => typeof id === 'string')
  const channelMessageRefs = context.messageRefsByChannel.get(channelRef)
  const expectedPageIds = (channelMessageRefs?.latest(100) ?? [])
    .map((messageRef) => context.messages.get(messageRef)?.id)
    .filter((id): id is string => typeof id === 'string')
  expectValue(
    context,
    'state',
    'Channel listing matches modeled messages',
    expectedPageIds,
    actualIds
  )
}

/** Adds or removes a reaction and checks its state and dispatch. */
async function changeReaction(
  context: ScenarioContext,
  operation: Extract<
    ModelOperation,
    { kind: 'add-reaction' | 'remove-reaction' }
  >,
  add: boolean
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive || state.channelRef !== operation.channelRef) {
    skipCurrent(context)
    return
  }
  const hadReaction = state.reactions.has(operation.emoji)
  const method = add ? 'PUT' : 'DELETE'
  const action = add ? 'add' : 'remove'
  const response = await context.request(
    method,
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}/reactions/${encodeURIComponent(operation.emoji)}/@me`
  )
  expectStatus(context, response, 204, `Reaction ${action} must return 204`)
  const changed = add ? !hadReaction : hadReaction
  if (changed) {
    const eventName = add ? 'MESSAGE_REACTION_ADD' : 'MESSAGE_REACTION_REMOVE'
    const event = await requireDispatch(context, eventName)
    const eventData = requireRecord(
      context,
      event.d,
      `${eventName} must contain a reaction reference`
    )
    expectValue(
      context,
      'gateway',
      `${eventName} identifies the message`,
      state.id,
      eventData.message_id
    )
    expectValue(
      context,
      'gateway',
      `${eventName} identifies the channel`,
      channel.id,
      eventData.channel_id
    )
    expectValue(
      context,
      'gateway',
      `${eventName} identifies the bot user`,
      BOT_USER_ID,
      eventData.user_id
    )
    expectValue(
      context,
      'gateway',
      `${eventName} identifies the emoji`,
      operation.emoji,
      getRecord(eventData.emoji)?.name
    )
    currentObservation(context).gateway = event
  }
  if (add) state.reactions.add(operation.emoji)
  else state.reactions.delete(operation.emoji)
  await assertReactionState(context, state, operation.emoji)
}

/** Pins or unpins a message and checks its resulting state. */
async function pinMessage(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'pin-message' | 'unpin-message' }>,
  pin: boolean
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive || state.channelRef !== operation.channelRef) {
    skipCurrent(context)
    return
  }
  const method = pin ? 'PUT' : 'DELETE'
  const response = await context.request(
    method,
    `${API_PREFIX}/channels/${channel.id}/messages/pins/${state.id}`
  )
  expectStatus(
    context,
    response,
    204,
    `${pin ? 'Pin' : 'Unpin'} must return 204`
  )
  state.pinned = pin
  await assertPinState(context, state)
}

/** Checks that pinning through another channel is rejected. */
async function wrongChannelPin(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'wrong-channel-pin' }>
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive || state.channelRef === operation.channelRef) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    'PUT',
    `${API_PREFIX}/channels/${channel.id}/messages/pins/${state.id}`
  )
  expectDiscordError(
    context,
    response,
    403,
    50_019,
    'Pinning through another channel must return Wrong Pin Channel'
  )
  await assertPinState(context, state)
}

/** Checks that reacting through another channel is rejected. */
async function wrongChannelReaction(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'wrong-channel-reaction' }>
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive || state.channelRef === operation.channelRef) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    'PUT',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}/reactions/${encodeURIComponent(REACTION)}/@me`
  )
  expectDiscordError(
    context,
    response,
    404,
    10_008,
    'Reacting through another channel must return Unknown Message'
  )
  await assertReactionState(context, state, REACTION)
}

/** Checks rejection of a message with invalid content. */
async function invalidMessage(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'invalid-message' }>
): Promise<void> {
  const before = databaseMessageCount(context)
  const response = await context.request(
    'POST',
    `${API_PREFIX}/channels/${PRIMARY_CHANNEL_ID}/messages`,
    { content: operation.content }
  )
  expectDiscordError(
    context,
    response,
    400,
    operation.expectedCode,
    'Invalid message input must return its Discord validation error'
  )
  const after = databaseMessageCount(context)
  expectValue(
    context,
    'state',
    'Rejected message input does not create a row',
    before,
    after
  )
}

/** Checks rejection of a malformed reaction emoji. */
async function invalidEmoji(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'invalid-emoji' }>
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive) {
    skipCurrent(context)
    return
  }
  const malformedEmoji = encodeURIComponent('%E0%A4%A')
  const response = await context.request(
    'PUT',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}/reactions/${malformedEmoji}/@me`
  )
  expectDiscordError(
    context,
    response,
    400,
    50_035,
    'Malformed emoji encoding must return Invalid Form Body'
  )
  await assertReactionState(context, state, REACTION)
}

/** Checks requests against a deleted message. */
async function staleMessage(
  context: ScenarioContext,
  operation: Extract<
    ModelOperation,
    { kind: 'stale-message-read' | 'stale-message-delete' }
  >,
  remove: boolean
): Promise<void> {
  const previous = context.messages.get(operation.ref)
  const channel = context.channels.get(operation.channelRef)
  const messageId = previous?.id ?? MISSING_ID
  const channelId = channel?.id ?? PRIMARY_CHANNEL_ID
  const response = await context.request(
    remove ? 'DELETE' : 'GET',
    `${API_PREFIX}/channels/${channelId}/messages/${messageId}`
  )
  expectDiscordError(
    context,
    response,
    404,
    10_008,
    `Stale message ${remove ? 'deletion' : 'lookup'} must return Unknown Message`
  )
  if (previous) assertDeletedMessageRows(context, previous.id)
}

/** Checks message access through another channel. */
async function wrongChannelMessage(
  context: ScenarioContext,
  operation: Extract<
    ModelOperation,
    { kind: 'wrong-channel-read' | 'wrong-channel-edit' }
  >,
  edit: boolean
): Promise<void> {
  const state = getActiveMessage(context, operation.ref)
  const channel = context.channels.get(operation.channelRef)
  if (!state || !channel?.alive || state.channelRef === operation.channelRef) {
    skipCurrent(context)
    return
  }
  const response = await context.request(
    edit ? 'PATCH' : 'GET',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}`,
    edit && 'content' in operation ? { content: operation.content } : undefined
  )
  expectDiscordError(
    context,
    response,
    404,
    10_008,
    `Cross-channel message ${edit ? 'edit' : 'lookup'} must return Unknown Message`
  )
  await assertMessageState(context, operation.ref, state)
}

/** Checks message creation in a deleted channel. */
async function postToDeletedChannel(
  context: ScenarioContext,
  operation: Extract<ModelOperation, { kind: 'post-to-deleted-channel' }>
): Promise<void> {
  const channel = context.channels.get(operation.channelRef)
  if (channel?.alive) {
    skipCurrent(context)
    return
  }
  const before = databaseMessageCount(context)
  const response = await context.request(
    'POST',
    `${API_PREFIX}/channels/${channel?.id ?? MISSING_ID}/messages`,
    { content: operation.content }
  )
  expectDiscordError(
    context,
    response,
    404,
    10_003,
    'Posting to a deleted channel must return Unknown Channel'
  )
  expectValue(
    context,
    'state',
    'Rejected post does not create a message',
    before,
    databaseMessageCount(context)
  )
}

/** Resolves a live modeled message by its reference. */
function getActiveMessage(
  context: ScenarioContext,
  ref: string
): MessageState | undefined {
  const message = context.messages.get(ref)
  return message?.alive ? message : undefined
}

/** Compares a message with its persisted and API state. */
async function assertMessageState(
  context: ScenarioContext,
  ref: string,
  state: MessageState
): Promise<void> {
  const channel = context.channels.get(state.channelRef)
  if (!channel?.alive) {
    fail(
      context,
      'state',
      'Active message must belong to an active channel',
      'active channel',
      state.channelRef
    )
  }
  const response = await context.request(
    'GET',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}`
  )
  expectStatus(context, response, 200, 'Message state lookup must return 200')
  const message = requireRecord(
    context,
    response.body,
    'Message state response must be an object'
  )
  expectMessageFields(context, message, state, channel.id)
  assertDatabaseMessage(context, state)

  const current = currentObservation(context)
  current.expected = {
    operation: current.operation,
    modeledMessage: { ref, ...state, reactions: [...state.reactions] },
  }
}

/** Checks response fields against modeled message state. */
function expectMessageFields(
  context: ScenarioContext,
  message: JsonObject,
  state: MessageState,
  channelId: string
): void {
  expectValue(
    context,
    'response',
    'message ID matches the model',
    state.id,
    message.id
  )
  expectValue(
    context,
    'response',
    'message channel matches the model',
    channelId,
    message.channel_id
  )
  expectValue(
    context,
    'response',
    'message content matches the model',
    state.content,
    message.content
  )
  expectValue(
    context,
    'response',
    'message pinned state matches the model',
    state.pinned,
    message.pinned
  )
  const reactions = Array.isArray(message.reactions) ? message.reactions : []
  const reaction = reactions.find(
    (item) => isRecord(item) && getRecord(item.emoji)?.name === REACTION
  )
  expectValue(
    context,
    'response',
    'message reaction presence matches the model',
    state.reactions.has(REACTION),
    reaction !== undefined
  )
  if (isRecord(reaction)) {
    expectValue(
      context,
      'response',
      'message reaction count matches the model',
      1,
      reaction.count
    )
  }
}

/** Checks persisted message fields and related rows. */
function assertDatabaseMessage(
  context: ScenarioContext,
  state: MessageState
): void {
  const channel = context.channels.get(state.channelRef)
  if (!channel)
    fail(
      context,
      'state',
      'Message channel must remain modeled',
      'known channel',
      state.channelRef
    )
  const row = context.server.db
    .prepare(
      'SELECT id, channel_id, content, pinned FROM messages WHERE id = ?'
    )
    .get(state.id) as
    | { id: string; channel_id: string; content: string; pinned: number }
    | undefined
  expectValue(
    context,
    'state',
    'Database contains the active message',
    true,
    row !== undefined
  )
  if (!row) return
  expectValue(
    context,
    'state',
    'Database message channel matches the model',
    channel.id,
    row.channel_id
  )
  expectValue(
    context,
    'state',
    'Database message content matches the model',
    state.content,
    row.content
  )
  expectValue(
    context,
    'state',
    'Database pinned flag matches the model',
    state.pinned,
    row.pinned === 1
  )
}

/** Checks reaction users and persisted reaction rows. */
async function assertReactionState(
  context: ScenarioContext,
  state: MessageState,
  emoji: string
): Promise<void> {
  const channel = context.channels.get(state.channelRef)
  if (!channel?.alive) {
    fail(
      context,
      'state',
      'Reaction target channel must remain active',
      'active channel',
      state.channelRef
    )
  }
  const encodedEmoji = encodeURIComponent(emoji)
  const response = await context.request(
    'GET',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}/reactions/${encodedEmoji}`
  )
  expectStatus(context, response, 200, 'Reaction user listing must return 200')
  const users = requireArray(
    context,
    response.body,
    'Reaction user listing must be an array'
  )
  const userIds = users
    .map((user) => (isRecord(user) ? user.id : undefined))
    .filter((id): id is string => typeof id === 'string')
  const expectedUserIds = state.reactions.has(emoji) ? [BOT_USER_ID] : []
  expectValue(
    context,
    'state',
    'Reaction users match the modeled set',
    expectedUserIds,
    userIds
  )
  const count = context.server.db
    .prepare(
      'SELECT COUNT(*) AS count FROM reactions WHERE message_id = ? AND emoji = ?'
    )
    .get(state.id, emoji) as { count: number }
  expectValue(
    context,
    'state',
    'Reaction rows match the modeled set',
    expectedUserIds.length,
    count.count
  )
  const messageResponse = await context.request(
    'GET',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}`
  )
  expectStatus(
    context,
    messageResponse,
    200,
    'Message state lookup must return 200'
  )
  const message = requireRecord(
    context,
    messageResponse.body,
    'Message response must be an object'
  )
  expectMessageFields(context, message, state, channel.id)
}

/** Checks the message pin state and channel pin list. */
async function assertPinState(
  context: ScenarioContext,
  state: MessageState
): Promise<void> {
  const channel = context.channels.get(state.channelRef)
  if (!channel?.alive) {
    fail(
      context,
      'state',
      'Pin target channel must remain active',
      'active channel',
      state.channelRef
    )
  }
  const messageResponse = await context.request(
    'GET',
    `${API_PREFIX}/channels/${channel.id}/messages/${state.id}`
  )
  expectStatus(
    context,
    messageResponse,
    200,
    'Message state lookup must return 200'
  )
  const message = requireRecord(
    context,
    messageResponse.body,
    'Message response must be an object'
  )
  expectMessageFields(context, message, state, channel.id)

  const pinsResponse = await context.request(
    'GET',
    `${API_PREFIX}/channels/${channel.id}/messages/pins`
  )
  expectStatus(context, pinsResponse, 200, 'Pin listing must return 200')
  const pins = requireRecord(
    context,
    pinsResponse.body,
    'Pin listing must be an object'
  )
  const items = requireArray(
    context,
    pins.items,
    'Pin listing items must be an array'
  )
  const matching = items.filter(
    (item) => isRecord(item) && getRecord(item.message)?.id === state.id
  )
  expectValue(
    context,
    'state',
    'Pin listing membership matches the model',
    state.pinned,
    matching.length === 1
  )
  expectValue(
    context,
    'state',
    'Database pin rows match the model',
    state.pinned ? 1 : 0,
    (
      context.server.db
        .prepare(
          'SELECT COUNT(*) AS count FROM pins WHERE channel_id = ? AND message_id = ?'
        )
        .get(channel.id, state.id) as { count: number }
    ).count
  )
}

/** Checks that deleting a message removes dependent rows. */
function assertDeletedMessageRows(
  context: ScenarioContext,
  messageId: string
): void {
  const rows = context.server.db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM messages WHERE id = ?) AS messages,
        (SELECT COUNT(*) FROM reactions WHERE message_id = ?) AS reactions,
        (SELECT COUNT(*) FROM pins WHERE message_id = ?) AS pins,
        (SELECT COUNT(*) FROM attachments WHERE message_id = ?) AS attachments,
        (SELECT COUNT(*) FROM embeds WHERE message_id = ?) AS embeds`
    )
    .get(messageId, messageId, messageId, messageId, messageId) as {
    messages: number
    reactions: number
    pins: number
    attachments: number
    embeds: number
  }
  expectValue(
    context,
    'state',
    'Message deletion cascades dependent rows',
    {
      messages: 0,
      reactions: 0,
      pins: 0,
      attachments: 0,
      embeds: 0,
    },
    rows
  )
}

/** Returns the number of persisted messages. */
function databaseMessageCount(context: ScenarioContext): number {
  return (
    context.server.db
      .prepare('SELECT COUNT(*) AS count FROM messages')
      .get() as { count: number }
  ).count
}

/** Waits for a Gateway dispatch or records a scenario failure. */
async function requireDispatch(
  context: ScenarioContext,
  event: string
): Promise<GatewayPayload> {
  try {
    return await context.observer.waitForDispatch(
      event,
      context.gatewayTimeoutMs
    )
  } catch (error) {
    fail(
      context,
      'gateway',
      `Expected ${event} after the corresponding API state transition`,
      { event },
      { error: error instanceof Error ? error.message : String(error) }
    )
  }
}

/** Checks an HTTP status against the expected status. */
function expectStatus(
  context: ScenarioContext,
  response: HttpResult,
  status: number,
  invariant: string
): void {
  expectValue(context, 'response', invariant, status, response.status)
}

/** Checks a Discord error response code and status. */
function expectDiscordError(
  context: ScenarioContext,
  response: HttpResult,
  status: number,
  code: number,
  invariant: string
): void {
  expectStatus(context, response, status, invariant)
  const error = getRecord(response.body)
  expectValue(
    context,
    'response',
    `${invariant}: Discord error code`,
    code,
    error?.code
  )
  expectValue(
    context,
    'response',
    `${invariant}: Discord error message`,
    true,
    typeof error?.message === 'string'
  )
}

/** Compares expected and observed invariant values. */
function expectValue(
  context: ScenarioContext,
  category: ExplorerFinding['category'],
  invariant: string,
  expected: unknown,
  actual: unknown
): void {
  if (stableJson(expected) === stableJson(actual)) return
  fail(context, category, invariant, expected, actual)
}

/** Checks the length of an observed array. */
function expectArrayLength(
  context: ScenarioContext,
  category: ExplorerFinding['category'],
  invariant: string,
  expected: number,
  actual: unknown
): void {
  const length = Array.isArray(actual) ? actual.length : undefined
  expectValue(context, category, invariant, expected, length)
}

/** Requires a JSON object or records a response failure. */
function requireRecord(
  context: ScenarioContext,
  value: unknown,
  invariant: string
): JsonObject {
  if (isRecord(value)) return value
  fail(context, 'response', invariant, 'JSON object', value)
}

/** Requires a JSON array or records a response failure. */
function requireArray(
  context: ScenarioContext,
  value: unknown,
  invariant: string
): unknown[] {
  if (Array.isArray(value)) return value
  fail(context, 'response', invariant, 'JSON array', value)
}

/** Requires a string value or records a response failure. */
function requireString(
  context: ScenarioContext,
  value: unknown,
  invariant: string
): string {
  if (typeof value === 'string') return value
  fail(context, 'response', invariant, 'string', value)
}

/** Returns a value as a JSON object when possible. */
function getRecord(value: unknown): JsonObject | undefined {
  return isRecord(value) ? value : undefined
}

/** Checks whether a value is a JSON object. */
function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Marks the current operation as skipped. */
function skipCurrent(context: ScenarioContext): void {
  if (context.current) context.current.outcome = 'skipped'
}

/** Returns the active operation observation. */
function currentObservation(context: ScenarioContext): OperationObservation {
  if (!context.current) throw new Error('No active operation observation')
  return context.current
}

/** Records a structured invariant failure for the current operation. */
function fail(
  context: ScenarioContext,
  category: ExplorerFinding['category'],
  invariant: string,
  expected: unknown,
  actual: unknown
): never {
  const current = context.current
  if (!current)
    throw new Error(`Invariant failed outside an operation: ${invariant}`)
  const finding: ExplorerFinding = {
    category,
    invariant,
    operationIndex: current.index,
    operation: current.operation,
    expected,
    actual,
    signature: `${current.operation.kind}:${category}:${invariant}`,
  }
  current.expected = expected
  throw new InvariantViolation(finding)
}

/** Serializes values with stable key ordering. */
function stableJson(value: unknown): string {
  return JSON.stringify(normalizeValue(value))
}

/** Normalizes nested values before stable serialization. */
function normalizeValue(value: unknown): unknown {
  if (value instanceof Set) {
    return [...value]
      .map((item) => normalizeValue(item))
      .toSorted((left, right) =>
        stableJson(left).localeCompare(stableJson(right))
      )
  }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item))
  return isRecord(value)
    ? Object.fromEntries(
        Object.keys(value)
          .toSorted((left, right) => left.localeCompare(right))
          .map((key) => [key, normalizeValue(value[key])])
      )
    : value
}

/** Reduces an operation sequence while preserving its finding. */
async function minimizeScenario(
  options: RunOptions,
  signature: string
): Promise<{ operations: ModelOperation[]; trace: OperationObservation[] }> {
  let current = [...options.operations]
  let partitions = 2
  while (current.length >= 2) {
    const chunkSize = Math.ceil(current.length / partitions)
    let reduced = false
    for (let start = 0; start < current.length; start += chunkSize) {
      const candidate = current.filter(
        (_, index) => index < start || index >= start + chunkSize
      )
      if (candidate.length === 0) continue
      const result = await runScenarioOnce({
        ...options,
        operations: candidate,
        minimize: false,
      })
      if (result.finding?.signature !== signature) continue
      current = candidate
      partitions = Math.max(2, partitions - 1)
      reduced = true
      break
    }
    if (reduced) continue
    if (partitions >= current.length) break
    partitions = Math.min(current.length, partitions * 2)
  }
  const result = await runScenarioOnce({
    ...options,
    operations: current,
    minimize: false,
  })
  return { operations: current, trace: result.trace }
}

/**
 * Runs a seeded exploration using the built-in state-aware generator.
 * @param seed - Unsigned 32-bit seed
 * @param steps - Number of generated operations
 * @param minimize - Whether to minimize a discovered mismatch
 * @returns Reproducible result and request evidence
 */
export async function runSeededExploration(
  seed: string | number,
  steps: number,
  minimize = true
): Promise<ExplorationResult> {
  const normalizedSeed = parseSeed(seed)
  const operations = generateModelOperations(normalizedSeed, steps)
  return await runModelScenario({
    seed: String(normalizedSeed),
    operations,
    minimize,
  })
}

/** Builds the expected status and error for an operation. */
function expectedFor(operation: ModelOperation): unknown {
  const statuses: Record<ModelOperation['kind'], number> = {
    'create-channel': 201,
    'delete-channel': 200,
    'get-channel':
      operation.kind === 'get-channel' && operation.expectMissing ? 404 : 200,
    'list-channels': 200,
    'create-message': 200,
    'boundary-message': 200,
    'get-message': 200,
    'edit-message': 200,
    'delete-message': 204,
    'list-messages': 200,
    'add-reaction': 204,
    'remove-reaction': 204,
    'pin-message': 204,
    'unpin-message': 204,
    'wrong-channel-pin': 403,
    'wrong-channel-reaction': 404,
    'invalid-message': 400,
    'invalid-emoji': 400,
    'stale-message-read': 404,
    'stale-message-delete': 404,
    'wrong-channel-read': 404,
    'wrong-channel-edit': 404,
    'post-to-deleted-channel': 404,
  }
  const expected: JsonObject = {
    operation,
    httpStatus: statuses[operation.kind],
  }
  switch (operation.kind) {
    case 'invalid-message': {
      return { ...expected, errorCode: operation.expectedCode }
    }
    case 'wrong-channel-pin': {
      return { ...expected, errorCode: 50_019 }
    }
    case 'wrong-channel-reaction':
    case 'stale-message-read':
    case 'stale-message-delete':
    case 'wrong-channel-read':
    case 'wrong-channel-edit': {
      return { ...expected, errorCode: 10_008 }
    }
    case 'post-to-deleted-channel': {
      return { ...expected, errorCode: 10_003 }
    }
    case 'invalid-emoji': {
      return { ...expected, errorCode: 50_035 }
    }
    default: {
      return expected
    }
  }
}

/** Parses CLI options and runs a seeded exploration. */
async function runCli(arguments_: string[]): Promise<number> {
  const options = new Map<string, string>()
  let minimize = true
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        'Usage: pnpm fuzz --seed <uint32> --steps <count> [--out <path>] [--no-minimize]\n'
      )
      return 0
    }
    if (argument === '--no-minimize') {
      minimize = false
      continue
    }
    const [name = '', parsedValue] = argument.split('=', 2)
    if (!name.startsWith('--')) throw new Error(`Unknown argument: ${argument}`)
    const inlineValue = argument.includes('=') ? parsedValue : undefined
    const value = inlineValue ?? arguments_[++index]
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${name}`)
    options.set(name, value)
  }

  const seedValue = options.get('--seed')
  const stepsValue = options.get('--steps')
  if (seedValue === undefined || stepsValue === undefined) {
    throw new Error(
      'Both --seed and --steps are required; use --help for usage'
    )
  }
  const seed = parseSeed(seedValue)
  const steps = Number(stepsValue)
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > 100_000) {
    throw new Error('--steps must be an integer between 1 and 100000')
  }

  const result = await runSeededExploration(seed, steps, minimize)
  if (!result.passed) {
    const outputPath = path.resolve(
      options.get('--out') ??
        path.join(
          '.fauxcord-exploration',
          `seed-${seed}-${Date.now()}-${randomUUID().slice(0, 8)}.json`
        )
    )
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
      flag: 'wx',
    })
    process.stdout.write(
      `${JSON.stringify(
        {
          seed: result.seed,
          passed: false,
          generatedSteps: result.generatedSteps,
          executedSteps: result.executedSteps,
          finding: result.finding,
          minimizedOperations: result.minimized?.operations.length,
          report: outputPath,
        },
        null,
        2
      )}\n`
    )
    return 1
  }

  const coverage = Object.fromEntries(
    [...new Set(result.operations.map(({ kind }) => kind))]
      .toSorted((left, right) => left.localeCompare(right))
      .map((kind) => [
        kind,
        result.operations.filter((operation) => operation.kind === kind).length,
      ])
  )
  process.stdout.write(
    `${JSON.stringify(
      {
        seed: result.seed,
        passed: true,
        generatedSteps: result.generatedSteps,
        executedSteps: result.executedSteps,
        checks: result.checks.length,
        coverage,
      },
      null,
      2
    )}\n`
  )
  return 0
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  process.exitCode = await runCli(process.argv.slice(2))
}
