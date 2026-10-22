import type { PlayerState, MovementConfig } from './movement'

export interface HitBox {
  min: [number, number, number]
  max: [number, number, number]
  part: 'head' | 'body' | 'legs'
}

// AABB sizes (not rotated by yaw — deliberate, keeps netcode simple)
const WIDE_HALF  = 0.30   // half 0.6m cho legs/body
const HEAD_HALF  = 0.175  // half 0.35m cho head
const DEPTH_HALF = 0.15   // 0.3m front/back

// `size` = scale factor (big zombies: boss 2.2): scales every box dimension around the feet
export function hitboxesFor(state: PlayerState, cfg: MovementConfig, size = 1): HitBox[] {
  const [x, y, z] = state.pos
  const scale  = (state.crouching ? cfg.crouchHeight / cfg.standHeight : 1) * size
  const legTop  = y + 0.80 * scale
  const bodyTop = y + 1.45 * scale
  const headTop = y + cfg.standHeight * scale  // = crouchHeight when crouching
  const wide = WIDE_HALF * size, head = HEAD_HALF * size, depth = DEPTH_HALF * size

  return [
    { min: [x - wide,  y,       z - depth], max: [x + wide,  legTop,   z + depth], part: 'legs' },
    { min: [x - wide,  legTop,  z - depth], max: [x + wide,  bodyTop,  z + depth], part: 'body' },
    { min: [x - head,  bodyTop, z - depth], max: [x + head,  headTop,  z + depth], part: 'head' },
  ]
}

// Slab test for ray-AABB. Returns the distance, or null if no hit.
// Returns 0 if the origin is inside the box.
export function rayAabb(
  origin: [number, number, number],
  dir: [number, number, number],
  box: HitBox,
  maxDist: number,
): number | null {
  let tMin = 0
  let tMax = maxDist

  for (let i = 0; i < 3; i++) {
    const d = dir[i]!
    if (Math.abs(d) < 1e-9) {
      // Ray parallel to the slab planes — check whether the origin is inside the slab
      if (origin[i]! < box.min[i]! || origin[i]! > box.max[i]!) return null
    } else {
      const invD = 1 / d
      let t0 = (box.min[i]! - origin[i]!) * invD
      let t1 = (box.max[i]! - origin[i]!) * invD
      if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp }
      tMin = Math.max(tMin, t0)
      tMax = Math.min(tMax, t1)
      if (tMax < tMin) return null
    }
  }

  return tMin
}

// Compute the fire direction from yaw/pitch (per project convention)
// dir = (−sin(yaw)·cos(pitch), sin(pitch), −cos(yaw)·cos(pitch))
export function shootDir(
  yaw: number,
  pitch: number,
): [number, number, number] {
  const cp = Math.cos(pitch)
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]
}
