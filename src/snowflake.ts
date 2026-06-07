/**
 * Discord互換のSnowflake ID生成モジュール
 *
 * Discord Epoch (2015-01-01T00:00:00.000Z) からのミリ秒を使った
 * 64bit整数IDを生成します。
 */

/** Discord Epoch: 2015-01-01T00:00:00.000Z */
const DISCORD_EPOCH = 1420070400000n;
const WORKER_ID = 1n;
const PROCESS_ID = 1n;

/** インクリメントカウンター */
let increment = 0n;

/**
 * Discord互換のSnowflake IDを生成します。
 * @returns Snowflake IDの文字列表現
 */
export function generateSnowflake(): string {
  const timestamp = BigInt(Date.now()) - DISCORD_EPOCH;
  const id =
    (timestamp << 22n) |
    (WORKER_ID << 17n) |
    (PROCESS_ID << 12n) |
    (increment & 0xfffn);

  increment++;
  return id.toString();
}

/**
 * Snowflake IDからタイムスタンプを復元します。
 * @param snowflake - Snowflake IDの文字列
 * @returns タイムスタンプのDateオブジェクト
 */
export function snowflakeToTimestamp(snowflake: string): Date {
  const id = BigInt(snowflake);
  const timestamp = (id >> 22n) + DISCORD_EPOCH;
  return new Date(Number(timestamp));
}
