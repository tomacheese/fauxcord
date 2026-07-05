/**
 * 指定した Intent ビットが intents フィールドに含まれるか判定する。
 * @param intents - Identify で受け取った intents ビットフィールド
 * @param bit - 判定対象の Intent ビット（GatewayIntentBits の値）
 * @returns ビットが立っていれば true
 */
export function hasIntent(intents: number, bit: number): boolean {
  return (intents & bit) === bit
}
