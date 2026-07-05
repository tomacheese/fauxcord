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
    })
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
