/**
 * 人工遅延ミドルウェア
 *
 * LATENCY_MS環境変数で指定した時間だけ全レスポンスを遅延させます。
 * 実際のDiscord APIのレイテンシをシミュレートする際に使用します。
 */

import { setTimeout as sleep } from 'node:timers/promises'
import type { Context, Next } from 'hono'

/**
 * 指定ミリ秒の人工遅延を付与するミドルウェアを作成します。
 * @param latencyMs - 遅延時間（ミリ秒）。0以下の場合は遅延なし
 * @returns ミドルウェア関数
 */
export const createLatencyMiddleware =
  (latencyMs: number) =>
  async (_c: Context, next: Next): Promise<void> => {
    if (latencyMs > 0) {
      await sleep(latencyMs)
    }
    await next()
  }
