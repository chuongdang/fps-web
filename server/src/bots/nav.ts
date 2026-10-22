// Bot navigation grid (plan 15, B.1): generated automatically from the map colliders with Rapier (raycast / sphere sweep), no hand drawing needed.
// Node = a place one can stand (every standable surface: ground, city wall top, tower top, ramp). Edges: walk, jump (low ledge), drop down (one-way).
import type { LoadedMap, Vec3, MovementConfig } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { addZombieEdges } from './navZombie'

export const NAV_CELL = 1                 // m
const MIN_NORMAL_Y = 0.7                  // standable surface
const WALK_MAX_SLOPE = 0.7                // max dy / horizontal distance of a walk edge (≈35°; the map's ramps are ≈30–33°)
const SURFACE_TOL = 0.2                 // allowed height deviation between the real surface and the straight line joining two nodes
const JUMP_MAX_DY = 0.95                  // max ledge height one can jump up (jumpVelocity 7, g 22 → 1.11m)
const DROP_MAX = 4.5                      // max drop-down height
const SWEEP_R = 0.35                      // radius of the swept sphere (capsule radius 0.4)
const SWEEP_LIFT = 0.5                    // the swept sphere sits this far above the standing surface (avoids catching on small ledges ≤ 0.15m)
const COVER_RAY_H = 1.2                   // a wall must be ≥ 1.2m high to cover a crouching player
const COVER_RAY_LEN = 1.2
const MAX_LAYERS = 8
const STAND_LIFT = 0.12

// Hole/Leap are for zombies only (plan 17, T.4): Hole = crawl (crouch + jump) through an arrow slit; Leap = the E ability, a jump from standing still up to the wall ledge / tower top
export const EdgeKind = { Walk: 0, Jump: 1, Drop: 2, Hole: 3, Leap: 4 } as const
export type EdgeKindValue = (typeof EdgeKind)[keyof typeof EdgeKind]

export const Zone = { Mid: 0, BaseA: 1, BaseB: 2, WallA: 3, WallB: 4, TowerA: 5, TowerB: 6 } as const
export type ZoneId = (typeof Zone)[keyof typeof Zone]

/** 8 directions: index 0 = +X, counter-clockwise seen from above (x, z) */
export const DIRS8: readonly (readonly [number, number])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
].map(([x, z]) => { const l = Math.hypot(x!, z!); return [x! / l, z! / l] as const })

export interface NavEdge {
  to: number; cost: number; kind: EdgeKindValue
  face?: [number, number]   // Hole: point on the wall face on our side (x, z) — the zombie brain times its crouch + jump by the distance to here
}
export interface Waypoint { x: number; y: number; z: number; jump: boolean; kind: EdgeKindValue; face?: [number, number] }
/** Which special edges may be used when pathfinding (default: none of the zombie edges) */
export interface NavAbility { hole?: boolean; leap?: boolean }
const allowed = (e: NavEdge, ab: NavAbility | undefined): boolean => e.kind < EdgeKind.Hole || (e.kind === EdgeKind.Hole ? !!ab?.hole : !!ab?.leap)

export function zoneOf(x: number, y: number, z: number): ZoneId {
  void z
  const ax = Math.abs(x), a = x < 0
  if (y > 3.5 && ax >= 17.5 && ax <= 20.5) return a ? Zone.WallA : Zone.WallB
  if (y > 5 && ax > 12 && ax < 20) return a ? Zone.TowerA : Zone.TowerB
  if (ax >= 19.75) return a ? Zone.BaseA : Zone.BaseB
  return Zone.Mid
}

class MinHeap {
  private keys: number[] = []
  private vals: number[] = []
  get size(): number { return this.keys.length }
  clear(): void { this.keys.length = 0; this.vals.length = 0 }
  push(key: number, val: number): void {
    const k = this.keys, v = this.vals
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p]! <= key) break
      k[i] = k[p]!; v[i] = v[p]!; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): number {
    const k = this.keys, v = this.vals
    const top = v[0]!
    const lk = k.pop()!, lv = v.pop()!
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1]! < k[c]!) c++
        if (k[c]! >= lk) break
        k[i] = k[c]!; v[i] = v[c]!; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

export class NavGrid {
  readonly count: number
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  readonly cover: Uint8Array      // bitmask of the 8 directions with cover (that direction is the side with a wall)
  readonly zone: Uint8Array
  readonly adj: NavEdge[][]
  private readonly cols = new Map<number, number[]>()   // column key (ix, iz) → nodes
  private readonly minX: number
  private readonly minZ: number
  // reusable A* buffers
  private readonly g: Float64Array
  private readonly from: Int32Array
  private readonly stamp: Int32Array
  private readonly closedStamp: Int32Array
  private curStamp = 0
  private readonly heap = new MinHeap()
  readonly coverNodes: number[] = []

  constructor(
    private readonly world: CollisionWorld,
    xs: number[], ys: number[], zs: number[], cover: number[], zones: number[],
    adj: NavEdge[][], minX: number, minZ: number, colKeys: number[],
  ) {
    const n = xs.length
    this.count = n
    this.x = Float32Array.from(xs); this.y = Float32Array.from(ys); this.z = Float32Array.from(zs)
    this.cover = Uint8Array.from(cover); this.zone = Uint8Array.from(zones)
    this.adj = adj
    this.minX = minX; this.minZ = minZ
    for (let i = 0; i < n; i++) {
      const key = colKeys[i]!
      const list = this.cols.get(key)
      if (list) list.push(i); else this.cols.set(key, [i])
      if (cover[i]) this.coverNodes.push(i)
    }
    this.g = new Float64Array(n); this.from = new Int32Array(n); this.stamp = new Int32Array(n); this.closedStamp = new Int32Array(n)
  }

  static colKey(ix: number, iz: number): number { return (ix + 512) * 1024 + (iz + 512) }

  pos(i: number, out: Vec3 = [0, 0, 0]): Vec3 { out[0] = this.x[i]!; out[1] = this.y[i]!; out[2] = this.z[i]!; return out }

  /** Nearest node (same floor preferred: height difference is penalised) within radius `maxDist`; -1 if none */
  nearest(px: number, py: number, pz: number, maxDist = 3): number {
    const ix = Math.floor((px - this.minX) / NAV_CELL), iz = Math.floor((pz - this.minZ) / NAV_CELL)
    const r = Math.ceil(maxDist / NAV_CELL)
    let best = -1, bestD = maxDist * maxDist
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const list = this.cols.get(NavGrid.colKey(ix + dx, iz + dz))
        if (!list) continue
        for (const i of list) {
          const ddx = this.x[i]! - px, ddz = this.z[i]! - pz
          let ddy = this.y[i]! - py
          if (ddy > 1.2) ddy *= 4   // node much higher than the feet: out of reach
          const d = ddx * ddx + ddz * ddz + ddy * ddy
          if (d < bestD) { bestD = d; best = i }
        }
      }
    }
    return best
  }

  /** Every node within r of (px, pz) on the horizontal plane and with height difference ≤ dyMax */
  nodesNear(px: number, py: number, pz: number, r: number, dyMax = 2.5, out: number[] = []): number[] {
    out.length = 0
    const ix = Math.floor((px - this.minX) / NAV_CELL), iz = Math.floor((pz - this.minZ) / NAV_CELL)
    const c = Math.ceil(r / NAV_CELL)
    for (let dx = -c; dx <= c; dx++) {
      for (let dz = -c; dz <= c; dz++) {
        const list = this.cols.get(NavGrid.colKey(ix + dx, iz + dz))
        if (!list) continue
        for (const i of list) {
          if (Math.abs(this.y[i]! - py) > dyMax) continue
          if (Math.hypot(this.x[i]! - px, this.z[i]! - pz) <= r) out.push(i)
        }
      }
    }
    return out
  }

  /**
   * A* between two nodes. `costFn(node)` adds extra cost when stepping into a node (≥ 0), e.g. to avoid enemy line of sight.
   * Returns the list of nodes (both ends included) or null.
   */
  findNodePath(start: number, goal: number, costFn?: (node: number) => number, ability?: NavAbility): number[] | null {
    if (start < 0 || goal < 0) return null
    if (start === goal) return [start]
    const stamp = ++this.curStamp
    const { g, from, heap } = this
    heap.clear()
    const gx = this.x[goal]!, gy = this.y[goal]!, gz = this.z[goal]!
    const h = (i: number) => Math.hypot(this.x[i]! - gx, this.y[i]! - gy, this.z[i]! - gz)
    this.stamp[start] = stamp; g[start] = 0; from[start] = -1
    heap.push(h(start), start)
    const closed = this.closedStamp
    while (heap.size > 0) {
      const cur = heap.pop()
      if (closed[cur] === stamp) continue
      closed[cur] = stamp
      if (cur === goal) {
        const out: number[] = []
        for (let i = goal; i >= 0; i = from[i]!) out.push(i)
        return out.reverse()
      }
      const gc = g[cur]!
      for (const e of this.adj[cur]!) {
        if (closed[e.to] === stamp || !allowed(e, ability)) continue
        const ng = gc + e.cost + (costFn ? costFn(e.to) : 0)
        if (this.stamp[e.to] !== stamp || ng < g[e.to]!) {
          this.stamp[e.to] = stamp; g[e.to] = ng; from[e.to] = cur
          heap.push(ng + h(e.to), e.to)
        }
      }
    }
    return null
  }

  /** Edge a → b (if any) */
  edge(a: number, b: number): NavEdge | undefined {
    for (const e of this.adj[a]!) if (e.to === b) return e
    return undefined
  }

  /**
   * Path from position `from` to position `to` (smoothed by dropping intermediate nodes when a straight walk is possible).
   * Waypoint `jump` = entering it requires a jump (low ledge; a drop-down needs no jump: just step off).
   */
  findPath(from: Vec3, to: Vec3, costFn?: (node: number) => number, ability?: NavAbility): Waypoint[] | null {
    const s = this.nearest(from[0], from[1], from[2]), t = this.nearest(to[0], to[1], to[2])
    const nodes = this.findNodePath(s, t, costFn, ability)
    if (!nodes) return null
    return this.smooth(nodes)
  }

  smooth(nodes: number[]): Waypoint[] {
    const out: Waypoint[] = []
    let i = 0
    // the first node is where we are standing: drop it if more nodes follow
    if (nodes.length > 1) i = 1
    const first = nodes[0]!
    let anchor = first
    while (i < nodes.length) {
      const cur = nodes[i]!
      const prev = nodes[i - 1] ?? anchor
      const e = this.edge(prev, cur)
      const special = !e || e.kind !== EdgeKind.Walk
      if (special) {
        out.push({ x: this.x[cur]!, y: this.y[cur]!, z: this.z[cur]!, jump: e?.kind === EdgeKind.Jump, kind: e?.kind ?? EdgeKind.Walk, ...(e?.face ? { face: e.face } : null) })
        anchor = cur; i++
        continue
      }
      // walking: extend the straight segment to the farthest node still reachable in a straight line over walk edges
      let far = i
      for (let j = i + 1; j < nodes.length; j++) {
        const ej = this.edge(nodes[j - 1]!, nodes[j]!)
        if (!ej || ej.kind !== EdgeKind.Walk) break
        if (!this.straightWalkable(anchor, nodes[j]!)) break
        far = j
      }
      const n = nodes[far]!
      out.push({ x: this.x[n]!, y: this.y[n]!, z: this.z[n]!, jump: false, kind: EdgeKind.Walk })
      anchor = n; i = far + 1
    }
    return out
  }

  private readonly _o: Vec3 = [0, 0, 0]
  private readonly _d: Vec3 = [0, 0, 0]

  /** The straight line a → b is walkable: the swept sphere hits nothing and the floor along the way follows the straight line joining the two nodes */
  straightWalkable(a: number, b: number): boolean {
    const ax = this.x[a]!, ay = this.y[a]!, az = this.z[a]!
    const bx = this.x[b]!, by = this.y[b]!, bz = this.z[b]!
    return walkable(this.world, ax, ay, az, bx, by, bz, this._o, this._d)
  }
}

const DOWN: Vec3 = [0, -1, 0]

function sweepClear(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Vec3, d: Vec3, lift = SWEEP_LIFT): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) return true
  d[0] = dx / len; d[1] = dy / len; d[2] = dz / len
  o[0] = ax; o[1] = ay + lift; o[2] = az
  return world.castSphere(o, d, len, SWEEP_R) === null
}

/**
 * Walk from a to b: the floor along the way follows the straight line joining the two nodes (no ledge/cliff in between), and a sphere swept
 * in short segments close to the real floor hits nothing (the straight line between two nodes may cut into a slope).
 */
function walkable(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Vec3, d: Vec3): boolean {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(2, Math.ceil(len / 0.5))
  let px = ax, py = ay, pz = az
  for (let k = 1; k <= n; k++) {
    const t = k / n
    let qx = bx, qy = by, qz = bz
    if (k < n) {
      qx = ax + (bx - ax) * t; qz = az + (bz - az) * t
      o[0] = qx; o[1] = Math.max(ay, by) + 1.2; o[2] = qz
      const hit = world.castRay(o, DOWN, 6)
      if (!hit) return false
      qy = o[1]! - hit.dist
      if (Math.abs(qy - (ay + (by - ay) * t)) > SURFACE_TOL) return false
    }
    if (!sweepClear(world, px, py, pz, qx, qy, qz, o, d)) return false
    px = qx; py = qy; pz = qz
  }
  return true
}

/** Build the grid for the map. `world` = the map's collision world (any player's), used for static queries only. */
export function buildNav(world: CollisionWorld, map: LoadedMap, cfg: MovementConfig): NavGrid {
  // Extent: enclose the boxes that can be walked on (skip invisible boxes: sky walls)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0
  for (const b of map.boxes) {
    if (b.invisible) continue
    minX = Math.min(minX, b.pos[0] - b.size[0] / 2); maxX = Math.max(maxX, b.pos[0] + b.size[0] / 2)
    minZ = Math.min(minZ, b.pos[2] - b.size[2] / 2); maxZ = Math.max(maxZ, b.pos[2] + b.size[2] / 2)
    maxY = Math.max(maxY, b.pos[1] + b.size[1] / 2)
  }
  for (const r of map.ramps) {
    minX = Math.min(minX, r.from[0], r.to[0]); maxX = Math.max(maxX, r.from[0], r.to[0])
    minZ = Math.min(minZ, r.from[2] - r.width / 2, r.to[2] - r.width / 2); maxZ = Math.max(maxZ, r.from[2] + r.width / 2, r.to[2] + r.width / 2)
    maxY = Math.max(maxY, r.from[1], r.to[1])
  }
  if (map.trimesh) {   // a modelled map: its triangles are the walkable space
    const v = map.trimesh.vertices
    for (let i = 0; i < v.length; i += 3) {
      minX = Math.min(minX, v[i]!); maxX = Math.max(maxX, v[i]!)
      minZ = Math.min(minZ, v[i + 2]!); maxZ = Math.max(maxZ, v[i + 2]!)
      maxY = Math.max(maxY, v[i + 1]!)
    }
  }
  minX = Math.floor(minX); minZ = Math.floor(minZ)
  const nx = Math.ceil(maxX) - minX, nz = Math.ceil(maxZ) - minZ

  const xs: number[] = [], ys: number[] = [], zs: number[] = [], colKeys: number[] = []
  const colNodes: number[][] = new Array(nx * nz)
  const o: Vec3 = [0, 0, 0], d: Vec3 = [0, 0, 0]
  const pos: Vec3 = [0, 0, 0]

  // 1. every standable surface: cast rays downward repeatedly from high up; after each hit continue from just below the hit point
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const px = minX + (ix + 0.5) * NAV_CELL, pz = minZ + (iz + 0.5) * NAV_CELL
      const list: number[] = []
      let startY = maxY + 3
      for (let layer = 0; layer < MAX_LAYERS; layer++) {
        o[0] = px; o[1] = startY; o[2] = pz
        const hit = world.castRay(o, DOWN, startY + 5)
        if (!hit) break
        const y = startY - hit.dist
        startY = y - 0.02
        if (hit.normal[1] < MIN_NORMAL_Y) continue
        pos[0] = px; pos[1] = y + STAND_LIFT; pos[2] = pz   // lift slightly: on a slope the capsule bottom cuts the inclined surface next to the foot
        if (!world.canStand(pos)) continue
        list.push(xs.length)
        xs.push(px); ys.push(y); zs.push(pz); colKeys.push(NavGrid.colKey(ix, iz))
      }
      colNodes[ix * nz + iz] = list
    }
  }
  const n = xs.length

  // 2. edges
  const adj: NavEdge[][] = Array.from({ length: n }, () => [])
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      for (const a of colNodes[ix * nz + iz]!) {
        for (let k = 0; k < 8; k++) {
          const jx = ix + Math.round(DIRS8[k]![0] * (k % 2 === 1 ? Math.SQRT2 : 1)), jz = iz + Math.round(DIRS8[k]![1] * (k % 2 === 1 ? Math.SQRT2 : 1))
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue
          const h = k % 2 === 1 ? Math.SQRT2 : 1
          const ax = xs[a]!, ay = ys[a]!, az = zs[a]!
          let walkTo = -1
          for (const b of colNodes[jx * nz + jz]!) {
            const dy = ys[b]! - ay
            const bx = xs[b]!, bz = zs[b]!
            // walking (both up gentle slopes and down). Walk edges are symmetric: only check the first 4 directions and add both ways (half the queries)
            if (Math.abs(dy) <= WALK_MAX_SLOPE * h) {
              if (k >= 4) {
                if (adj[a]!.some(e => e.to === b && e.kind === EdgeKind.Walk)) { walkTo = b; continue }   // already added from b's side
              } else if (walkable(world, ax, ay, az, bx, ys[b]!, bz, o, d)) {
                const len = Math.hypot(h, dy)
                adj[a]!.push({ to: b, cost: len * (dy < -0.3 ? 1.1 : 1), kind: EdgeKind.Walk })
                adj[b]!.push({ to: a, cost: len * (dy > 0.3 ? 1.1 : 1), kind: EdgeKind.Walk })
                walkTo = b
                continue
              }
            }
            // jump up onto a low ledge/box (only the 4 main directions, to avoid cutting corners)
            if (k % 2 === 0 && dy > 0.3 && dy <= JUMP_MAX_DY && sweepClear(world, ax, ay + dy, az, bx, ys[b]!, bz, o, d)) {
              // the step-up spot: the vertical column from a up to b's height must be clear
              o[0] = ax; o[1] = ay + 0.2; o[2] = az; d[0] = 0; d[1] = 1; d[2] = 0
              if (!world.castSphere(o, d, dy + 0.4, SWEEP_R)) {
                adj[a]!.push({ to: b, cost: h + 1.5 + dy, kind: EdgeKind.Jump })
              }
              continue
            }
          }
          // over a low ledge (e.g. a wall gap with a 0.5m concrete lip): jump across to a node on the same level
          if (k % 2 === 0) {
            for (const b of colNodes[jx * nz + jz]!) {
              const dy = ys[b]! - ay
              if (Math.abs(dy) > 0.3 || adj[a]!.some(e => e.to === b)) continue
              if (!sweepClear(world, ax, ay + 1.2, az, xs[b]!, ys[b]! + 1.2, zs[b]!, o, d, 0)) continue
              // the ledge in the middle must be low (≤ JUMP_MAX_DY)
              o[0] = (ax + xs[b]!) / 2; o[1] = ay + 1.6; o[2] = (az + zs[b]!) / 2
              const hit = world.castRay(o, DOWN, 3)
              if (hit && o[1]! - hit.dist - ay <= JUMP_MAX_DY && o[1]! - hit.dist - ay > 0.2) {
                adj[a]!.push({ to: b, cost: h + 2, kind: EdgeKind.Jump })
              }
            }
          }
          // one-way drop from an edge: a much lower node in the adjacent column, with a clear path off the edge and a clear fall column
          for (const b of colNodes[jx * nz + jz]!) {
            const drop = ay - ys[b]!
            if (drop <= WALK_MAX_SLOPE * h + 0.05 || drop > DROP_MAX) continue
            if (walkTo >= 0 && colNodes[jx * nz + jz]!.includes(walkTo) && Math.abs(ys[walkTo]! - ay) < 1) continue
            if (adj[a]!.some(e => e.to === b)) continue
            const bx = xs[b]!, bz = zs[b]!
            if (!sweepClear(world, ax, ay, az, bx, ay, bz, o, d)) continue          // off the edge
            o[0] = bx; o[1] = ay + 0.5; o[2] = bz
            const down = world.castRay(o, DOWN, drop + 1)
            if (!down || Math.abs(o[1]! - down.dist - ys[b]!) > 0.1) continue         // clear fall column, lands exactly on node b
            adj[a]!.push({ to: b, cost: h + 1.5 + drop, kind: EdgeKind.Drop })
          }
        }
      }
    }
  }

  // 3. cover points + zones
  const cover: number[] = new Array(n).fill(0)
  const zones: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    zones[i] = zoneOf(xs[i]!, ys[i]!, zs[i]!)
    let mask = 0
    for (let k = 0; k < 8; k++) {
      o[0] = xs[i]!; o[1] = ys[i]! + COVER_RAY_H; o[2] = zs[i]!
      d[0] = DIRS8[k]![0]; d[1] = 0; d[2] = DIRS8[k]![1]
      if (world.castRay(o, d, COVER_RAY_LEN)) mask |= 1 << k
    }
    cover[i] = mask
  }
  addZombieEdges({ world, xs, ys, zs, adj, colNodes, minX, minZ, nx, nz, gravity: cfg.gravity })
  return new NavGrid(world, xs, ys, zs, cover, zones, adj, minX, minZ, colKeys)
}
