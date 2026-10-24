import { describe, it, expect } from 'vitest'
import { MsgType, makeWeaponState, stateToNet, type AnyMsg, type PlayerState, type SnapshotMsg, type Transport } from '@fps/shared'
import { attachSnapshots } from './snapshots'

const state: PlayerState = { pos: [1, 0, 2], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 }

function fake() {
  let cb: (m: AnyMsg) => void = () => {}
  const t: Transport = { send: () => {}, onMessage: c => { cb = c }, onClose: () => {} }
  return { t, emit: (m: SnapshotMsg) => cb(m) }
}
const snap = (tick: number, extra: Partial<SnapshotMsg> = {}): SnapshotMsg => ({ t: MsgType.Snapshot, tick, serverTime: tick * 50, ack: tick, players: [stateToNet(1, state)], ...extra })

describe('attachSnapshots', () => {
  it('keeps the last weapon state, loadout and money when a snapshot leaves them out (the server only sends changes)', () => {
    const { t, emit } = fake()
    const store = attachSnapshots(t, 1)
    const wpn = makeWeaponState(), loadout = [{ key: 'ak47', paid: 2500 }, null]
    emit(snap(1, { wpn, money: 900, loadout }))
    expect(store.wpn).toBe(wpn); expect(store.loadout).toBe(loadout); expect(store.money).toBe(900)
    emit(snap(2, { money: 900 }))
    expect(store.wpn).toBe(wpn); expect(store.loadout).toBe(loadout); expect(store.ack).toBe(2)
    const wpn2 = makeWeaponState()
    emit(snap(3, { wpn: wpn2, money: 450 }))
    expect(store.wpn).toBe(wpn2); expect(store.loadout).toBe(loadout); expect(store.money).toBe(450)
  })
  it('ignores an old or duplicate snapshot', () => {
    const { t, emit } = fake()
    const store = attachSnapshots(t, 1)
    emit(snap(5, { money: 1 })); emit(snap(4, { money: 2 })); emit(snap(5, { money: 3 }))
    expect(store.money).toBe(1)
  })
})
