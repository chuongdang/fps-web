import { describe, it, expect } from 'vitest'
import { createWorld } from './physics/world'
import { stepMovement, defaultMovement, Btn } from './movement'
import { loadMap } from './map/loadMap'
import type { MapFile } from './map/types'
import type { PlayerState } from './movement'
import { mulberry32 } from './math'
import { DT, TICK_RATE } from './constants'
import mapRaw from '../../assets/maps/deathmatch.json'

const loadedMap = loadMap(mapRaw as unknown as MapFile)
const cfg = defaultMovement

function makeState(pos: [number, number, number], yaw: number): PlayerState {
  return { pos: [...pos] as [number, number, number], vel: [0, 0, 0], yaw, pitch: 0, grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 }
}

describe('stepMovement', () => {
  it('determinism: two identical worlds produce bit-identical states for 600 ticks', async () => {
    const world1 = await createWorld(loadedMap)
    const world2 = await createWorld(loadedMap)

    const rng   = mulberry32(0xDEADBEEF)
    const spawn: [number, number, number] = [-28, 1, -6]
    const yaw0  = -Math.PI / 2

    let s1 = makeState(spawn, yaw0)
    let s2 = makeState(spawn, yaw0)

    for (let i = 0; i < 600; i++) {
      let buttons = 0
      if (rng() < 0.7)  buttons |= Btn.Forward
      if (rng() < 0.3)  buttons |= Btn.Left
      if (rng() < 0.3)  buttons |= Btn.Right
      if (rng() < 0.15) buttons |= Btn.Jump
      const yaw = (rng() * 2 - 1) * Math.PI
      const cmd = { seq: i, buttons, yaw, pitch: 0, weapon: 0 }

      s1 = stepMovement(s1, cmd, world1, cfg, DT)
      s2 = stepMovement(s2, cmd, world2, cfg, DT)

      expect(s1.pos[0], `tick ${i} pos.x`).toBe(s2.pos[0])
      expect(s1.pos[1], `tick ${i} pos.y`).toBe(s2.pos[1])
      expect(s1.pos[2], `tick ${i} pos.z`).toBe(s2.pos[2])
      expect(s1.vel[0], `tick ${i} vel.x`).toBe(s2.vel[0])
      expect(s1.vel[1], `tick ${i} vel.y`).toBe(s2.vel[1])
      expect(s1.vel[2], `tick ${i} vel.z`).toBe(s2.vel[2])
      expect(s1.grounded, `tick ${i} grounded`).toBe(s2.grounded)
    }
  }, 20_000)

  it('running straight 2 s reaches 8.4–8.6 m/s', async () => {
    const world = await createWorld(loadedMap)
    const spawn: [number, number, number] = [-28, 1, -6]
    const yaw0  = -Math.PI / 2   // looks toward +X

    let state = makeState(spawn, yaw0)

    // Let the character fall to the floor (~0.5 s)
    for (let i = 0; i < 30; i++) {
      state = stepMovement(state, { seq: i, buttons: 0, yaw: yaw0, pitch: 0, weapon: 0 }, world, cfg, DT)
    }

    // Run straight for 2 seconds
    for (let i = 0; i < TICK_RATE * 2; i++) {
      state = stepMovement(state, { seq: 30 + i, buttons: Btn.Forward, yaw: yaw0, pitch: 0, weapon: 0 }, world, cfg, DT)
    }

    const horizSpeed = Math.hypot(state.vel[0], state.vel[2])
    expect(horizSpeed).toBeGreaterThan(8.4)
    expect(horizSpeed).toBeLessThan(8.6)
  }, 20_000)
})

describe('crouch release', () => {
  const settle = (world: Awaited<ReturnType<typeof createWorld>>, s: PlayerState, buttons: number, n: number) => {
    for (let i = 0; i < n; i++) s = stepMovement(s, { seq: i, buttons, yaw: 0, pitch: 0, weapon: 0 }, world, cfg, DT)
    return s
  }

  it('releasing Ctrl in the open stands up immediately', async () => {
    const world = await createWorld(loadedMap)
    let s = settle(world, makeState([-28, 1, -6], 0), 0, 30)
    s = settle(world, s, Btn.Crouch, 30)
    expect(s.crouching).toBe(true)
    s = settle(world, s, 0, 2)
    expect(s.crouching).toBe(false)
  })

  it('releasing Ctrl against a wall (all directions) still stands up', async () => {
    const world = await createWorld(loadedMap)
    const base = settle(world, makeState([-28, 1, -6], 0), 0, 30)
    for (const buttons of [Btn.Forward, Btn.Back, Btn.Left, Btn.Right]) {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        let s: PlayerState = { ...base, pos: [...base.pos] as [number, number, number], vel: [0, 0, 0] }
        const cmd = (b: number) => ({ seq: 0, buttons: b, yaw, pitch: 0, weapon: 0 })
        for (let i = 0; i < 240; i++) s = stepMovement(s, cmd(buttons | Btn.Crouch), world, cfg, DT)
        for (let i = 0; i < 5; i++) s = stepMovement(s, cmd(0), world, cfg, DT)
        expect(s.crouching, `buttons=${buttons} yaw=${yaw}`).toBe(false)
      }
    }
  })
})

describe('slide', () => {
  const run = (world: Awaited<ReturnType<typeof createWorld>>, s: PlayerState, buttons: number, n: number) => {
    for (let i = 0; i < n; i++) s = stepMovement(s, { seq: i, buttons, yaw: -Math.PI / 2, pitch: 0, weapon: 0 }, world, cfg, DT)
    return s
  }
  const hs = (s: PlayerState) => Math.hypot(s.vel[0], s.vel[2])

  it('run + Crouch: slide has a boost, slows down, can slide again only after the cooldown', async () => {
    const world = await createWorld(loadedMap)
    let s = run(world, makeState([-28, 1, -6], -Math.PI / 2), Btn.Forward, 90)   // run up to max speed
    const before = hs(s)
    expect(before).toBeGreaterThan(cfg.slideMinSpeed)

    s = run(world, s, Btn.Forward | Btn.Crouch, 1)
    expect(s.slideTimer).toBeGreaterThan(0)
    expect(hs(s)).toBeGreaterThan(before + cfg.slideBoost * 0.9)

    // Sliding cannot be steered: releasing W keeps gliding, speed decays slowly (low friction)
    const v1 = hs(s)
    s = run(world, s, Btn.Crouch, 20)
    expect(hs(s)).toBeLessThan(v1)
    expect(hs(s)).toBeGreaterThan(v1 * 0.6)

    // Release then press C again during the cooldown (~0.5s after the first slide): no extra slide
    s = run(world, s, Btn.Forward, 5)
    expect(s.slideCooldown).toBeGreaterThan(0)
    s = run(world, s, Btn.Forward | Btn.Crouch, 1)
    expect(s.slideTimer).toBe(0)

    // Cooldown over, run fast enough again → can slide once more
    s = run(world, s, Btn.Forward, 120)
    expect(s.slideCooldown).toBe(0)
    s = run(world, s, Btn.Forward | Btn.Crouch, 1)
    expect(s.slideTimer).toBeGreaterThan(0)
  })

  it('walk slowly + Crouch: no slide', async () => {
    const world = await createWorld(loadedMap)
    let s = run(world, makeState([-28, 1, -6], -Math.PI / 2), 0, 30)
    s = run(world, s, Btn.Crouch, 5)
    expect(s.slideTimer).toBe(0)
  })
})

describe('sky barrier walls', () => {
  it('bunny-hop from the edge of the high ledge (7.2m) toward the wall does not leave the map', async () => {
    const world = await createWorld(loadedMap)
    let s = makeState([-15, 7.3, -16], 0)
    for (let i = 0; i < 30; i++) s = stepMovement(s, { seq: i, buttons: 0, yaw: 0, pitch: 0, weapon: 0 }, world, cfg, DT)
    for (let i = 0; i < 600; i++) {
      s = stepMovement(s, { seq: i, buttons: Btn.Forward | Btn.Jump, yaw: 0, pitch: 0, weapon: 0 }, world, cfg, DT)
      expect(s.pos[2]).toBeGreaterThan(-20.1)
    }
  })
})

describe('adsT (ADS)', () => {
  const flat = {
    moveCharacter: (pos: [number, number, number], d: [number, number, number]) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]] as [number, number, number], grounded: pos[1] + d[1] <= 0, hitCeiling: false }),
    canStand: () => true, castRay: () => null, castSphere: () => null, debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }), dispose: () => {},
  }
  const ADS = { inMs: 200, outMs: 100, moveMult: 0.5 }
  const grounded = (over: Partial<PlayerState> = {}): PlayerState => ({ ...makeState([0, 0, 0], 0), grounded: true, ...over })
  const cmd = (seq: number, buttons = 0) => ({ seq, buttons, yaw: 0, pitch: 0, weapon: 0 })

  it('hold Aim: adsT rises to 1 after inMs; release: back to 0 after outMs', () => {
    let s = grounded()
    for (let i = 0; i < 6; i++) s = stepMovement(s, cmd(i, Btn.Aim), flat, cfg, DT, 1, ADS, true)
    expect(s.adsT).toBeCloseTo(6 * DT * 1000 / 200, 6)
    for (let i = 0; i < 20; i++) s = stepMovement(s, cmd(i, Btn.Aim), flat, cfg, DT, 1, ADS, true)
    expect(s.adsT).toBe(1)
    for (let i = 0; i < 7; i++) s = stepMovement(s, cmd(i), flat, cfg, DT, 1, ADS, false)
    expect(s.adsT).toBe(0)
  })
  it('airborne or sliding: does not enter ADS, adsT decays; a gun without ADS (ads = null) decays too', () => {
    let s = stepMovement(grounded({ grounded: false, adsT: 1 }), cmd(0, Btn.Aim), flat, cfg, DT, 1, ADS, true)
    expect(s.adsT).toBeLessThan(1)
    s = stepMovement(grounded({ slideTimer: 0.3, crouching: true, adsT: 0.5 }), cmd(0, Btn.Aim | Btn.Crouch), flat, cfg, DT, 1, ADS, true)
    expect(s.adsT).toBeLessThan(0.5)
    s = stepMovement(grounded({ adsT: 1 }), cmd(0, Btn.Aim), flat, cfg, DT, 1, null, true)
    expect(s.adsT).toBeLessThan(1)
  })
  it('full ADS moves slower per moveMult', () => {
    const speed = (ads: boolean) => {
      let s = grounded()
      for (let i = 0; i < 240; i++) s = stepMovement(s, cmd(i, Btn.Forward | (ads ? Btn.Aim : 0)), flat, cfg, DT, 1, ADS, ads)
      return Math.hypot(s.vel[0], s.vel[2])
    }
    expect(speed(true)).toBeCloseTo(speed(false) * 0.5, 1)
  })
  it('determinism: Aim toggled randomly, two separate states give identical results', () => {
    const rng = mulberry32(12345)
    let a = grounded(), b = grounded()
    for (let i = 0; i < 600; i++) {
      const buttons = (rng() < 0.6 ? Btn.Forward : 0) | (rng() < 0.5 ? Btn.Aim : 0) | (rng() < 0.05 ? Btn.Jump : 0)
      const c = cmd(i, buttons)
      const want = (buttons & Btn.Aim) !== 0 && rng() < 0.9
      a = stepMovement(a, c, flat, cfg, DT, 0.92, ADS, want)
      b = stepMovement(b, c, flat, cfg, DT, 0.92, ADS, want)
      expect(a.adsT).toBe(b.adsT)
      expect(a.pos).toEqual(b.pos)
    }
  })
})
