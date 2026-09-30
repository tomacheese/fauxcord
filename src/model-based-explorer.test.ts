import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  GatewayObserver,
  generateModelOperations,
  runModelScenario,
  runSeededExploration,
} from './model-based-explorer'
import type { ModelOperation } from './model-based-explorer'

const PRIMARY_CHANNEL = '333333333333333333'
const SECONDARY_CHANNEL = '444444444444444444'

const lifecycle: ModelOperation[] = [
  {
    kind: 'create-message',
    ref: 'message-a',
    channelRef: 'primary',
    content: 'initial',
  },
  {
    kind: 'add-reaction',
    ref: 'message-a',
    channelRef: 'primary',
    emoji: '👍',
  },
  {
    kind: 'add-reaction',
    ref: 'message-a',
    channelRef: 'primary',
    emoji: '👍',
  },
  { kind: 'pin-message', ref: 'message-a', channelRef: 'primary' },
  { kind: 'pin-message', ref: 'message-a', channelRef: 'primary' },
  {
    kind: 'edit-message',
    ref: 'message-a',
    channelRef: 'primary',
    content: 'edited',
  },
  {
    kind: 'remove-reaction',
    ref: 'message-a',
    channelRef: 'primary',
    emoji: '👍',
  },
  { kind: 'unpin-message', ref: 'message-a', channelRef: 'primary' },
  { kind: 'delete-message', ref: 'message-a', channelRef: 'primary' },
  { kind: 'stale-message-read', ref: 'message-a', channelRef: 'primary' },
]

/** Provides a closed WebSocket-shaped object for observer unit tests. */
interface ObserverSocketHarness {
  socket: WebSocket
  emitMessage: (raw: WebSocket.RawData) => void
}

/** Creates a closed socket harness that can deliver one message callback. */
function createObserverSocketHarness(): ObserverSocketHarness {
  let messageListener: ((raw: WebSocket.RawData) => void) | undefined
  const socket = {
    readyState: WebSocket.CLOSED,
    on: (event: string, listener: (raw: WebSocket.RawData) => void) => {
      if (event === 'message') messageListener = listener
    },
    off: (event: string, listener: (raw: WebSocket.RawData) => void) => {
      if (event === 'message' && messageListener === listener) {
        messageListener = undefined
      }
    },
  }
  return {
    socket: socket as unknown as WebSocket,
    emitMessage: (raw) => messageListener?.(raw),
  }
}

describe('model-based API explorer', () => {
  it('generates the same state-aware operations from the same seed', () => {
    const first = generateModelOperations(0x5e_ed, 120)
    const replay = generateModelOperations('24301', 120)
    const otherSeed = generateModelOperations(0x5e_ee, 120)

    expect(first).toEqual(replay)
    expect(otherSeed).not.toEqual(first)
    expect(first).toContainEqual(
      expect.objectContaining({ kind: 'boundary-message' })
    )
    expect(first).toContainEqual(
      expect.objectContaining({ kind: 'invalid-message' })
    )
  })

  it('does not reuse Gateway frames already delivered to a waiter', async () => {
    const { socket } = createObserverSocketHarness()
    const observer = new GatewayObserver(socket, undefined)
    const firstWait = observer.waitForDispatch('MESSAGE_CREATE', 100)

    observer.inject({ t: 'MESSAGE_CREATE', d: { id: 'first-message' } })

    await expect(firstWait).resolves.toMatchObject({
      d: { id: 'first-message' },
    })
    await expect(observer.waitForDispatch('MESSAGE_CREATE', 5)).rejects.toThrow(
      'Timed out waiting for Gateway frame'
    )
    await observer.close()
  })

  it('surfaces malformed Gateway frames as observer failures', async () => {
    const { socket, emitMessage } = createObserverSocketHarness()
    const observer = new GatewayObserver(socket, undefined)
    const wait = observer.waitForDispatch('MESSAGE_CREATE', 100)

    emitMessage(Buffer.from('{'))

    await expect(wait).rejects.toThrow('Invalid Gateway JSON frame')
    await expect(observer.waitForDispatch('MESSAGE_CREATE', 5)).rejects.toThrow(
      'Invalid Gateway JSON frame'
    )
    await observer.close()
  })

  it('runs create, read, edit, reaction, pin, delete, and stale-resource transitions', async () => {
    const result = await runModelScenario({
      seed: '24301',
      operations: lifecycle,
    })

    expect(result.passed).toBe(true)
    expect(result.executedSteps).toBe(lifecycle.length)
    expect(result.finding).toBeUndefined()
    expect(result.trace.every(({ outcome }) => outcome === 'passed')).toBe(true)
  })

  it('checks the newest page when modeled channel history exceeds 100 messages', async () => {
    const operations: ModelOperation[] = [
      ...Array.from({ length: 105 }, (_, index) => ({
        kind: 'create-message' as const,
        ref: `message-${index}`,
        channelRef: 'primary',
        content: `message ${index}`,
      })),
      {
        kind: 'delete-message',
        ref: 'message-104',
        channelRef: 'primary',
      },
      { kind: 'list-messages', channelRef: 'primary' },
    ]

    const result = await runModelScenario({ seed: 4, operations })

    expect(result.passed).toBe(true)
    expect(result.executedSteps).toBe(107)
    expect(result.finding).toBeUndefined()
  })

  it('reproduces validation outcomes for the same generated seed', async () => {
    const first = await runSeededExploration(0x5_1a_7e, 28, false)
    const replay = await runSeededExploration(0x5_1a_7e, 28, false)

    expect(first.operations).toEqual(replay.operations)
    expect(first.passed).toBe(replay.passed)
    expect(first.finding?.signature).toBe(replay.finding?.signature)
    expect(first.checks).toEqual(replay.checks)
  })

  it('detects response, state, and Gateway defects injected only in the isolated harness', async () => {
    const create: ModelOperation = {
      kind: 'create-message',
      ref: 'message-a',
      channelRef: 'primary',
      content: 'mutation probe',
    }
    const createResult = await runModelScenario({
      seed: 1,
      operations: [create],
      mutation: { kind: 'corrupt-create-response' },
      minimize: true,
    })
    expect(createResult.finding?.category).toBe('response')
    expect(createResult.minimized?.operations).toEqual([create])
    expect(createResult.finding?.expected).toEqual(PRIMARY_CHANNEL)
    expect(createResult.finding?.actual).toEqual(SECONDARY_CHANNEL)

    const deleteResult = await runModelScenario({
      seed: 2,
      operations: [
        create,
        { kind: 'delete-message', ref: 'message-a', channelRef: 'primary' },
      ],
      mutation: { kind: 'skip-message-delete' },
      minimize: false,
    })
    expect(deleteResult.finding?.category).toBe('state')
    expect(deleteResult.finding?.invariant).toContain(
      'Deleted message must return Unknown Message'
    )

    const gatewayResult = await runModelScenario({
      seed: 3,
      operations: [create],
      mutation: { kind: 'drop-gateway-event', event: 'MESSAGE_CREATE' },
      gatewayTimeoutMs: 50,
      minimize: false,
    })
    expect(gatewayResult.finding?.category).toBe('gateway')
    expect(gatewayResult.finding?.invariant).toContain('MESSAGE_CREATE')
  })
})
