/**
 * Checks whether the given Intent bit is set in the intents field.
 * @param intents - The intents bitfield received in IDENTIFY
 * @param bit - The Intent bit to check (a GatewayIntentBits value)
 * @returns true if the bit is set
 */
export function hasIntent(intents: number, bit: number): boolean {
  return (intents & bit) === bit
}
