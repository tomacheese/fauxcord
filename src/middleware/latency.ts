/**
 * Artificial latency middleware
 *
 * Delays all responses by the duration specified in the LATENCY_MS environment variable.
 * Used to simulate the latency of the real Discord API.
 */

import { setTimeout as sleep } from 'node:timers/promises'
import type { Context, Next } from 'hono'

/**
 * Creates a middleware that adds an artificial delay of the given milliseconds.
 * @param latencyMs - Delay duration (ms). No delay if 0 or less
 * @returns Middleware function
 */
export const createLatencyMiddleware =
  (latencyMs: number) =>
  async (_c: Context, next: Next): Promise<void> => {
    if (latencyMs > 0) {
      await sleep(latencyMs)
    }
    await next()
  }
