/**
 * Discord互換のSnowflake ID生成モジュール
 *
 * Discord Epoch (2015-01-01T00:00:00.000Z) からのミリ秒を使った
 * 64bit整数IDを生成します。
 */

/** Discord Epoch: 2015-01-01T00:00:00.000Z */
const DISCORD_EPOCH = 1_420_070_400_000n
const WORKER_ID = 1n
const PROCESS_ID = 1n

/** インクリメントカウンター（同一ミリ秒内で一意性を保つため） */
let increment = 0n
/** 前回 Snowflake を生成したタイムスタンプ */
let lastTimestamp = -1n

/**
 * Discord互換のSnowflake IDを生成します。
 *
 * 同一ミリ秒内での呼び出しが 4096 回を超えた場合は次のミリ秒まで待機します。
 * @returns Snowflake IDの文字列表現
 */
export function generateSnowflake(): string {
  let timestamp = BigInt(Date.now()) - DISCORD_EPOCH

  if (timestamp === lastTimestamp) {
    increment = (increment + 1n) & 0xf_ffn
    // 同一ミリ秒内のカウンターが溢れた場合は次のミリ秒まで待つ
    if (increment === 0n) {
      while (BigInt(Date.now()) - DISCORD_EPOCH <= lastTimestamp) {
        // スピンウェイト（実運用では数マイクロ秒以内）
      }
      timestamp = BigInt(Date.now()) - DISCORD_EPOCH
    }
  } else {
    increment = 0n
  }

  lastTimestamp = timestamp

  const id =
    (timestamp << 22n) | (WORKER_ID << 17n) | (PROCESS_ID << 12n) | increment

  return id.toString()
}

/**
 * Snowflake IDからタイムスタンプを復元します。
 * @param snowflake - Snowflake IDの文字列
 * @returns タイムスタンプのDateオブジェクト
 */
export function snowflakeToTimestamp(snowflake: string): Date {
  const id = BigInt(snowflake)
  const timestamp = (id >> 22n) + DISCORD_EPOCH
  return new Date(Number(timestamp))
}
