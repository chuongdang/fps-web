import { MsgType, netToState, type NetPlayer, type OwnedWeapon, type PlayerState, type Transport, type WeaponState } from '@fps/shared'

// Latest snapshot from the server (task 3.4: the "dumb client" draws only this)
export interface SnapshotStore {
  yourId: number
  tick: number
  serverTime: number          // 0 = no snapshot received yet
  ack: number
  players: NetPlayer[]
  self: PlayerState | null    // our own state in the latest snapshot
  wpn: WeaponState | null     // our weapon (after the acked cmd)
  money: number               // our money (decided by the server)
  loadout: (OwnedWeapon | null)[] | null   // purchased weapons in the 4 slots
  hp: number                  // our HP
  flags: number               // our NetFlag flags (Dead/Invuln)
  me: NetPlayer | null        // our full NetPlayer (zombie: hpMax, runSpeed, leapCd...)
  count: number
  perSec: number              // snapshots received per second (updated every ~1s)
}

export function attachSnapshots(
  transport: Transport,
  yourId: number,
  onSnapshot?: (store: SnapshotStore) => void,
): SnapshotStore {
  const store: SnapshotStore = { yourId, tick: 0, serverTime: 0, ack: -1, players: [], self: null, wpn: null, money: 0, loadout: null, hp: 100, flags: 0, me: null, count: 0, perSec: 0 }
  let windowStart = performance.now()
  let windowCount = 0
  transport.onMessage(msg => {
    if (msg.t !== MsgType.Snapshot) return
    if (msg.tick <= store.tick) return   // old or duplicate
    store.tick = msg.tick
    store.serverTime = msg.serverTime
    store.ack = msg.ack
    store.players = msg.players
    store.count++
    windowCount++
    const now = performance.now()
    if (now - windowStart >= 1000) {
      store.perSec = windowCount * 1000 / (now - windowStart)
      windowStart = now; windowCount = 0
    }
    const me = msg.players.find(p => p.id === yourId)
    store.self = me ? netToState(me) : null
    store.wpn = msg.wpn ?? null
    store.money = msg.money ?? store.money
    store.loadout = msg.loadout ?? store.loadout
    store.hp = me?.hp ?? store.hp
    store.flags = me?.flags ?? 0
    store.me = me ?? null
    onSnapshot?.(store)
  })
  return store
}
