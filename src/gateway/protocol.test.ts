import { describe, it, expect } from 'vitest'
import { encodePayload, decodePayload } from './protocol'
import { GatewayOp } from './opcodes'

describe('encodePayload / decodePayload', () => {
  it('encodes a payload to JSON text', () => {
    const json = encodePayload({
      op: GatewayOp.Hello,
      d: { heartbeat_interval: 41_250 },
    })
    expect(JSON.parse(json)).toEqual({
      op: 10,
      d: { heartbeat_interval: 41_250 },
      s: null,
      t: null,
    })
  })

  it('always includes explicit `s`/`t` keys (real Discord never omits them)', () => {
    // Some strict clients (e.g. Nextcord) index message["s"] directly and
    // raise a KeyError if the key is missing entirely, so `s`/`t` must be
    // present as `null` rather than omitted for non-Dispatch payloads.
    const json = encodePayload({ op: GatewayOp.HeartbeatAck, d: null })
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed).toHaveProperty('s', null)
    expect(parsed).toHaveProperty('t', null)
  })

  it('preserves explicit `s`/`t` values for Dispatch payloads', () => {
    const json = encodePayload({
      op: GatewayOp.Dispatch,
      t: 'READY',
      s: 1,
      d: {},
    })
    expect(JSON.parse(json)).toEqual({ op: 0, t: 'READY', s: 1, d: {} })
  })

  it('decodes valid JSON text into a payload', () => {
    const payload = decodePayload(
      '{"op":2,"d":{"token":"Bot x","intents":513}}'
    )
    expect(payload).toEqual({ op: 2, d: { token: 'Bot x', intents: 513 } })
  })

  it('returns undefined for invalid JSON', () => {
    expect(decodePayload('not json')).toBeUndefined()
  })
})
