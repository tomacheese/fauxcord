/**
 * Discord-compatible Snowflake ID generation module
 *
 * Generates 64-bit integer IDs based on milliseconds since
 * the Discord Epoch (2015-01-01T00:00:00.000Z).
 */

/** Discord Epoch: 2015-01-01T00:00:00.000Z */
const DISCORD_EPOCH = 1_420_070_400_000n
const WORKER_ID = 1n
const PROCESS_ID = 1n

/**
 * Mutable generator state, held in a single object so `generateSnowflake`
 * mutates its properties rather than reassigning top-level bindings.
 */
const state = {
  /** Increment counter (to keep uniqueness within the same millisecond) */
  increment: 0n,
  /** Timestamp of the last generated Snowflake */
  lastTimestamp: -1n,
}

/**
 * Generates a Discord-compatible Snowflake ID.
 *
 * If more than 4096 calls occur within the same millisecond, waits until the next millisecond.
 * @returns String representation of the Snowflake ID
 */
export function generateSnowflake(): string {
  let timestamp = BigInt(Date.now()) - DISCORD_EPOCH

  if (timestamp === state.lastTimestamp) {
    state.increment = (state.increment + 1n) & 0xf_ffn
    // If the counter overflows within the same millisecond, wait until the next millisecond
    if (state.increment === 0n) {
      while (BigInt(Date.now()) - DISCORD_EPOCH <= state.lastTimestamp) {
        // Busy-wait until the clock advances to the next millisecond.
        // Blocks for up to ~1ms in the worst case (see the jsdoc above for
        // when this triggers).
      }
      timestamp = BigInt(Date.now()) - DISCORD_EPOCH
    }
  } else {
    state.increment = 0n
  }

  state.lastTimestamp = timestamp

  const id =
    (timestamp << 22n) |
    (WORKER_ID << 17n) |
    (PROCESS_ID << 12n) |
    state.increment

  return id.toString()
}

/**
 * Restores the timestamp from a Snowflake ID.
 * @param snowflake - Snowflake ID string
 * @returns Date object of the timestamp
 */
export function snowflakeToTimestamp(snowflake: string): Date {
  const id = BigInt(snowflake)
  const timestamp = (id >> 22n) + DISCORD_EPOCH
  return new Date(Number(timestamp))
}
