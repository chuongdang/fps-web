import type { TeamId } from '../teams'
import type { LoadedMap } from './types'

/**
 * Whether the player's feet are inside their own team's buy zone. Team A is at base A unless sides were swapped (sideSwapped).
 * `pos` = feet position. A map with no buy zones declared → false.
 */
export function inBuyZone(map: Pick<LoadedMap, 'buyZones'>, team: TeamId, sideSwapped: boolean, pos: readonly number[]): boolean {
  const side = (team === 'A') !== sideSwapped ? 'A' : 'B'
  const z = map.buyZones[side]
  if (!z) return false
  return pos[0]! >= z.min[0] && pos[0]! <= z.max[0] &&
         pos[1]! >= z.min[1] && pos[1]! <= z.max[1] &&
         pos[2]! >= z.min[2] && pos[2]! <= z.max[2]
}
