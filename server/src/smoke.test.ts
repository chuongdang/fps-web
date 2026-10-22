import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { Btn, GRENADE_ID, GRENADE_SLOT, MATCH, MatchPhase, MsgType, SMOKE, SMOKE_ID, applyBuy, defaultMovement, loadMap, loadoutWeaponIds, weaponByKey, type AnyMsg, type InputCmd, type MapFile, type Transport, type TeamId } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { enqueueCmds, stepPlayer } from './simulation'
import { explode, createGrenade, stepGrenades } from './grenades'
import { addSmoke, pruneSmokes, smokeBlocks } from './smoke'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
const flat: CollisionWorld = {
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true,
  castRay: () => null,
  castSphere: (o, d, max, r) => { if (d[1] >= -1e-9) return null; const t = (o[1] - r) / -d[1]; return t >= 0 && t <= max ? { dist: t, normal: [0, 1, 0] } : null },
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}

function setup() {
  const rm = new RoomManager(map, () => 0, { ...MATCH, minPlayersToStart: 99 })
  const mk = (name: string, team: TeamId) => {
    const msgs: AnyMsg[] = []
    const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', name, t, 0, team)
    player.world = flat
    return { p: player, msgs }
  }
  const a = mk('a', 'A'), b = mk('b', 'B')
  const room = rm.rooms.get('r')!
  room.phase = MatchPhase.Playing
  a.p.team = 'A'; b.p.team = 'B'
  for (const x of [a, b]) x.p.invulnUntil = 0
  return { room, a, b }
}
const at = (p: Player, x: number, y: number, z: number) => { p.state.pos = [x, y, z] }

describe('smoke grenade (server)', () => {
  it('smoke burst: no damage, no knockback, whole room told kind=smoke, creates a smoke cloud', () => {
    const { room, a, b } = setup()
    at(a.p, -25, 0, 0); at(b.p, 0.5, 0, 0)
    const hits = explode(room, { id: 7, ownerId: a.p.id, team: 'A', pos: [0, 0.05, 0], kind: 'smoke' })
    expect(hits).toEqual([])
    expect(b.p.hp).toBe(100); expect(b.p.state.vel).toEqual([0, 0, 0])
    const m = b.msgs.filter(x => x.t === MsgType.GrenadeExplode)
    expect(m).toHaveLength(1); expect(m[0]).toMatchObject({ kind: 'smoke', hits: [] })
    expect(b.msgs.some(x => x.t === MsgType.Hurt)).toBe(false)
    expect(room.smokes).toHaveLength(1)
  })

  it('smoke fuse is shorter than HE and the smoke grenade kind is reported in GrenadeSpawn', () => {
    const { room, a } = setup()
    const he = createGrenade(room, a.p.id, 'A', [0, 1, 0], [0, 0, 0], 'lob', 1)
    const sm = createGrenade(room, a.p.id, 'A', [0, 1, 0], [0, 0, 0], 'lob', 2, 'smoke')
    expect(sm.explodeTick).toBeLessThan(he.explodeTick)
    const spawns = a.msgs.filter(x => x.t === MsgType.GrenadeSpawn) as { kind?: string }[]
    expect(spawns[0]!.kind).toBeUndefined(); expect(spawns[1]!.kind).toBe('smoke')
  })

  it('stepGrenades: a smoke grenade at fuse end releases smoke, not an HE blast', () => {
    const { room, a } = setup()
    createGrenade(room, a.p.id, 'A', [0, 0.05, 0], [0, 0, 0], 'lob', 1, 'smoke')
    for (let i = 0; i < 200 && room.smokes.length === 0; i++) { room.tick++; stepGrenades(room) }
    expect(room.smokes).toHaveLength(1); expect(room.grenades).toHaveLength(0)
  })

  it('smoke blocks vision: a segment through the cloud is blocked, outside/around is not; it expands gradually and is removed on expiry', () => {
    const { room } = setup()
    room.serverNow = 1000
    addSmoke(room, 1, [0, 0, 0])
    const through = smokeBlocks(room, [-10, 1, 0], [10, 1, 0])
    expect(through).toBe(false)   // just released: radius 0 (not expanded yet)
    room.serverNow = 1000 + SMOKE.bloomMs
    expect(smokeBlocks(room, [-10, SMOKE.centerLift, 0], [10, SMOKE.centerLift, 0])).toBe(true)
    expect(smokeBlocks(room, [-10, SMOKE.centerLift, SMOKE.radius + 1], [10, SMOKE.centerLift, SMOKE.radius + 1])).toBe(false)
    expect(smokeBlocks(room, [-10, 1, 0], [-SMOKE.radius - 1, 1, 0])).toBe(false)   // the segment stops before reaching the smoke
    expect(smokeBlocks(room, [-10, 1, 0], [-2, 1, 0])).toBe(true)        // an endpoint inside the smoke is also blocked
    room.serverNow = 1000 + SMOKE.durationMs
    pruneSmokes(room)
    expect(room.smokes).toHaveLength(0)
  })

  it('buy smoke then throw via cmd: only the smoke is deducted, HE untouched, the flying grenade is smoke', () => {
    const { room, a } = setup()
    const p = a.p
    at(p, -25, 0, 0)
    let r = applyBuy(5000, p.loadout, 'smoke')!; p.loadout = r.loadout
    r = applyBuy(r.money, p.loadout, 'm67')!; p.loadout = r.loadout
    room.equip(p)
    expect(p.weapon.ammo[SMOKE_ID]).toBe(1); expect(p.weapon.ammo[GRENADE_ID]).toBe(1)
    expect(loadoutWeaponIds(p.loadout)[GRENADE_SLOT]).toBe(GRENADE_ID)
    let seq = 1
    const cmd = (buttons: number, weapon: number): InputCmd => ({ seq: seq++, buttons, yaw: 0, pitch: 0, weapon })
    const run = (c: InputCmd) => { enqueueCmds(p, [c], c.seq * 1000 / 60 + 1e6); stepPlayer(p, defaultMovement, room) }
    run(cmd(0, GRENADE_SLOT)); run(cmd(0, GRENADE_SLOT))                    // grenade key: equips HE
    expect(p.weapon.current).toBe(GRENADE_ID)
    run(cmd(Btn.CycleNade, GRENADE_SLOT)); run(cmd(0, GRENADE_SLOT))        // press again: smoke
    expect(p.weapon.current).toBe(SMOKE_ID)
    for (let i = 0; i < 40; i++) run(cmd(Btn.Fire, GRENADE_SLOT))           // hold left mouse: pin pulled
    run(cmd(0, GRENADE_SLOT))                                               // release = throw
    expect(room.grenades).toHaveLength(1); expect(room.grenades[0]!.kind).toBe('smoke')
    expect(p.weapon.ammo[SMOKE_ID]).toBe(0); expect(p.weapon.ammo[GRENADE_ID]).toBe(1)
    expect(p.loadout.slots[GRENADE_SLOT]).toMatchObject({ key: 'm67', counts: { m67: 1 } })
    expect(weaponByKey('smoke')!.consumable).toBe(true)
  })
})
