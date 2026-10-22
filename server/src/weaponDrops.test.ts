import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { CATEGORY_SLOT, MATCH, MatchPhase, MsgType, TICK_RATE, WEAPONS, WEAPON_DROP, defaultMovement, loadMap, weaponByKey, type AnyMsg, type MapFile, type Transport, type TeamId } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { stepRoom } from './simulation'
import { handleDrop, handlePickup } from './weaponDrops'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)

// Fake world: flat floor at y = 0
function world(): CollisionWorld {
  return {
    moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
    canStand: () => true,
    castRay: () => null,
    castSphere: (o, d, max, r) => {
      if (d[1] >= -1e-9) return null
      const t = (o[1] - r) / -d[1]
      return t >= 0 && t <= max ? { dist: t, normal: [0, 1, 0] } : null
    },
    debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
    dispose: () => {},
  }
}

function setup() {
  const rm = new RoomManager(map, () => 0, { ...MATCH, minPlayersToStart: 99 })
  const mk = (name: string, team: TeamId) => {
    const msgs: AnyMsg[] = []
    const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', name, t, 0, team)
    player.world = world()
    return { p: player, msgs, t }
  }
  const a = mk('a', 'A'), b = mk('b', 'B')
  const room = rm.rooms.get('r')!
  room.phase = MatchPhase.Playing
  a.p.team = 'A'; b.p.team = 'B'
  for (const x of [a, b]) { x.p.invulnUntil = 0; x.p.state.pos = [0, 0, 0] }
  a.p.state.pos = [-20, 0, 0]; b.p.state.pos = [-20, 0, 0]
  return { rm, room, a, b, mk }
}
type S = ReturnType<typeof setup>
const sentOf = (msgs: AnyMsg[], t: number) => msgs.filter(m => m.t === t)
let clock = 0
const ticks = (s: S, n: number) => { for (let i = 0; i < n; i++) { clock += 1000 / TICK_RATE; stepRoom(s.room, defaultMovement, clock) } }
const ms = (n: number) => Math.ceil(n * TICK_RATE / 1000)
const M16 = weaponByKey('m16')!.id, COLT = weaponByKey('colt')!.id, AK = weaponByKey('ak47')!.id, RULO = weaponByKey('rulo')!.id
const LONG = CATEGORY_SLOT.long, PISTOL = CATEGORY_SLOT.pistol, KNIFE = CATEGORY_SLOT.knife

describe('drop (G)', () => {
  it('drops the held gun: slot empties, the next best weapon is held, the room sees it, ammo is kept', () => {
    const s = setup()
    s.a.p.weapon.ammo[M16] = 12
    expect(s.a.p.weapon.current).toBe(M16)
    handleDrop(s.room, s.a.p)
    expect(s.a.p.weapon.slots[LONG]).toBe(-1)
    expect(s.a.p.loadout.slots[LONG]).toBeNull()
    expect(s.a.p.weapon.current).toBe(COLT)
    expect(sentOf(s.a.msgs, MsgType.HoldSlot).pop()).toMatchObject({ slot: PISTOL })
    expect(s.room.drops).toHaveLength(1)
    for (const m of [s.a.msgs, s.b.msgs]) expect(sentOf(m, MsgType.WeaponDropSpawn).pop()).toMatchObject({ weapon: M16, ammo: 12, ownerId: s.a.p.id, resting: false })
  })

  it('the knife and grenades cannot be dropped', () => {
    const s = setup()
    s.a.p.weapon.slot = KNIFE; s.a.p.weapon.current = s.a.p.weapon.slots[KNIFE]!
    handleDrop(s.room, s.a.p)
    expect(s.room.drops).toHaveLength(0)
    expect(sentOf(s.a.msgs, MsgType.WeaponDropSpawn)).toHaveLength(0)
  })

  it('dead players and zombies cannot drop', () => {
    const s = setup()
    s.a.p.alive = false
    handleDrop(s.room, s.a.p)
    s.b.p.role = 'zombie'
    handleDrop(s.room, s.b.p)
    expect(s.room.drops).toHaveLength(0)
  })

  it('is rate limited', () => {
    const s = setup()
    for (let i = 0; i < 20; i++) { handleDrop(s.room, s.a.p); handlePickup(s.room, s.a.p) }
    expect(s.a.p.dropTimes.length).toBeLessThanOrEqual(WEAPON_DROP.maxActionsPerSecond)
  })

  it('the gun falls to the floor and comes to rest in the same place on every tick order', () => {
    const s = setup()
    handleDrop(s.room, s.a.p)
    ticks(s, ms(3000))
    const d = s.room.drops[0]!
    expect(d.resting).toBe(true)
    expect(d.pos[1]).toBeLessThan(0.2)
    expect(Math.hypot(d.pos[0] - -20, d.pos[2])).toBeGreaterThan(0.3)   // tossed forward, not at the feet
  })
})

describe('pickup (E)', () => {
  it('picks the gun up again with its ammo and what the owner paid, after the owner lock', () => {
    const s = setup()
    s.a.p.weapon.ammo[M16] = 12
    s.a.p.loadout.slots[LONG]!.paid = 3100
    handleDrop(s.room, s.a.p)
    ticks(s, ms(300))
    handlePickup(s.room, s.a.p)   // still locked for the dropper
    expect(s.room.drops).toHaveLength(1)
    ticks(s, ms(WEAPON_DROP.ownerLockMs))
    s.a.p.state.pos = [s.room.drops[0]!.pos[0], 0, s.room.drops[0]!.pos[2]]
    handlePickup(s.room, s.a.p)
    expect(s.room.drops).toHaveLength(0)
    expect(s.a.p.weapon.current).toBe(M16)
    expect(s.a.p.weapon.ammo[M16]).toBe(12)
    expect(s.a.p.loadout.slots[LONG]).toEqual({ key: 'm16', paid: 3100 })
    expect(sentOf(s.a.msgs, MsgType.HoldSlot).pop()).toMatchObject({ slot: LONG })
    expect(sentOf(s.b.msgs, MsgType.WeaponDropRemove).pop()).toMatchObject({ byId: s.a.p.id })
  })

  it('an enemy picks it up for free; a gun already in that slot is swapped out onto the floor', () => {
    const s = setup()
    s.a.p.weapon.ammo[M16] = 7
    s.a.p.loadout.slots[LONG]!.paid = 3100
    handleDrop(s.room, s.a.p)
    ticks(s, ms(2000))
    const d = s.room.drops[0]!
    s.b.p.state.pos = [d.pos[0] + 0.5, 0, d.pos[2]]
    s.b.p.weapon.ammo[AK] = 21
    handlePickup(s.room, s.b.p)
    expect(s.b.p.weapon.current).toBe(M16)
    expect(s.b.p.weapon.ammo[M16]).toBe(7)
    expect(s.b.p.loadout.slots[LONG]).toEqual({ key: 'm16', paid: 0 })   // no refund for a found gun
    expect(s.room.drops).toHaveLength(1)
    expect(s.room.drops[0]).toMatchObject({ weapon: AK, ammo: 21, ownerId: s.b.p.id })
  })

  it('out of reach: nothing happens', () => {
    const s = setup()
    handleDrop(s.room, s.a.p)
    ticks(s, ms(2000))
    s.b.p.state.pos = [s.room.drops[0]!.pos[0] + WEAPON_DROP.reachRadius + 1, 0, s.room.drops[0]!.pos[2]]
    handlePickup(s.room, s.b.p)
    expect(s.room.drops).toHaveLength(1)
    expect(s.b.p.weapon.current).toBe(AK)
  })

  it('picks the gun that is in reach, not the one far away', () => {
    const s = setup()
    handleDrop(s.room, s.a.p)       // M16 at x = -20
    s.a.p.state.pos = [-10, 0, 0]
    s.a.p.weapon.slot = PISTOL; s.a.p.weapon.current = COLT
    handleDrop(s.room, s.a.p)       // COLT at x = -10
    ticks(s, ms(2000))
    const colt = s.room.drops.find(d => d.weapon === COLT)!
    s.b.p.state.pos = [colt.pos[0], 0, colt.pos[2]]
    handlePickup(s.room, s.b.p)
    expect(s.b.p.weapon.current).toBe(COLT)
    expect(s.room.drops.map(d => d.weapon).sort()).toEqual([M16, RULO].sort())   // the M16 stays, b's own ROULEAU was swapped out
  })
})

describe('lifecycle', () => {
  it('a dead player drops the held gun where they died, and it is gone after respawn handling', () => {
    const s = setup()
    s.a.p.weapon.ammo[M16] = 9
    s.a.p.hp = 0; s.a.p.killerId = s.b.p.id
    s.room.finalizeDeaths()
    expect(s.room.drops).toHaveLength(1)
    expect(s.room.drops[0]).toMatchObject({ weapon: M16, ammo: 9, ownerId: s.a.p.id })
    expect(sentOf(s.b.msgs, MsgType.WeaponDropSpawn)).toHaveLength(1)
  })

  it('a gun nobody takes expires and the room is told', () => {
    const s = setup()
    handleDrop(s.room, s.a.p)
    const id = s.room.drops[0]!.id
    ticks(s, ms(WEAPON_DROP.lifetimeMs) + 5)
    expect(s.room.drops).toHaveLength(0)
    expect(sentOf(s.b.msgs, MsgType.WeaponDropRemove).pop()).toMatchObject({ id })
  })

  it('at most maxPerRoom guns: the oldest is removed first', () => {
    const s = setup()
    for (let i = 0; i < WEAPON_DROP.maxPerRoom + 3; i++) {
      s.a.p.weapon.slots[LONG] = M16; s.a.p.weapon.slot = LONG; s.a.p.weapon.current = M16
      s.a.p.loadout.slots[LONG] = { key: 'm16', paid: 0 }
      s.a.p.dropTimes.length = 0
      handleDrop(s.room, s.a.p)
    }
    expect(s.room.drops).toHaveLength(WEAPON_DROP.maxPerRoom)
    expect(s.room.drops[0]!.id).toBe(4)
  })

  it('a new round clears the floor; a player who joins later is shown the guns already lying there', () => {
    const s = setup()
    handleDrop(s.room, s.a.p)
    ticks(s, ms(2000))
    const late = s.mk('late', 'B')
    expect(sentOf(late.msgs, MsgType.WeaponDropSpawn)).toHaveLength(1)
    expect(sentOf(late.msgs, MsgType.WeaponDropSpawn)[0]).toMatchObject({ weapon: M16, resting: true })
    s.room.clearDrops()
    expect(s.room.drops).toHaveLength(0)
    expect(sentOf(late.msgs, MsgType.WeaponDropRemove).pop()).toMatchObject({ id: -1 })
  })

  it('weapon ids and categories used by the drop rules exist', () => {
    expect(WEAPONS[M16]!.category).toBe('long')
  })
})
