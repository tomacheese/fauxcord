import { describe, it, expect, beforeEach } from "vitest";
import { generateSnowflake, snowflakeToTimestamp } from "./snowflake.js";

describe("generateSnowflake", () => {
  it("文字列を返すこと", () => {
    const id = generateSnowflake();
    expect(typeof id).toBe("string");
  });

  it("数字のみで構成されること", () => {
    const id = generateSnowflake();
    expect(/^\d+$/.test(id)).toBe(true);
  });

  it("連続して呼び出すと異なるIDが生成されること", () => {
    const ids = Array.from({ length: 10 }, () => generateSnowflake());
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });

  it("IDが単調増加すること", () => {
    const ids = Array.from({ length: 5 }, () => generateSnowflake());
    for (let i = 1; i < ids.length; i++) {
      expect(BigInt(ids[i])).toBeGreaterThan(BigInt(ids[i - 1]));
    }
  });

  it("Discord Epoch (2015-01-01) 以降のタイムスタンプを含むこと", () => {
    const DISCORD_EPOCH = 1420070400000n;
    const id = BigInt(generateSnowflake());
    const timestamp = (id >> 22n) + DISCORD_EPOCH;
    expect(timestamp).toBeGreaterThan(DISCORD_EPOCH);
  });
});

describe("snowflakeToTimestamp", () => {
  it("SnowflakeIDからDateオブジェクトを返すこと", () => {
    const id = generateSnowflake();
    const date = snowflakeToTimestamp(id);
    expect(date).toBeInstanceOf(Date);
  });

  it("現在時刻に近いタイムスタンプを返すこと", () => {
    const before = Date.now();
    const id = generateSnowflake();
    const after = Date.now();
    const ts = snowflakeToTimestamp(id).getTime();
    // 1秒のマージンを持たせる
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });
});
