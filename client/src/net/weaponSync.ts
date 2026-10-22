import { copyWeaponState, makeWeaponState, stepWeaponCmd, weaponStatesEqual, type InputCmd, type WeaponState } from '@fps/shared'

export const weaponSyncStats = { checks: 0, mismatches: 0 }

const tmp = makeWeaponState()

// Weapon reconcile works like position reconcile: set WeaponState = the server's (after cmd `ack`), replay the
// unacked cmds, then overwrite `ws` if different. State only (ammo, reload, fire rate); effects are not replayed.
// `pending` has already dropped cmds ≤ ack.
export function reconcileWeapon(ws: WeaponState, server: WeaponState, pending: readonly { cmd: InputCmd }[]): boolean {
  copyWeaponState(tmp, server)
  for (const p of pending) stepWeaponCmd(tmp, p.cmd)
  weaponSyncStats.checks++
  if (weaponStatesEqual(tmp, ws)) return false
  weaponSyncStats.mismatches++
  copyWeaponState(ws, tmp)
  return true
}
