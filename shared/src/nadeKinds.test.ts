import { describe, it, expect } from 'vitest'
import { Btn } from './movement'
import { GRENADE_ID, GRENADE_SLOT, SMOKE_ID, makeWeaponState, type WeaponState } from './weapons'
import { GRENADE, SMOKE, fuseMsOf, maxCarryOf, smokeRadiusAt } from './grenade'
import { stepWeaponCmd, otherNade } from './weaponLogic'
import { applyBuy, consumeGrenade, defaultLoadout, grenadeCount, loadoutWeaponIds, quoteBuy } from './economy'
import type { InputCmd } from './movement'

let seq = 0
const cmd = (buttons: number, weapon = 3): InputCmd => ({ seq: seq++, buttons, yaw: 0, pitch: 0, weapon })

/** Player with HE + smoke, holding a grenade (HE kind) */
function holdingBoth(): WeaponState {
  seq = 1000
  const ws = makeWeaponState([6, 2, -1, 1, GRENADE_ID])
  ws.ammo[GRENADE_ID] = 2; ws.ammo[SMOKE_ID] = 1
  stepWeaponCmd(ws, cmd(0, GRENADE_SLOT))   // key 4 (grenade slot)
  return ws
}

describe('grenade inventory: HE + smoke', () => {
  const buy = (money: number, lo = defaultLoadout('A'), key = 'smoke') => applyBuy(money, lo, key)!

  it('buy smoke $300, max 1; HE max 2; the two kinds are independent', () => {
    expect(maxCarryOf('smoke')).toBe(SMOKE.maxCarry); expect(maxCarryOf('m67')).toBe(GRENADE.maxCarry)
    const a = buy(2000)
    expect(a.money).toBe(1700); expect(grenadeCount(a.loadout, 'smoke')).toBe(1); expect(grenadeCount(a.loadout, 'm67')).toBe(0)
    const q = quoteBuy(a.money, a.loadout, 'smoke'); expect(q.ok).toBe(false); if (!q.ok) expect(q.reason).toBe('max_carry')
    const b = buy(a.money, a.loadout, 'm67')
    expect(grenadeCount(b.loadout, 'smoke')).toBe(1); expect(grenadeCount(b.loadout, 'm67')).toBe(1)
    const c = buy(b.money, b.loadout, 'm67'); expect(grenadeCount(c.loadout, 'm67')).toBe(2)
    expect(applyBuy(c.money, c.loadout, 'm67')).toBeNull()
  })

  it('grenade slot: key is the first kind with stock left (HE first); only smoke → smoke id', () => {
    const onlySmoke = buy(2000)
    expect(loadoutWeaponIds(onlySmoke.loadout)[GRENADE_SLOT]).toBe(SMOKE_ID)
    const both = buy(onlySmoke.money, onlySmoke.loadout, 'm67')
    expect(loadoutWeaponIds(both.loadout)[GRENADE_SLOT]).toBe(GRENADE_ID)
  })

  it('consumeGrenade decrements the right kind; an exhausted kind leaves the slot; all gone → slot empty', () => {
    const b = buy(buy(2000).money, buy(2000).loadout, 'm67')
    const afterHe = consumeGrenade(b.loadout, 'm67')
    expect(grenadeCount(afterHe, 'm67')).toBe(0); expect(grenadeCount(afterHe, 'smoke')).toBe(1)
    expect(loadoutWeaponIds(afterHe)[GRENADE_SLOT]).toBe(SMOKE_ID)
    const none = consumeGrenade(afterHe, 'smoke')
    expect(none.slots[GRENADE_SLOT]).toBeNull()
    expect(consumeGrenade(none, 'smoke')).toBe(none)
  })
})

describe('grenade kind selection (like CS 1.6)', () => {
  it('pressing the grenade key again (CycleNade, rising edge) switches HE ↔ smoke; holding the button does not keep switching', () => {
    const ws = holdingBoth()
    expect(ws.current).toBe(GRENADE_ID)
    expect(stepWeaponCmd(ws, cmd(Btn.CycleNade, GRENADE_SLOT))).toBe('switched')
    expect(ws.current).toBe(SMOKE_ID); expect(ws.slots[GRENADE_SLOT]).toBe(SMOKE_ID)
    stepWeaponCmd(ws, cmd(Btn.CycleNade, GRENADE_SLOT))   // still held: no further switch
    expect(ws.current).toBe(SMOKE_ID)
    stepWeaponCmd(ws, cmd(0, GRENADE_SLOT))
    stepWeaponCmd(ws, cmd(Btn.CycleNade, GRENADE_SLOT))
    expect(ws.current).toBe(GRENADE_ID)
  })

  it('only one kind: pressing again changes nothing', () => {
    const ws = holdingBoth(); ws.ammo[SMOKE_ID] = 0
    stepWeaponCmd(ws, cmd(Btn.CycleNade, GRENADE_SLOT))
    expect(ws.current).toBe(GRENADE_ID)
    expect(otherNade(ws, GRENADE_ID)).toBe(-1)
  })

  it('no kind switch while pulling the pin', () => {
    const ws = holdingBoth()
    stepWeaponCmd(ws, cmd(Btn.Fire, GRENADE_SLOT))
    expect(ws.nade.phase).toBe('pulling')
    stepWeaponCmd(ws, cmd(Btn.Fire | Btn.CycleNade, GRENADE_SLOT))
    expect(ws.current).toBe(GRENADE_ID)
  })

  it('throwing smoke: decrements smoke ammo, leaves HE alone; when smoke runs out the slot switches back to HE', () => {
    const ws = holdingBoth()
    stepWeaponCmd(ws, cmd(Btn.CycleNade, GRENADE_SLOT)); stepWeaponCmd(ws, cmd(0, GRENADE_SLOT))
    let ev = 'none'
    for (let i = 0; i < 40 && ev !== 'pull'; i++) ev = stepWeaponCmd(ws, cmd(Btn.Fire, GRENADE_SLOT))
    for (let i = 0; i < 60; i++) stepWeaponCmd(ws, cmd(Btn.Fire, GRENADE_SLOT))   // hold until ready
    expect(ws.nade.phase).toBe('ready')
    expect(stepWeaponCmd(ws, cmd(0, GRENADE_SLOT))).toBe('threw')
    expect(ws.ammo[SMOKE_ID]).toBe(0); expect(ws.ammo[GRENADE_ID]).toBe(2)
    expect(ws.slots[GRENADE_SLOT]).toBe(GRENADE_ID)
    expect(ws.current).toBe(SMOKE_ID)   // the just-thrown grenade stays in hand until the auto-switch back (the server uses ws.current to know the kind)
  })

  it('G quick-throw uses the selected kind (smoke)', () => {
    seq = 2000
    const ws = makeWeaponState([6, 2, -1, 1, SMOKE_ID]); ws.ammo[SMOKE_ID] = 1
    expect(stepWeaponCmd(ws, cmd(Btn.QuickNade, 3))).toBe('pull')
    expect(ws.current).toBe(SMOKE_ID)
  })
})

describe('smoke cloud', () => {
  it('expands with ease-out then holds, fades at the end, expired = 0', () => {
    expect(smokeRadiusAt(-1)).toBe(0)
    expect(smokeRadiusAt(0)).toBe(0)
    expect(smokeRadiusAt(SMOKE.bloomMs / 2)).toBeGreaterThan(SMOKE.radius * 0.5)
    expect(smokeRadiusAt(SMOKE.bloomMs)).toBeCloseTo(SMOKE.radius)
    expect(smokeRadiusAt(SMOKE.durationMs / 2)).toBeCloseTo(SMOKE.radius)
    expect(smokeRadiusAt(SMOKE.durationMs - 100)).toBeLessThan(SMOKE.radius * 0.6)
    expect(smokeRadiusAt(SMOKE.durationMs)).toBe(0)
  })
  it('fuse by kind', () => {
    expect(fuseMsOf('m67')).toBe(GRENADE.fuseMs); expect(fuseMsOf('smoke')).toBe(SMOKE.fuseMs)
  })
})
