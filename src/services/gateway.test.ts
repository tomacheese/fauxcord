import { describe, it, expect } from 'vitest'
import { getGatewayInfo, getGatewayBotInfo } from './gateway.js'

describe('gateway service', () => {
  it('derives a ws:// url from an http:// base url', () => {
    expect(getGatewayInfo('http://localhost:3000').url).toBe(
      'ws://localhost:3000'
    )
  })

  it('derives a wss:// url from an https:// base url', () => {
    expect(getGatewayInfo('https://example.com').url).toBe('wss://example.com')
  })

  it('returns bot info with shards and session_start_limit', () => {
    const info = getGatewayBotInfo('http://localhost:3000')
    expect(info.url).toBe('ws://localhost:3000')
    expect(info.shards).toBe(1)
    expect(info.session_start_limit).toEqual({
      total: 1000,
      remaining: 1000,
      reset_after: 0,
      max_concurrency: 1,
    })
  })
})
