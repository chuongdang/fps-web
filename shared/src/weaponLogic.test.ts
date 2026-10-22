import { describe, it, expect } from 'vitest'
import { WEAPONS, makeWeaponState, MAX_PELLETS } from './weapons'
import {
  stepWeapon, tryFire, computeShot, makeRecoilState, recoverRecoil, switchWeapon, computeShotDirs, damageFalloff,
} from './weaponLogic'
import { Btn } from './movement'
import type { PlayerState } from './movement'
import { DT } from './constants'
import { moveSpeedMul, adsMoveFor, adsWanted, stepWeaponCmd, selectSlot, copyWeaponState, weaponStatesEqual } from './weaponLogic'
import { weaponByKey, CATEGORY_SLOT } from './weapons'
import { stepMovement, defaultMovement } from './movement'

const AK_SLOTS = [6, 2, -1, 0, -1]   // AK47 in slot 3, slot 4 (grenade) empty
const AK = WEAPONS[0]!
const COLT = WEAPONS[2]!

// Runs `ticks` ticks, returns the shot count and the event timings
function run(ws: ReturnType<typeof makeWeaponState>, ticks: number, trigger: (t: number) => boolean, startTick = 0) {
  const ev: { t: number; e: string }[] = []
  for (let t = startTick; t < startTick + ticks; t++) {
    const e = stepWeapon(ws, t * DT * 1000, trigger(t), false)
    if (e !== 'none') ev.push({ t: t * DT * 1000, e })
  }
  return ev
}

describe('tryFire', () => {
  it('auto: holding the trigger fires per fireInterval and subtracts the right ammo', () => {
    const ws = makeWeaponState(AK_SLOTS)
    const ev = run(ws, 60, () => true)   // 1 second
    const shots = ev.filter(x => x.e === 'fired')
    expect(shots.length).toBe(Math.ceil(1000 / AK.fireIntervalMs))   // 100ms → 10 shots/s
    expect(ws.ammo[0]).toBe(AK.magSize - shots.length)
    expect(ws.shotSeq).toBe(shots.length)
  })

  it('out of ammo: auto-reloads once (dry), then fills up', () => {
    const ws = makeWeaponState(AK_SLOTS)
    const ev = run(ws, 60 * 8, () => true)
    expect(ev.filter(x => x.e === 'dry').length).toBeGreaterThanOrEqual(1)
    const dry = ev.find(x => x.e === 'dry')!
    const end = ev.find(x => x.e === 'reloadEnd')!
    expect(end.t - dry.t).toBeGreaterThanOrEqual(AK.reloadMs)
    expect(end.t - dry.t).toBeLessThan(AK.reloadMs + 2 * DT * 1000)
    // no shooting while reloading
    expect(ev.filter(x => x.e === 'fired' && x.t > dry.t && x.t < end.t).length).toBe(0)
  })

  it('semi-auto: holding the trigger gives 1 shot; fast clicking is limited by fireInterval', () => {
    const ws = makeWeaponState(AK_SLOTS)
    ws.current = 2
    expect(run(ws, 120, () => true).filter(x => x.e === 'fired').length).toBe(1)

    const ws2 = makeWeaponState(AK_SLOTS)
    ws2.current = 2
    // click every 2 ticks (30 clicks/s) for 1 second
    const ev = run(ws2, 60, t => t % 2 === 0)
    const shots = ev.filter(x => x.e === 'fired').length
    // fireInterval rounds up to a multiple of ticks (160ms → 10 ticks = 166.7ms) → 6 shots/s
    expect(shots).toBeLessThanOrEqual(Math.ceil(1000 / COLT.fireIntervalMs))
    expect(shots).toBeGreaterThanOrEqual(5)
  })

  it('switching guns cancels reload', () => {
    const ws = makeWeaponState(AK_SLOTS)
    ws.ammo[0] = 5
    stepWeapon(ws, 0, false, true)
    expect(ws.reloadEndMs).toBeGreaterThan(0)
    switchWeapon(ws, 1, 100)
    expect(ws.reloadEndMs).toBe(0)
    expect(ws.ammo[0]).toBe(5)
    expect(tryFire(ws, WEAPONS[1]!, 100, true)).toBe(false)   // weapon switch lock active
  })
})

describe('computeShot', () => {
  it('same playerId + shotSeq + state → same direction', () => {
    const a: [number, number, number] = [0, 0, 0]
    const b: [number, number, number] = [0, 0, 0]
    computeShot(a, makeRecoilState(), AK, 7, 42, 0.3, 0.1, 2)
    computeShot(b, makeRecoilState(), AK, 7, 42, 0.3, 0.1, 2)
    expect(a).toEqual(b)
    computeShot(b, makeRecoilState(), AK, 7, 43, 0.3, 0.1, 2)
    expect(a).not.toEqual(b)
  })

  it('deviation stays within the spread cone; spread 0 hits exactly where aimed', () => {
    const d: [number, number, number] = [0, 0, 0]
    computeShot(d, makeRecoilState(), AK, 1, 0, 0, 0, 0)
    expect(d[2]).toBeCloseTo(-1, 9)
    const maxDeg = 5
    for (let i = 0; i < 200; i++) {
      computeShot(d, makeRecoilState(), AK, 1, i, 0, 0, maxDeg)
      const angle = Math.acos(-d[2]) * 180 / Math.PI
      expect(angle).toBeLessThanOrEqual(maxDeg + 0.01)
    }
  })

  it('recoil accumulates per shot then recovers to 0', () => {
    const rec = makeRecoilState()
    const ws = makeWeaponState(AK_SLOTS)
    const d: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < 5; i++) computeShot(d, rec, AK, 1, i, 0, 0, 0)
    expect(rec.pitch).toBeCloseTo(5 * AK.recoilPitchDeg * Math.PI / 180, 9)
    for (let i = 0; i < 600; i++) recoverRecoil(rec, AK, ws, 10_000 + i * 16, 1 / 60)
    expect(rec.pitch).toBe(0)
    expect(rec.yaw).toBe(0)
  })
})

describe('sniper + ADS', () => {
  const SNIPER = WEAPONS[4]!

  it('stats per plan: 1 shot/1.2s, 90 dmg, head ×2, scope FOV 30, single zoom level', () => {
    expect(SNIPER.fireIntervalMs).toBe(1200)
    expect(SNIPER.damage).toBe(90)
    expect(SNIPER.headMult).toBe(2)
    expect(SNIPER.ads?.scope).toBe(true)
    expect(SNIPER.ads?.fovMult).toBeCloseTo(0.4)
  })
  it('rifles ADS without covering the screen; pistols, knife and grenades have no ADS; shotgun and SMG have no ADS', () => {
    expect(AK.ads?.scope).toBe(false)
    expect(WEAPONS[1]!.ads?.scope).toBe(false)
    expect(WEAPONS[5]!.ads).toBeUndefined()   // shotgun and SMG (medium gun line) have no ADS
    expect(WEAPONS[7]!.ads).toBeUndefined()
    expect(WEAPONS[6]!.ads).toBeUndefined()
  })
  it('adsMoveFor/adsWanted: no ADS while reloading or weapon-switch locked', () => {
    const ws = makeWeaponState(AK_SLOTS)
    expect(adsMoveFor(ws)).toEqual({ inMs: AK.ads!.inMs, outMs: AK.ads!.outMs, moveMult: AK.ads!.moveMult })
    expect(adsWanted(ws, Btn.Aim, 0)).toBe(true)
    expect(adsWanted(ws, 0, 0)).toBe(false)
    ws.reloadEndMs = 500
    expect(adsWanted(ws, Btn.Aim, 0)).toBe(false)
    ws.reloadEndMs = 0
    selectSlot(ws, 1, 1000)
    expect(adsWanted(ws, Btn.Aim, 1100)).toBe(false)
    expect(adsWanted(ws, Btn.Aim, 1000 + 300)).toBe(true)
  })
  it('sniper recovers recoil right after ~120ms (does not wait out the 1.2s between shots)', () => {
    const ws = makeWeaponState(AK_SLOTS); ws.current = 4
    const rec = makeRecoilState(); rec.pitch = 0.05
    ws.nextFireMs = 1200   // just fired at t=0
    recoverRecoil(rec, SNIPER, ws, 100, 0.016)
    expect(rec.pitch).toBe(0.05)
    recoverRecoil(rec, SNIPER, ws, 130, 0.016)
    expect(rec.pitch).toBeLessThan(0.05)
  })
})

describe('shotgun', () => {
  const SG = WEAPONS[5]!
  const mk = () => Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])

  it('8 rays/shot, each in a different direction, repeatable by seed', () => {
    const a = mk(), b = mk()
    expect(computeShotDirs(a, makeRecoilState(), SG, 7, 3, 0, 0, SG.spread.moveDeg)).toBe(8)
    computeShotDirs(b, makeRecoilState(), SG, 7, 3, 0, 0, SG.spread.moveDeg)
    expect(b.slice(0, 8)).toEqual(a.slice(0, 8))
    expect(new Set(a.slice(0, 8).map(d => d.join(','))).size).toBe(8)
    const c = mk(); computeShotDirs(c, makeRecoilState(), SG, 7, 4, 0, 0, SG.spread.moveDeg)   // different shot → different
    expect(c[0]).not.toEqual(a[0])
  })
  it('recoil is added once per shot, not 8 times', () => {
    const rec = makeRecoilState()
    computeShotDirs(mk(), rec, SG, 1, 0, 0, 0, SG.spread.moveDeg)
    expect(rec.pitch).toBeCloseTo(SG.recoilPitchDeg * Math.PI / 180, 6)
  })
  it('single-ray guns use the old computeShot exactly (same direction, same recoil)', () => {
    const o1 = mk(), r1 = makeRecoilState(), r2 = makeRecoilState()
    const o2: [number, number, number] = [0, 0, 0]
    computeShotDirs(o1, r1, AK, 5, 9, 0.3, 0.1, 0.5)
    computeShot(o2, r2, AK, 5, 9, 0.3, 0.1, 0.5)
    expect(o1[0]).toEqual(o2); expect(r1).toEqual(r2)
  })
  it('damage falls off with distance', () => {
    expect(damageFalloff(SG, 3)).toBe(1)
    expect(damageFalloff(SG, 18)).toBeCloseTo(0.6, 5)
    expect(damageFalloff(SG, 50)).toBe(0.2)
    expect(damageFalloff(AK, 100)).toBe(1)
  })
})


describe('new weapons (H.1)', () => {
  const SHOTGUN = weaponByKey('shotgun')!, SMG = weaponByKey('smg')!, KNIFE = weaponByKey('knife')!, SNIPER = weaponByKey('sniper')!

  it('every gun has a valid line/slot, the knife is not buyable, prices match the table', () => {
    const price: Record<string, number> = { knife: 0, colt: 300, rulo: 700, shotgun: 1100, smg: 1250, ak47: 2700, m16: 3100, sniper: 4750, m67: 300, claw: 0, claw_heavy: 0, smoke: 300 }
    expect(WEAPONS.length).toBe(12)   // 8 guns + M67 grenade + 2 zombie claws + smoke grenade
    for (const w of WEAPONS) {
      expect(price[w.key], w.key).toBe(w.price)
      expect(CATEGORY_SLOT[w.category]).toBeGreaterThanOrEqual(0)
    }
    expect(KNIFE.buyable).toBe(false)
    expect(weaponByKey('claw')!.buyable).toBe(false)
  })

  it('shotgun: 8 rays; 3m full damage, 25m falls to ~37% (interpolated falloff)', () => {
    expect(SHOTGUN.pellets).toBe(8)
    expect(damageFalloff(SHOTGUN, 3)).toBe(1)
    expect(8 * SHOTGUN.damage * damageFalloff(SHOTGUN, 3)).toBe(8 * SHOTGUN.damage)
    expect(damageFalloff(SHOTGUN, 25)).toBeCloseTo(1 + (0.2 - 1) * (25 - 6) / (30 - 6), 6)
    expect(damageFalloff(SHOTGUN, 100)).toBe(0.2)
    expect(damageFalloff(SMG, 10)).toBe(1)
    expect(damageFalloff(SMG, 40)).toBe(0.6)
  })

  it('shotgun: same playerId + shotSeq → identical 8 ray directions across 2 runs', () => {
    const mk = () => Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])
    const a = mk(), b = mk()
    expect(computeShotDirs(a, makeRecoilState(), SHOTGUN, 7, 12, 0.4, 0.1, 4)).toBe(8)
    computeShotDirs(b, makeRecoilState(), SHOTGUN, 7, 12, 0.4, 0.1, 4)
    expect(a.slice(0, 8)).toEqual(b.slice(0, 8))
    expect(a[0]).not.toEqual(a[1])
  })

  it('knife: no ammo, no reload, holding the trigger slashes continuously per fireInterval, no spread/recoil', () => {
    const ws = makeWeaponState([KNIFE.id, -1, -1, -1])
    expect(ws.current).toBe(KNIFE.id)
    const ev = run(ws, 60, () => true)
    expect(ev.filter(x => x.e === 'fired').length).toBe(Math.ceil(1000 / KNIFE.fireIntervalMs))
    expect(ev.some(x => x.e === 'dry' || x.e === 'reloadStart')).toBe(false)
    expect(KNIFE.range).toBeCloseTo(2.2)
    const out: [number, number, number] = [0, 0, 0], rec = makeRecoilState()
    computeShot(out, rec, KNIFE, 1, 0, 0, 0, 0)
    expect(out).toEqual([-0, 0, -1])
    expect(rec).toEqual({ pitch: 0, yaw: 0 })
  })

  it('knife: pressing R does not reload', () => {
    const ws = makeWeaponState([KNIFE.id, -1, -1, -1])
    expect(stepWeapon(ws, 0, false, true)).toBe('none')
  })

  it('moveSpeedMul: knife is faster than AK47; a fully scoped sniper is half as fast again (via adsT)', () => {
    const knife = makeWeaponState([KNIFE.id, -1, -1, -1]), ak = makeWeaponState(AK_SLOTS)
    expect(moveSpeedMul(knife)).toBeGreaterThan(moveSpeedMul(ak))
    const sn = makeWeaponState([-1, -1, -1, SNIPER.id])
    expect(moveSpeedMul(sn)).toBe(SNIPER.moveSpeedMul)
    expect(adsMoveFor(sn)!.moveMult).toBe(0.5)
  })

  it('cmd.weapon is a slot: switches only when the value changes; empty slots are ignored; a stale cmd does not pull back from the just-bought slot', () => {
    const ws = makeWeaponState([KNIFE.id, 2, -1, 0, -1])   // slot 3 = AK47
    const cmd = (seq: number, weapon: number) => ({ seq, buttons: 0, yaw: 0, pitch: 0, weapon })
    stepWeaponCmd(ws, cmd(0, 2))      // medium slot empty
    expect(ws.slot).toBe(3)
    stepWeaponCmd(ws, cmd(1, 0))      // dao
    expect(ws.current).toBe(KNIFE.id); expect(ws.slot).toBe(0)
    // server "buys" SMG in slot 2 and switches to it
    ws.slots[2] = SMG.id; ws.slot = 2; ws.current = SMG.id
    stepWeaponCmd(ws, cmd(2, 0))      // stale cmd still in flight (same slot 0): does not pull back to the knife
    expect(ws.current).toBe(SMG.id)
    stepWeaponCmd(ws, cmd(3, 2))      // client presses slot 2 → no-op (already held)
    expect(ws.current).toBe(SMG.id)
    stepWeaponCmd(ws, cmd(4, 3))
    expect(ws.current).toBe(0)
    expect(selectSlot(ws, 9, 0)).toBe(false)
    const copy = makeWeaponState(); copyWeaponState(copy, ws)
    expect(weaponStatesEqual(copy, ws)).toBe(true)
    copy.slots[2] = -1
    expect(weaponStatesEqual(copy, ws)).toBe(false)
  })

  it('movement: speedMul scales run speed; default 1 keeps the old behavior', () => {
    const flat = {
      moveCharacter: (pos: [number, number, number], d: [number, number, number]) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]] as [number, number, number], grounded: true, hitCeiling: false }),
      canStand: () => true, castRay: () => null, castSphere: () => null, debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }), dispose: () => {},
    }
    const speedAfter = (mul?: number) => {
      let st: PlayerState = { pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 }
      for (let i = 0; i < 180; i++) st = stepMovement(st, { seq: i, buttons: Btn.Forward, yaw: 0, pitch: 0, weapon: 0 }, flat, defaultMovement, DT, mul)
      return Math.hypot(st.vel[0], st.vel[2])
    }
    expect(speedAfter()).toBeCloseTo(speedAfter(1), 9)
    expect(speedAfter(1.1)).toBeCloseTo(defaultMovement.runSpeed * 1.1, 1)
    expect(speedAfter(0.92)).toBeCloseTo(defaultMovement.runSpeed * 0.92, 1)
  })
})
