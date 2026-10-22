import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadMap, defaultMovement, inBuyZone, stepMovement, Btn, DT, FALL_DAMAGE, type PlayerState } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { MAPS } from '../../assets/maps'
import { buildNav, type NavGrid } from './bots/nav'
import { readGlbTriangles } from '../../scripts/glb-collision.mjs'
import { navRoute, walkHop, walkRoute } from './walkAudit'

const map = loadMap(MAPS.dust2!)
let world: CollisionWorld, nav: NavGrid, buildMs = 0

beforeAll(async () => {
  world = await createWorld(map)
  const t0 = performance.now()
  nav = buildNav(world, map, defaultMovement)
  buildMs = performance.now() - t0
})

const EYE = 1.6
const eye = (p: readonly number[]): [number, number, number] => [p[0]!, p[1]! + EYE, p[2]!]
function seesEachOther(a: readonly number[], b: readonly number[]): boolean {
  const from = eye(a), to = eye(b)
  const d: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const len = Math.hypot(d[0], d[1], d[2])
  return world.castRay(from, [d[0] / len, d[1] / len, d[2] / len], len) === null
}

describe('dust2 (modelled map: glb drawn, triangles as collision)', () => {
  it('the collision is made from the glb the client draws (rerun assets/source/maps/dust2.mjs after changing the glb)', () => {
    const glb = readGlbTriangles(fileURLToPath(new URL('../../client/public/maps/dust2.glb', import.meta.url)))
    expect(map.model).toBe('/maps/dust2.glb')
    expect(map.trimesh!.indices.length).toBe(glb.indices.length)
    expect(map.trimesh!.vertices.length).toBe(glb.vertices.length)
    expect(Math.min(...map.trimesh!.vertices.filter((_, i) => i % 3 === 1))).toBeCloseTo(glb.min[1]!, 2)
  })

  it('has 8 spawns per team, team A on the CT side (-x) and team B on the T side (+x)', () => {
    expect(map.spawns.A).toHaveLength(8)
    expect(map.spawns.B).toHaveLength(8)
    for (const s of map.spawns.A) expect(s.pos[0]).toBeLessThan(-25)
    for (const s of map.spawns.B) expect(s.pos[0]).toBeGreaterThan(35)
  })

  it('every spawn is inside its own team buy zone, and the swapped side uses the other zone', () => {
    for (const s of map.spawns.A) {
      expect(inBuyZone(map, 'A', false, s.pos)).toBe(true)
      expect(inBuyZone(map, 'A', true, s.pos)).toBe(false)
    }
    for (const s of map.spawns.B) {
      expect(inBuyZone(map, 'B', false, s.pos)).toBe(true)
      expect(inBuyZone(map, 'B', true, s.pos)).toBe(false)
    }
  })

  it('every spawn has room to stand and a floor just below it (not inside a wall, not over a hole)', () => {
    for (const s of [...map.spawns.A, ...map.spawns.B]) {
      const feet: [number, number, number] = [s.pos[0], s.pos[1], s.pos[2]]
      expect(world.canStand(feet), `spawn at ${feet}`).toBe(true)
      const floor = world.castRay([feet[0], feet[1] + 0.5, feet[2]], [0, -1, 0], 1.5)
      expect(floor, `floor under ${feet}`).not.toBeNull()
      expect(floor!.normal[1], `floor under ${feet} is flat enough to stand on`).toBeGreaterThan(0.9)
    }
  })

  it('spawns face the middle of the map', () => {
    for (const s of map.spawns.A) expect(Math.sin(s.yaw)).toBeLessThan(0)   // forward.x = -sin(yaw) > 0
    for (const s of map.spawns.B) expect(Math.sin(s.yaw)).toBeGreaterThan(0)
  })

  it('no spawn sees an enemy spawn', () => {
    for (const a of map.spawns.A) for (const b of map.spawns.B) expect(seesEachOther(a.pos, b.pos)).toBe(false)
  })

  it('a bullet is stopped by a wall of the model and by its floor (the triangles are solid for rays)', () => {
    const a = map.spawns.A[0]!.pos
    expect(world.castRay([a[0], a[1] + 0.5, a[2]], [0, -1, 0], 3)).not.toBeNull()
    expect(world.castRay([a[0], a[1] + 1, a[2]], [-1, 0, 0], 40), 'the CT side ends at a wall within 40 m').not.toBeNull()
  })

  // Stairs of the model (risers 0.4-0.8 m): [name, start feet position, direction x/z, metres the player must climb]. Walked WITHOUT jumping.
  const STAIRS = [
    ['mid to the A ramp stairs (z = -16, going west)', [-10.5, 4.8, -16], [-1, 0], 2.3],
    ['stairs at z = 18, going east', [-9, 2.0, 18], [1, 0], 1.1],
  ] as const
  const walkForward = (w: CollisionWorld, from: readonly number[], dir: readonly number[], seconds: number) => {
    let st: PlayerState = { pos: [from[0]!, from[1]! + 0.02, from[2]!], vel: [0, 0, 0], yaw: Math.atan2(-dir[0]!, -dir[1]!), pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 }
    let maxY = st.pos[1], minVy = 0
    for (let t = 0; t < seconds / DT; t++) {
      st = stepMovement(st, { seq: t, buttons: Btn.Forward, yaw: st.yaw, pitch: 0, weapon: 0 }, w, defaultMovement, DT)
      maxY = Math.max(maxY, st.pos[1]); minVy = Math.min(minVy, st.vel[1])
    }
    return { end: st.pos, climbed: maxY - from[1]!, minVy }
  }

  it.each(STAIRS)('the player walks up the stairs without jumping: %s', (_name, from, dir, climb) => {
    expect(walkForward(world, from, dir, 4).climbed).toBeGreaterThanOrEqual(climb)
  })

  it('the player walks down those stairs without falling hard (no fall damage on a flight of steps)', () => {
    const up = walkForward(world, STAIRS[0][1], STAIRS[0][2], 4)
    const down = walkForward(world, [up.end[0], up.end[1] - 0.02, up.end[2]], [-STAIRS[0][2][0], -STAIRS[0][2][1]], 4)
    expect(down.end[1]).toBeLessThan(up.end[1] - 2)
    expect(-down.minVy).toBeLessThan(FALL_DAMAGE.safeSpeed)
  })

  it('without stepHeight the same stairs stop the player (so the setting is what makes them climbable)', async () => {
    const plain = await createWorld({ ...map, stepHeight: undefined })
    expect(walkForward(plain, STAIRS[0][1], STAIRS[0][2], 4).climbed).toBeLessThan(0.1)
    plain.dispose()
  })

  it('the nav grid builds in a reasonable time', () => {
    console.log(`dust2 nav: ${nav.count} nodes, ${buildMs.toFixed(0)}ms`)
    expect(nav.count).toBeGreaterThan(3000)
    expect(buildMs).toBeLessThan(15000)
  })

  // key places [x, y(feet), z], read off the model (the map has several floors: T plateau 8 m, A site 7.2 m, CT / B site about 5 m, mid 1.6-2.7 m)
  const PLACES: Record<string, [number, number, number]> = {
    'B site': [-37, 4.8, 34],
    'mid (west end)': [-15, 1.6, 2],
    'mid (middle)': [0, 2.5, 2],
    'mid (east end)': [12, 4.8, 2],
    'long A (north lane)': [5, 4.8, -45],
    'long A (east lane)': [45, 5.4, -5],
    'CT ramp': [-34, 4.8, 20],
    'foot of the A ramp': [-29, 4.8, -44],
  }
  const node = (p: [number, number, number]) => nav.nearest(p[0], p[1], p[2], 1.5)

  it.each(Object.keys(PLACES))('%s has nav nodes', name => {
    expect(node(PLACES[name]!)).toBeGreaterThanOrEqual(0)
  })

  it.each(Object.keys(PLACES))('%s is reachable on foot from both spawns', name => {
    const target = node(PLACES[name]!)
    for (const team of ['A', 'B'] as const) {
      const sp = map.spawns[team][0]!.pos
      const from = nav.nearest(sp[0], sp[1], sp[2])
      expect(from).toBeGreaterThanOrEqual(0)
      expect(nav.findNodePath(from, target), `${team} spawn -> ${name}`).not.toBeNull()
    }
  })

  // The nav grid only says where a bot may go: these walk the routes with the game's real movement code (walkAudit.ts)
  const A0 = map.spawns.A[0]!.pos, B0 = map.spawns.B[0]!.pos
  it.each([
    ['CT spawn -> T spawn', A0, B0],
    ['CT spawn -> B site', A0, PLACES['B site']!],
    ['CT spawn -> mid (east end)', A0, PLACES['mid (east end)']!],
    ['CT spawn -> long A (east lane)', A0, PLACES['long A (east lane)']!],
    ['CT spawn -> long A (north lane)', A0, PLACES['long A (north lane)']!],
    ['CT spawn -> foot of the A ramp', A0, PLACES['foot of the A ramp']!],
    ['T spawn -> B site', B0, PLACES['B site']!],
    ['T spawn -> CT spawn', B0, A0],
  ] as const)('a player can walk %s', (_name, from, to) => {
    const route = navRoute(nav, from, to)
    expect(route).not.toBeNull()
    expect(walkRoute(world, route!)).toEqual([])
  })

  // The A site is up a long ramp (4.8 m -> 8 m, west along the north wall) to a plateau, then a 0.8 m step down onto the site platform.
  // The nav grid does not link the ramp to the plateau (a seam in the model), but a player walks it, so it is checked by walking.
  it('the A site can be walked to: up the ramp, along the plateau, onto the platform', () => {
    const route: [number, number, number][] = [[-29, 4.8, -44], [-42, 7.9, -44], [-46, 8.0, -44], [-46, 8.0, -37], [-38, 7.2, -37]]
    expect(walkRoute(world, route, 8)).toEqual([])
  })

  it('a player cannot walk straight up the 1.4 m ledge under the A site (the walk check is not letting everything through)', () => {
    expect(walkHop(world, [-30.5, 5.02, -42.5], [-33.5, 7.2, -38.5])).toBe(false)
  })

  it('both teams have more than one way across: banning mid still leaves a route', () => {
    const inMid = (i: number) => nav.z[i]! > -1 && nav.z[i]! < 6 && nav.x[i]! > -26 && nav.x[i]! < 20
    const path = nav.findNodePath(nav.nearest(A0[0], A0[1], A0[2]), nav.nearest(B0[0], B0[1], B0[2]), i => (inMid(i) ? 1e6 : 0))!
    expect(path).not.toBeNull()
    expect(path.some(inMid)).toBe(false)
  })
})
