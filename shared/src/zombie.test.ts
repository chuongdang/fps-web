import { describe, it, expect } from 'vitest'
import { createWorld } from './physics/world'
import { stepMovement, defaultMovement, Btn, type PlayerState, type InputCmd } from './movement'
import { zombieMovement, ZOMBIE, applyKnockback, knockbackImpulse } from './zombie'
import { loadMap } from './map/loadMap'
import type { MapFile } from './map/types'
import { mulberry32 } from './math'
import { DT } from './constants'

const slitMap = loadMap({
  name: 'slit', mirrorX: false, spawnsA: [{ pos: [0, 1, 0], yaw: 0 }], ramps: [],
  boxes: [
    { pos: [0, -0.5, 0], size: [80, 1, 80], texture: 'greenfloor' },
    { pos: [0, 0.5, 0], size: [0.4, 1, 20], texture: 'wall' },     // 1.0 m high ledge
    { pos: [0, 2.5, 0], size: [0.4, 1, 20], texture: 'wall' },     // crossbar from 2.0 m → gap exactly 1.0 m high
    { pos: [0, 5.0, 0], size: [0.4, 4, 20], texture: 'wall' },
  ],
} as MapFile)
const zcfg = zombieMovement(defaultMovement, 9.5)
const st = (pos: [number, number, number], yaw: number): PlayerState => ({ pos: [...pos], vel: [0, 0, 0], yaw, pitch: 0, grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 })
const cmd = (seq: number, buttons: number, yaw = -Math.PI / 2): InputCmd => ({ seq, buttons, yaw, pitch: 0, weapon: 0 })   // yaw −π/2 = looks toward +X

// Runs from x=-12 toward +X, crouches + jumps near the wall; returns the final x
async function crawlThroughSlit(cfg: typeof defaultMovement, jumpTick: number) {
  const w = await createWorld(slitMap)
  let s = st([-12, 1, 0], -Math.PI / 2)
  for (let i = 0; i < 30; i++) s = stepMovement(s, cmd(i, 0), w, cfg, DT)
  for (let i = 0; i < 200; i++) {
    let b = Btn.Forward
    if (i >= jumpTick) b |= Btn.Crouch
    if (i === jumpTick) b |= Btn.Jump
    s = stepMovement(s, cmd(100 + i, b), w, cfg, DT)
  }
  return s.pos[0]
}

describe('zombie movement (ZF.2)', () => {
  it('crawl through a 1.0 m high gap: the zombie fits (crouch + jump), the human does not', async () => {
    let zombiePassed = false, humanPassed = false
    for (let j = 20; j < 70; j++) {
      if ((await crawlThroughSlit(zcfg, j)) > 2) zombiePassed = true
      if ((await crawlThroughSlit(defaultMovement, j)) > 2) humanPassed = true
    }
    expect(zombiePassed).toBe(true)
    expect(humanPassed).toBe(false)
  }, 60_000)

  it('E ability: apex ≈ 4.3 m, reaches a 4 m ledge; 8s cooldown; unusable while airborne', async () => {
    const w = await createWorld(slitMap)
    let s = st([-12, 0, 5], -Math.PI / 2)
    for (let i = 0; i < 30; i++) s = stepMovement(s, cmd(i, 0), w, zcfg, DT)
    s = stepMovement(s, cmd(100, Btn.Ability), w, zcfg, DT)
    expect(s.leapCd).toBeCloseTo(ZOMBIE.leap.cooldownMs / 1000 - DT, 5)
    expect(s.vel[0]).toBeGreaterThan(4)   // momentum along the look direction (+X)
    let maxY = 0
    for (let i = 1; i < 120; i++) { s = stepMovement(s, cmd(100 + i, Btn.Ability), w, zcfg, DT); maxY = Math.max(maxY, s.pos[1]) }
    expect(maxY).toBeGreaterThan(4.1)
    expect(maxY).toBeLessThan(4.6)
    expect(s.leapCd).toBeGreaterThan(5)   // still on cooldown: mashing E does not leap a second time
  })

  it('humans have no E ability (Ability is ignored)', async () => {
    const w = await createWorld(slitMap)
    let s = st([-12, 0, 5], 0)
    for (let i = 0; i < 30; i++) s = stepMovement(s, cmd(i, 0), w, defaultMovement, DT)
    s = stepMovement(s, cmd(100, Btn.Ability), w, defaultMovement, DT)
    expect(s.vel[1]).toBeLessThanOrEqual(0)
  })

  it('no bunny hop: each jump loses 30% of horizontal speed', async () => {
    const w = await createWorld(slitMap)
    let s = st([-30, 0, 5], -Math.PI / 2)
    for (let i = 0; i < 60; i++) s = stepMovement(s, cmd(i, Btn.Forward), w, zcfg, DT)
    const before = Math.hypot(s.vel[0], s.vel[2])
    s = stepMovement(s, cmd(100, Btn.Forward | Btn.Jump), w, zcfg, DT)
    expect(Math.hypot(s.vel[0], s.vel[2])).toBeLessThan(before * 0.75)
  })

  it('no slide when crouching while running fast', async () => {
    const w = await createWorld(slitMap)
    let s = st([-30, 0, 5], -Math.PI / 2)
    for (let i = 0; i < 60; i++) s = stepMovement(s, cmd(i, Btn.Forward), w, zcfg, DT)
    s = stepMovement(s, cmd(100, Btn.Forward | Btn.Crouch), w, zcfg, DT)
    expect(s.slideTimer).toBe(0)
  })

  it('deterministic: two worlds, 600 ticks of random crouch-jump + E ability, bit-identical', async () => {
    const w1 = await createWorld(slitMap), w2 = await createWorld(slitMap)
    const rng = mulberry32(0xC0FFEE)
    let a = st([-12, 1, 3], -Math.PI / 2), b = st([-12, 1, 3], -Math.PI / 2)
    for (let i = 0; i < 600; i++) {
      let buttons = 0
      if (rng() < 0.7) buttons |= Btn.Forward
      if (rng() < 0.3) buttons |= Btn.Crouch
      if (rng() < 0.2) buttons |= Btn.Jump
      if (rng() < 0.05) buttons |= Btn.Ability
      const c = cmd(i, buttons, (rng() * 2 - 1) * Math.PI)
      a = stepMovement(a, c, w1, zcfg, DT)
      b = stepMovement(b, c, w2, zcfg, DT)
      expect(a.pos, `tick ${i}`).toEqual(b.pos)
      expect(a.vel, `tick ${i}`).toEqual(b.vel)
      expect(a.leapCd).toBe(b.leapCd)
    }
  }, 30_000)
})

describe('knockback (ZF.2)', () => {
  it('shotgun pushes harder than AK; resist reduces it; airborne ×1.5; clamped at 14 m/s', () => {
    const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0]
    knockbackImpulse(a, 'shotgun', 128, 0, 1, 0, false)   // 8 pellets × 16
    knockbackImpulse(b, 'ak47', 36, 0, 1, 0, false)
    expect(a[0]).toBeGreaterThan(b[0] * 5)
    expect(a[1]).toBeCloseTo(a[0] * ZOMBIE.knockbackUp, 6)
    const c: [number, number, number] = [0, 0, 0]
    knockbackImpulse(c, 'shotgun', 128, 0.5, 1, 0, false)
    expect(c[0]).toBeCloseTo(a[0] * 0.5, 6)
    const d: [number, number, number] = [0, 0, 0]
    knockbackImpulse(d, 'shotgun', 128, 0, 1, 0, true)
    expect(d[0]).toBeCloseTo(a[0] * 1.5, 6)
    const vel: [number, number, number] = [10, 0, 0]
    applyKnockback(vel, [20, 3, 0])
    expect(Math.hypot(vel[0], vel[2])).toBeCloseTo(ZOMBIE.knockbackMaxHSpeed, 6)
    expect(vel[1]).toBe(3)
  })
})

describe('zombie appearance (ZF.1)', () => {
  it('deterministic by id; size deviation ≤ ±6%; 10 zombies do not share one tint+size', async () => {
    const { zombieVariation } = await import('./zombie')
    expect(zombieVariation(7)).toEqual(zombieVariation(7))
    const seen = new Set<string>()
    for (let id = 1; id <= 10; id++) {
      const v = zombieVariation(id)
      expect(Math.abs(v.scale - 1)).toBeLessThanOrEqual(0.0601)
      seen.add(`${v.tint}|${v.scale.toFixed(3)}`)
    }
    expect(seen.size).toBeGreaterThanOrEqual(8)
  })
  it('zombie from an infected player: fixed grey-green tint, no dedicated model; tintOverride replaces the tint', async () => {
    const { zombieVariation, ZOMBIE_LOOK } = await import('./zombie')
    const h = zombieVariation(3, { fromHuman: true })
    expect(h.tint).toBe(ZOMBIE_LOOK.variation.infectedTint)
    expect(h.model).toBeNull()
    expect(zombieVariation(3, { tintOverride: '#c9b28a' }).tint).toBe('#c9b28a')
  })
  it('zombie models: files exist, a normal zombie never gets the mother zombie model, the mother gets her own model', async () => {
    const { zombieVariation, ZOMBIE_LOOK } = await import('./zombie')
    expect(ZOMBIE_LOOK.models.length).toBeGreaterThanOrEqual(10)
    const mother = ZOMBIE_LOOK.models.find(m => m.id === ZOMBIE_LOOK.motherModel)
    expect(mother).toBeDefined()
    const used = new Set<string>()
    for (let id = 1; id <= 200; id++) used.add(zombieVariation(id).model!.id)
    expect(used.has(mother!.id)).toBe(false)
    expect(used.size).toBeGreaterThanOrEqual(8)
    expect(zombieVariation(5, { fromHuman: true, modelOverride: mother!.id }).model).toBe(mother)
  })
})

describe('leapFlight', () => {
  it('leap onto a 4.2 m ledge: flight ≈ 0.74s, covers ≈ 3.7 m; cannot reach 4.5 m (apex 4.33 m)', async () => {
    const { leapFlight, leapApex } = await import('./zombie')
    const f = leapFlight(4.2)!
    expect(f.time).toBeGreaterThan(0.6); expect(f.time).toBeLessThan(0.9)
    expect(f.dist).toBeCloseTo(5 * f.time, 6)
    expect(leapApex()).toBeCloseTo(4.33, 1)
    expect(leapFlight(4.6)).toBeNull()
    expect(leapFlight(2.2)!.dist).toBeGreaterThan(leapFlight(4.2)!.dist)   // lower ledge means longer flight (lands later)
  })
})

describe('zombieMovement – crouch speed', () => {
  it('slow zombie (crawler 3.5 m/s) is not faster when crouched; fast zombie keeps the human crouchSpeed', async () => {
    const { zombieMovement } = await import('./zombie')
    const { defaultMovement } = await import('./movement')
    expect(zombieMovement(defaultMovement, 3.5).crouchSpeed).toBe(3.5)
    expect(zombieMovement(defaultMovement, 7).crouchSpeed).toBe(defaultMovement.crouchSpeed)
  })
})
