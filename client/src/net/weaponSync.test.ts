import { describe, it, expect, beforeEach } from 'vitest'
import { Btn, makeWeaponState, stepWeaponCmd, type InputCmd } from '@fps/shared'
import { reconcileWeapon, weaponSyncStats } from './weaponSync'

const AK = [6, 2, -1, 0, -1]   // AK47 in slot 3, slot 4 (grenade) empty
const cmd = (seq: number, buttons: number, weapon = 3): InputCmd => ({ seq, buttons, yaw: 0, pitch: 0, weapon })

describe('reconcileWeapon', () => {
  beforeEach(() => { weaponSyncStats.checks = 0; weaponSyncStats.mismatches = 0 })

  it('client and server run the same cmd sequence: no drift', () => {
    const client = makeWeaponState(AK), server = makeWeaponState(AK)
    const cmds = Array.from({ length: 90 }, (_, i) => cmd(i, Btn.Fire))
    for (const c of cmds) stepWeaponCmd(client, c)
    for (const c of cmds.slice(0, 40)) stepWeaponCmd(server, c)   // server has only reached cmd 39
    const pending = cmds.slice(40).map(c => ({ cmd: c }))
    expect(reconcileWeapon(client, server, pending)).toBe(false)
    expect(weaponSyncStats.mismatches).toBe(0)
  })

  it('server rejects a shot: client corrects ammo to match the server', () => {
    const client = makeWeaponState(AK), server = makeWeaponState(AK)
    const cmds = Array.from({ length: 30 }, (_, i) => cmd(i, Btn.Fire))
    for (const c of cmds) stepWeaponCmd(client, c)
    // server did not fire at cmd 0 because it is assumed to be reloading
    server.reloadEndMs = 100
    server.ammo[0] = 20
    expect(reconcileWeapon(client, server, cmds.map(c => ({ cmd: c })))).toBe(true)
    expect(client.ammo[0]).toBeGreaterThan(20)   // the server's reload finishes at 100ms, then it keeps firing
    expect(weaponSyncStats.mismatches).toBe(1)
  })
})
