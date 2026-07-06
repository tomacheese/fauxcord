/**
 * Soundboard operations service
 *
 * Fauxcord does not model any soundboard sound data (no upload/storage
 * pipeline for the underlying audio), so this always returns an empty
 * result. This still satisfies the spec's response shape and unblocks
 * clients that call the endpoint unconditionally as part of their startup
 * sequence (see the Pycord Gateway compat finding referenced from
 * `.superpowers/sdd/decisions.md`).
 */

// Used for compile-time type drift detection.
import type { RESTGetAPISoundboardDefaultSoundsResult } from 'discord-api-types/v10'

/**
 * Returns the list of default soundboard sounds for GET /soundboard-default-sounds.
 * @returns An empty array (Fauxcord has no default soundboard sound data)
 */
export function getDefaultSoundboardSounds(): RESTGetAPISoundboardDefaultSoundsResult {
  return []
}
