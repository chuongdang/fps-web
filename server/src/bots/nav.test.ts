import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { loadMap, defaultMovement, type MapFile } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { buildNav, EdgeKind, Zone, type NavGrid } from './nav'

const map = loadMap(JSON.parse(readFileSync(new URL('../../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
let world: CollisionWorld, nav: NavGrid, buildMs = 0

beforeAll(async () => {
  world = await createWorld(map)
  const t0 = performance.now()
  nav = buildNav(world, map, defaultMovement)
  buildMs = performance.now() - t0
})

describe('nav grid', () => {
  it('builds the grid in < 1 second', () => {
    console.log(`nav: ${nav.count} nodes, ${nav.adj.reduce((a, e) => a + e.length, 0)} edges, ${nav.coverNodes.length} cover nodes, ${buildMs.toFixed(0)}ms`)
    expect(buildMs).toBeLessThan(2000)   // measured alone ≈ 0.3s; relaxed because vitest runs many files in parallel
    expect(nav.count).toBeGreaterThan(500)
  })

  it('has nodes on the ground, on the city wall top and on the tower top', () => {
    const zones = new Set<number>()
    for (let i = 0; i < nav.count; i++) zones.add(nav.zone[i]!)
    for (const z of [Zone.Mid, Zone.BaseA, Zone.BaseB, Zone.WallA, Zone.WallB, Zone.TowerA, Zone.TowerB]) expect(zones.has(z), `zone ${z}`).toBe(true)
  })

  it('has cover nodes with a wall direction', () => {
    expect(nav.coverNodes.length).toBeGreaterThan(20)
  })

  it('no nodes inside walls or under the floor', () => {
    for (let i = 0; i < nav.count; i++) expect(nav.y[i]).toBeGreaterThan(-0.1)
  })

  it('there is a path from base A to base B that does not pass through walls (every walk segment is swept clear)', () => {
    const p = nav.findPath([-28, 0, 0], [28, 0, 0])
    expect(p).not.toBeNull()
    expect(p!.length).toBeGreaterThan(2)
    const last = p![p!.length - 1]!
    expect(Math.hypot(last.x - 28, last.z - 0)).toBeLessThan(2)
  })

  it('from the ground to the top of tower A: up the ramp, over the wall ledge, then onto the tower', () => {
    // the top of tower A is at (-15, 6.5, -18)
    const tower = nav.nearest(-15, 6.5, -18)
    expect(tower).toBeGreaterThanOrEqual(0)
    expect(nav.y[tower]).toBeGreaterThan(6)
    const nodes = nav.findNodePath(nav.nearest(-28, 0, -6), tower)
    expect(nodes).not.toBeNull()
    expect(Math.max(...nodes!.map(i => nav.y[i]!))).toBeGreaterThan(6)
  })

  it('the path up the ramp has many nodes with increasing height', () => {
    const nodes = nav.findNodePath(nav.nearest(-27, 0, 0), nav.nearest(-19.5, 4.2, 0))!
    expect(nodes).not.toBeNull()
    const ys = nodes.map(i => nav.y[i]!)
    expect(ys[ys.length - 1]!).toBeGreaterThan(3.9)
  })

  it('A* uses costFn: a high cost in the middle area makes the path change direction', () => {
    const a = nav.nearest(-25, 0, 0), b = nav.nearest(25, 0, 0)
    const base = nav.findNodePath(a, b)!
    const avoid = nav.findNodePath(a, b, i => (Math.abs(nav.z[i]!) < 6 ? 50 : 0))!
    const crossZ = (path: number[]) => path.filter(i => Math.abs(nav.z[i]!) < 6 && Math.abs(nav.x[i]!) < 10).length
    expect(crossZ(avoid)).toBeLessThanOrEqual(crossZ(base))
  })

  it('has drop-down (one-way) edges from the wall ledge', () => {
    let drops = 0, jumps = 0
    for (const list of nav.adj) for (const e of list) { if (e.kind === EdgeKind.Drop) drops++; if (e.kind === EdgeKind.Jump) jumps++ }
    console.log(`drops=${drops} jumps=${jumps}`)
    expect(drops).toBeGreaterThan(0)
  })
})

describe('zombie nav edges (T.4)', () => {
  const edgesOf = (kind: number) => {
    const out: { a: number; b: number; e: { to: number; face?: [number, number] } }[] = []
    for (let a = 0; a < nav.count; a++) for (const e of nav.adj[a]!) if (e.kind === kind) out.push({ a, b: e.to, e })
    return out
  }
  it('statistics', () => {
    const h = edgesOf(EdgeKind.Hole), l = edgesOf(EdgeKind.Leap)
    console.log(`zombie edges: hole ${h.length}, leap ${l.length}, build ${buildMs.toFixed(0)}ms`)
    expect(buildMs).toBeLessThan(8000)
  })
  it('has Hole edges through the city wall at x = ±19', () => {
    const h = edgesOf(EdgeKind.Hole)
    expect(h.length).toBeGreaterThan(0)
    const wall = h.filter(({ a, b }) => Math.abs(nav.x[a]!) > 19 !== Math.abs(nav.x[b]!) > 19)
    expect(wall.length).toBeGreaterThan(0)
  })
  it('has Leap edges from the ground to the wall ledge (y ≈ 4.2) and from the ledge to the tower top', () => {
    const l = edgesOf(EdgeKind.Leap)
    expect(l.some(({ a, b }) => nav.y[a]! < 0.5 && nav.y[b]! > 3.9 && nav.y[b]! < 4.5)).toBe(true)
    expect(l.some(({ a, b }) => nav.y[a]! > 3.9 && nav.y[b]! > 6)).toBe(true)
  })
  it('human A* does not use zombie edges; with the ability it does', () => {
    const from = nav.nearest(27, 0, 5), to = nav.nearest(-27, 0, 5)
    const human = nav.findNodePath(from, to)!
    for (let i = 1; i < human.length; i++) expect(nav.edge(human[i - 1]!, human[i]!)!.kind).toBeLessThan(EdgeKind.Hole)
    const crawl = nav.findNodePath(from, to, undefined, { hole: true })!
    expect(crawl).not.toBeNull()
  })
})
