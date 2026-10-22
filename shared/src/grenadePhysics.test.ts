import { describe, it, expect } from 'vitest'
import { createWorld, type CollisionWorld } from './physics/world'
import { loadMap } from './map/loadMap'
import type { MapFile } from './map/types'
import { throwInitial, stepGrenade, type GrenadeState, type GrenadeEvent } from './grenadePhysics'
import { GRENADE } from './grenade'
import { DT } from './constants'
import type { PlayerState } from './movement'
import mapRaw from '../../assets/maps/deathmatch.json'

// Real map (Deathmatch, real Rapier). Castle wall at x = −19: pillars spanning −0.2…2.6 m high, separated by 2 m wide gaps
// (gap at z ∈ (−1, 1) but that is the ramp foot; use the gap (4.67; 6.67)), low ledge under 0.5 m, wall top up to ~5.25 m. West boundary wall at x = −31.
const map = loadMap(mapRaw as unknown as MapFile)
const player = (pos: [number, number, number], yaw: number, pitch: number, vel: [number, number, number] = [0, 0, 0]): PlayerState =>
  ({ pos, vel, yaw, pitch, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 })
const FACE_PLUS_X = -Math.PI / 2   // yaw: forward = (−sin yaw, −cos yaw) = (+1, 0)
const make = (pos: [number, number, number], vel: [number, number, number]): GrenadeState =>
  ({ id: 1, ownerId: 1, team: 'A', pos: [...pos] as [number, number, number], vel: [...vel] as [number, number, number], spawnTick: 0, resting: false })

function run(g: GrenadeState, world: CollisionWorld, ticks: number): { events: GrenadeEvent[]; maxY: number; restTick: number } {
  const events: GrenadeEvent[] = []
  let maxY = g.pos[1], restTick = -1
  for (let i = 0; i < ticks; i++) {
    const e = stepGrenade(g, world, DT)
    if (e) events.push(e)
    maxY = Math.max(maxY, g.pos[1])
    if (g.resting && restTick < 0) restTick = i
  }
  return { events, maxY, restTick }
}

describe('throwInitial', () => {
  it('strong throw: speed per GRENADE.throwSpeed, pitch + throwUpDeg, plus 50% of the thrower velocity', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-25, 0, -3], FACE_PLUS_X, 0, [4, 0, 0]), 'strong', w)
    const sp = GRENADE.throwSpeed.strong, up = GRENADE.throwUpDeg.strong * Math.PI / 180
    expect(t.vel[0]).toBeCloseTo(sp * Math.cos(up) + 2, 4)
    expect(t.vel[1]).toBeCloseTo(sp * Math.sin(up), 4)
    expect(Math.abs(t.vel[2])).toBeLessThan(1e-6)
    // start: 0.3 m in front of the eyes, 0.15 m to the right, 0.05 m below the eyes
    expect(t.pos[0]).toBeCloseTo(-25 + 0.3, 4); expect(t.pos[1]).toBeCloseTo(1.6 - 0.05, 4); expect(t.pos[2]).toBeCloseTo(-3 - 0.15 * Math.sin(FACE_PLUS_X), 4)
    w.dispose()
  })
  it('low throw (lob): speed per GRENADE.throwSpeed.lob', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-25, 0, -3], FACE_PLUS_X, 0), 'lob', w)
    expect(Math.hypot(...t.vel)).toBeCloseTo(GRENADE.throwSpeed.lob, 4)
    w.dispose()
  })
  it('standing against the wall: starts at the eyes (does not pass through the wall)', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-19.45, 0, -3], FACE_PLUS_X, 0), 'strong', w)   // 0.25 m from the wall face (−19.2) < 0.3 m forward offset
    expect(t.pos[0]).toBeCloseTo(-19.45, 6); expect(t.pos[1]).toBeCloseTo(1.6, 6)
    w.dispose()
  })
})

describe('stepGrenade (real Rapier)', () => {
  it('high throw from against the castle wall: flies over the wall top and lands in the middle area', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-21.5, 0, -3], FACE_PLUS_X, 70 * Math.PI / 180), 'strong', w)
    const g = make(t.pos, t.vel)
    const r = run(g, w, 300)
    expect(r.maxY).toBeGreaterThan(5.3)        // clears the wall top
    expect(g.pos[0]).toBeGreaterThan(-18.5)    // already on the other side of the wall
    expect(g.pos[1]).toBeLessThan(1)           // fell to the ground
    w.dispose()
  })

  it('straight throw at a wall 2 m away: bounces back, does not pass through', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-21.2, 0, -3], FACE_PLUS_X, 0), 'strong', w)   // pillar at z = −3 (−4.67…−1)
    const g = make(t.pos, t.vel)
    let minX = 1e9, maxX = -1e9
    for (let i = 0; i < 240; i++) { stepGrenade(g, w, DT); maxX = Math.max(maxX, g.pos[0]); minX = Math.min(minX, g.pos[0]) }
    expect(maxX).toBeLessThan(-19.2 + 1e-3)    // does not pass the wall face (pillar 0.4 thick around x = −19)
    expect(g.pos[0]).toBeLessThan(-19.5)       // on this side, bounced back
    expect(g.pos[1]).toBeLessThan(0.2)
    w.dispose()
  })

  it('dropped from 2 m: bounces a few times, lower each time, then rests within < 2 seconds', async () => {
    const w = await createWorld(map)
    const g = make([-5, 2, 5], [0, 0, 0])
    const speeds: number[] = []
    let restTick = -1
    for (let i = 0; i < 180; i++) {
      const e = stepGrenade(g, w, DT)
      if (e) speeds.push(e.speed)
      if (g.resting && restTick < 0) restTick = i
    }
    expect(speeds.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThan(speeds[i - 1]!)
    expect(restTick).toBeGreaterThan(0); expect(restTick).toBeLessThan(120)
    expect(g.pos[1]).toBeLessThan(GRENADE.radius + 0.02)   // lying on the floor
    expect(g.vel).toEqual([0, 0, 0])
    w.dispose()
  })

  it('deterministic: 2 separate worlds, same input, 300 ticks → every number identical', async () => {
    const w1 = await createWorld(map), w2 = await createWorld(map)
    const t = throwInitial(player([-23, 0, -2], FACE_PLUS_X + 0.2, 0.35, [1, 0, 0.5]), 'strong', w1)
    const a = make(t.pos, t.vel), b = make(t.pos, t.vel)
    for (let i = 0; i < 300; i++) {
      const ea = stepGrenade(a, w1, DT), eb = stepGrenade(b, w2, DT)
      expect(eb).toEqual(ea)
      expect(b.pos).toEqual(a.pos); expect(b.vel).toEqual(a.vel); expect(b.resting).toBe(a.resting)
    }
    w1.dispose(); w2.dispose()
  })

  it('throw into the firing gap (2 m wide, z ∈ (4.67; 6.67)): passes through', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-24, 0, 5.667], FACE_PLUS_X, 0), 'strong', w)
    const g = make(t.pos, t.vel)
    run(g, w, 90)
    expect(g.pos[0]).toBeGreaterThan(-17)      // past the wall at x = −19
    w.dispose()
  })

  it('rolling on a ramp does not fall through', async () => {
    const w = await createWorld(map)
    const g = make([-23, 2.5, 0], [0, 0, 0])   // dropped onto the ramp (−27,0,0)→(−19,75,4,1,0)
    for (let i = 0; i < 240; i++) stepGrenade(g, w, DT)
    expect(g.pos[1]).toBeGreaterThan(-0.05)
    w.dispose()
  })

  it('low throw (lob) on flat floor: bounces, rolls a bit and rests (does not roll forever)', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-5, 0, 5], FACE_PLUS_X, -0.3), 'lob', w)
    const g = make(t.pos, t.vel)
    const r = run(g, w, 600)
    expect(r.restTick).toBeGreaterThan(0)
    expect(g.pos[0]).toBeGreaterThan(-4)   // already moved forward
    expect(g.pos[1]).toBeLessThan(GRENADE.radius + 0.02)
    w.dispose()
  })

  it('resting: does nothing, emits no events', async () => {
    const w = await createWorld(map)
    const g = make([-5, 0.05, 5], [3, 0, 0]); g.resting = true
    expect(stepGrenade(g, w, DT)).toBeNull(); expect(g.pos).toEqual([-5, 0.05, 5])
    w.dispose()
  })
})
