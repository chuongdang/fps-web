import { describe, it, expect } from 'vitest'
import { Btn, GRENADE, GRENADE_ID, GRENADE_SLOT, makeWeaponState, stepWeaponCmd, type InputCmd, type WeaponState, type WeaponEvent } from './index'

// Player has Knife (slot 0), Colt (slot 1), M16 (slot 3) + `n` grenades (slot 4)
function player(n: number): WeaponState {
  const ws = makeWeaponState([6, 2, -1, 1, n > 0 ? GRENADE_ID : -1])
  ws.ammo[GRENADE_ID] = n
  return ws
}
let seq = 0
let wanted = 3   // slot the client requests in cmd.weapon (G / auto-switch do not change this value)
const ms = (t: number) => Math.round(t * 60 / 1000)   // ms → tick count
function run(ws: WeaponState, buttons: number, ticks: number, weapon?: number): WeaponEvent[] {
  if (weapon !== undefined) wanted = weapon
  const evs: WeaponEvent[] = []
  for (let i = 0; i < ticks; i++) {
    const cmd: InputCmd = { seq: seq++, buttons, yaw: 0, pitch: 0, weapon: wanted }
    const e = stepWeaponCmd(ws, cmd)
    if (e !== 'none') evs.push(e)
  }
  return evs
}
const pull = ms(GRENADE.pinPullMs) + 2   // enough to finish pulling the pin

describe('grenade throwing (G.3): state machine shared by client/server', () => {
  it('key 5 holds a grenade; Fire held ≥ 0.35s then released = strong throw, then count drops by 1', () => {
    wanted = 3; seq = 1000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    expect(ws.current).toBe(GRENADE_ID)
    const a = run(ws, Btn.Fire, 1); expect(a).toEqual(['pull']); expect(ws.nade.phase).toBe('pulling'); expect(ws.nade.mode).toBe('strong')
    run(ws, Btn.Fire, pull); expect(ws.nade.phase).toBe('ready')
    const b = run(ws, 0, 1); expect(b).toEqual(['threw'])
    expect(ws.ammo[GRENADE_ID]).toBe(1); expect(ws.throwSeq).toBe(1); expect(ws.nade.phase).toBe('idle')
    expect(ws.current).toBe(GRENADE_ID)   // grenades left: still held
  })

  it('right mouse = low throw (lob)', () => {
    wanted = 3; seq = 2000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    run(ws, Btn.Aim, 1); expect(ws.nade.mode).toBe('lob')
    run(ws, Btn.Aim, pull)
    expect(run(ws, 0, 1)).toEqual(['threw']); expect(ws.nade.mode).toBe('lob')
  })

  it('hold 0.2s then release: no throw, grenades intact', () => {
    wanted = 3; seq = 3000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    run(ws, Btn.Fire, ms(200))
    expect(run(ws, 0, 1)).toEqual(['cancel'])
    expect(ws.ammo[GRENADE_ID]).toBe(2); expect(ws.nade.phase).toBe('idle'); expect(ws.throwSeq).toBe(0)
  })

  it('spamming Fire continuously (held, never released): only one pin pull, never throws more than owned', () => {
    wanted = 3; seq = 4000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    const evs = run(ws, Btn.Fire, 600)   // hold the mouse for 10 seconds
    expect(evs.filter(e => e === 'pull')).toHaveLength(1); expect(evs).not.toContain('threw')
    expect(ws.ammo[GRENADE_ID]).toBe(2)
    // continuous press-release (every 2 ticks): still at most 2 grenades
    let threw = 0
    for (let i = 0; i < 200; i++) { threw += run(ws, Btn.Fire, pull).filter(e => e === 'threw').length; threw += run(ws, 0, 1).filter(e => e === 'threw').length }
    expect(threw).toBe(2); expect(ws.ammo[GRENADE_ID]).toBe(0)
  })

  it('on cooldown after a throw: pressing right away does not pull the pin', () => {
    wanted = 3; seq = 5000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    run(ws, Btn.Fire, pull); run(ws, 0, 1)
    expect(run(ws, Btn.Fire, 1)).toEqual([])          // < throwCooldownMs
    run(ws, 0, 1)
    run(ws, 0, ms(GRENADE.throwCooldownMs))
    expect(run(ws, Btn.Fire, 1)).toEqual(['pull'])
  })

  it('last grenade: slot empty, after autoSwitchBackMs auto-switches to the previous gun', () => {
    wanted = 3; seq = 6000
    const ws = player(1)
    run(ws, 0, 1, 3)   // M16
    run(ws, 0, 1, GRENADE_SLOT)
    expect(ws.prevSlot).toBe(3)
    run(ws, Btn.Fire, pull); run(ws, 0, 1)
    expect(ws.ammo[GRENADE_ID]).toBe(0); expect(ws.slots[GRENADE_SLOT]).toBe(-1)
    run(ws, 0, ms(GRENADE.autoSwitchBackMs) + 2, GRENADE_SLOT)
    expect(ws.current).toBe(1); expect(ws.slot).toBe(3)
  })

  it('switching guns while pulling the pin: cancels, no grenade lost', () => {
    wanted = 3; seq = 7000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    run(ws, Btn.Fire, ms(100))
    expect(ws.nade.phase).toBe('pulling')
    run(ws, Btn.Fire, 1, 3)   // press key 4 (M16)
    expect(ws.current).toBe(1); expect(ws.nade.phase).toBe('idle'); expect(ws.ammo[GRENADE_ID]).toBe(2)
  })

  it('G: equips + pulls the pin right away; hold long enough then release = strong throw, then auto-returns to the previous gun', () => {
    wanted = 3; seq = 8000
    const ws = player(2)
    run(ws, 0, 1, 3)
    expect(run(ws, Btn.QuickNade, 1)).toEqual(['pull'])
    expect(ws.current).toBe(GRENADE_ID); expect(ws.nade.quick).toBe(true); expect(ws.prevSlot).toBe(3)
    run(ws, Btn.QuickNade, pull); expect(ws.nade.phase).toBe('ready')
    expect(run(ws, 0, 1)).toEqual(['threw'])
    run(ws, 0, ms(GRENADE.autoSwitchBackMs) + 2)
    expect(ws.current).toBe(1); expect(ws.ammo[GRENADE_ID]).toBe(1)   // 1 grenade left but back on the gun
  })

  it('G released early: cancels, returns to the old gun immediately, grenades intact', () => {
    wanted = 3; seq = 9000
    const ws = player(2)
    run(ws, 0, 1, 3)
    run(ws, Btn.QuickNade, ms(100))
    expect(run(ws, 0, 1)).toEqual(['cancel'])
    run(ws, 0, 2)
    expect(ws.current).toBe(1); expect(ws.ammo[GRENADE_ID]).toBe(2)
  })

  it('no grenades: G and key 5 do nothing', () => {
    wanted = 3; seq = 10000
    const ws = player(0)
    run(ws, 0, 1, 3)
    expect(run(ws, Btn.QuickNade, 5)).toEqual([]); expect(ws.current).toBe(1)
    run(ws, 0, 1, GRENADE_SLOT); expect(ws.current).toBe(1)
  })

  it('deterministic: two runs of the same cmd sequence give identical state (client prediction = server)', () => {
    wanted = 3; seq = 11000
    const a = player(2), b = player(2)
    const cmds: InputCmd[] = []
    for (let i = 0; i < 400; i++) cmds.push({ seq: seq++, buttons: (i % 90 < 30 ? Btn.Fire : 0) | (i % 130 > 100 ? Btn.Aim : 0), yaw: 0, pitch: 0, weapon: i > 5 ? GRENADE_SLOT : 3 })
    for (const c of cmds) { stepWeaponCmd(a, c); stepWeaponCmd(b, c); expect(JSON.stringify(a)).toBe(JSON.stringify(b)) }
  })
})
