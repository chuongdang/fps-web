// Test helper: can a real player walk a route? Drives the game's own movement code (stepMovement: slopes, gravity, jumping, collision) from one
// point to the next, jumping only when it is stuck. The nav grid only says where a bot may go; this says where a human can. Used by the map tests
// (a map made from a 3D model is not authored for physics, so every route that matters is walked once).
import { Btn, DT, defaultMovement, stepMovement, type PlayerState } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import type { NavGrid } from './bots/nav'

type P3 = readonly [number, number, number] | readonly number[]
const ARRIVE_H = 0.7   // m, horizontal
const ARRIVE_V = 0.6   // m, vertical

/** Walk from `a` (feet position, standing on the floor) toward `b` in a straight line; true if we get within reach of `b` before `maxSec` */
export function walkHop(world: CollisionWorld, a: P3, b: P3, maxSec = 3): boolean {
  let st: PlayerState = { pos: [a[0]!, a[1]! + 0.02, a[2]!], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 }
  const yaw = Math.atan2(-(b[0]! - a[0]!), -(b[2]! - a[2]!))   // forward = (-sin yaw, -cos yaw)
  for (let t = 0; t < maxSec / DT; t++) {
    const stuck = st.grounded && t > 12 && Math.hypot(st.vel[0], st.vel[2]) < 1.0
    st = stepMovement(st, { seq: t, buttons: Btn.Forward | (stuck ? Btn.Jump : 0), yaw, pitch: 0, weapon: 0 }, world, defaultMovement, DT)
    if (Math.hypot(b[0]! - st.pos[0], b[2]! - st.pos[2]) < ARRIVE_H && Math.abs(b[1]! - st.pos[1]) < ARRIVE_V) return true
  }
  return false
}

/** Walk a list of points one hop after the other; returns the hops that failed (empty = the whole route is walkable) */
export function walkRoute(world: CollisionWorld, points: readonly P3[], maxSecPerHop = 3): string[] {
  const failed: string[] = []
  for (let i = 1; i < points.length; i++) {
    if (!walkHop(world, points[i - 1]!, points[i]!, maxSecPerHop)) failed.push(`${fmt(points[i - 1]!)} -> ${fmt(points[i]!)}`)
  }
  return failed
}

/** The nav route (walk / jump / drop edges only) between two places as points; null if the nav has none. Drops are skipped by the walk (gravity does them). */
export function navRoute(nav: NavGrid, from: P3, to: P3): [number, number, number][] | null {
  const path = nav.findNodePath(nav.nearest(from[0]!, from[1]!, from[2]!), nav.nearest(to[0]!, to[1]!, to[2]!))
  return path ? path.map(i => [nav.x[i]!, nav.y[i]!, nav.z[i]!]) : null
}

const fmt = (p: P3): string => `(${p.map(v => v.toFixed(1)).join(', ')})`
