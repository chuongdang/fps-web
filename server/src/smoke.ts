import { SMOKE, smokeRadiusAt, type Vec3 } from '@fps/shared'
import type { Room } from './room'

// Smoke cloud from a smoke grenade (like CS 1.6): blocks vision but bullets still pass through. The server only keeps it so bots cannot see through it;
// the client draws it itself from GrenadeExplode(kind 'smoke') and uses the same smokeRadiusAt, so both sides match.
export interface RoomSmoke {
  id: number
  pos: Vec3          // centre already raised by SMOKE.centerLift
  startMs: number    // room.serverNow at deployment
}

export function addSmoke(room: Room, id: number, at: Vec3): void {
  room.smokes.push({ id, pos: [at[0], at[1] + SMOKE.centerLift, at[2]], startMs: room.serverNow })
}

/** Drop expired smoke clouds (called every tick; the array is almost always empty) */
export function pruneSmokes(room: Room): void {
  for (let i = room.smokes.length - 1; i >= 0; i--) {
    if (room.serverNow - room.smokes[i]!.startMs >= SMOKE.durationMs) room.smokes.splice(i, 1)
  }
}

/** Whether the segment a->b passes through any smoke cloud (distance from the centre to the segment < current radius) */
export function smokeBlocks(room: Room, a: Vec3, b: Vec3): boolean {
  if (room.smokes.length === 0) return false
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2]
  const len2 = abx * abx + aby * aby + abz * abz
  for (const s of room.smokes) {
    const r = smokeRadiusAt(room.serverNow - s.startMs)
    if (r <= 0) continue
    const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((s.pos[0] - a[0]) * abx + (s.pos[1] - a[1]) * aby + (s.pos[2] - a[2]) * abz) / len2))
    const dx = a[0] + abx * t - s.pos[0], dy = a[1] + aby * t - s.pos[1], dz = a[2] + abz * t - s.pos[2]
    if (dx * dx + dy * dy + dz * dz < r * r) return true
  }
  return false
}
