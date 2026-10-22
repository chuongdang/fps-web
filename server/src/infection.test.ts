import { describe, it, expect } from 'vitest'
import { Btn, INFECTION, MATCH, MatchPhase, MsgType, NetFlag, defaultMovement, loadMap, type AnyMsg, type MapFile, type Transport, type RoomOptions } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from './room'
import { enqueueCmds, stepRoom, sendSnapshots } from './simulation'
import { handleDebugCmd } from './debugCmds'
import { handleBuy } from './shop'
import type { InfectionMode } from './modes/infection'

const map = loadMap({
  name: 't', mirrorX: true, boxes: [], ramps: [],
  spawnsA: [{ pos: [-25, 0, 0], yaw: 0 }, { pos: [-25, 0, 4], yaw: 0 }, { pos: [-25, 0, -4], yaw: 0 }],
  buyZoneA: { min: [-30, -1, -20], max: [-19, 3, 20] },
} as MapFile)
const flat: CollisionWorld = {
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true, castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}
const OPTS: RoomOptions = { mode: 'infection', settings: { rounds: 2, roundTimeSec: 60 } }

function setup(n = 3) {
  const rm = new RoomManager(map, () => 0, MATCH)
  const msgs = new Map<number, AnyMsg[]>()
  const players: Player[] = []
  const join = (name: string) => {
    const list: AnyMsg[] = []
    const t: Transport = { send: m => { list.push(m) }, onMessage: () => {}, onClose: () => {} }
    const res = rm.tryJoin('r', name, t, 0, 'auto', undefined, undefined, OPTS)!
    res.player.world = flat
    msgs.set(res.player.id, list)
    players.push(res.player)
    return res.player
  }
  for (let i = 0; i < n; i++) join(`p${i}`)
  const room = rm.rooms.get('r')!
  const m = room.mode as InfectionMode
  m.s.prepSec = 2; m.s.roundEndSec = 1; m.s.matchEndSec = 1
  return { rm, room, m, players, join, msgs }
}
const run = (room: Room, ms: number) => { const to = room.serverNow + ms; for (let t = room.serverNow + 16; t <= to; t += 16) stepRoom(room, defaultMovement, t) }
const sent = (msgs: Map<number, AnyMsg[]>, id: number, t: number) => msgs.get(id)!.filter(m => m.t === t)
const zombiesOf = (room: Room) => [...room.players.values()].filter(p => p.role === 'zombie')
const humansOf = (room: Room) => [...room.players.values()].filter(p => p.role === 'human')

/** Enter LIVE: PREP 2s then the mother is picked; wait out invulnerability/transformation */
function toLive() {
  const s = setup()
  run(s.room, 100)
  expect(s.room.phase).toBe(MatchPhase.Prep)
  run(s.room, 2100)
  expect(s.room.phase).toBe(MatchPhase.Playing)
  run(s.room, INFECTION.transformMs + INFECTION.pickMs + 100)
  return s
}
const claw = (z: Player, seq: number, extra = 0) => enqueueCmds(z, [{ seq, buttons: Btn.Fire | extra, yaw: 0, pitch: 0, weapon: 0 }], 0)

describe('Infection - phases (I.1)', () => {
  it('needs >= 3 players: 2 players stay in WARMUP, the 3rd joins -> PREP', () => {
    const s = setup(2)
    run(s.room, 100)
    expect(s.room.phase).toBe(MatchPhase.Waiting)
    s.join('p3')
    run(s.room, 100)
    expect(s.room.phase).toBe(MatchPhase.Prep)
  })

  it('PREP: everyone is a human on team A, money $6000, scattered everywhere; can buy anywhere', () => {
    const s = setup()
    run(s.room, 100)
    for (const p of s.players) { expect(p.role).toBe('human'); expect(p.team).toBe('A'); expect(p.money).toBe(INFECTION.startMoney) }
    const p = s.players[0]!
    p.state.pos = [20, 0, 10]   // xa khu mua
    handleBuy(s.room, p, 'ak47')
    expect(p.loadout.slots[3]?.key).toBe('ak47')
    expect(sent(s.msgs, p.id, MsgType.BuyResult).pop()).toMatchObject({ ok: true })
  })

  it('PREP over: 1 mother zombie (3 players), whole room receives Infected(mother), mother is invulnerable while transforming, hp scales with player count', () => {
    const s = setup()
    run(s.room, 2200)
    const zs = zombiesOf(s.room)
    expect(zs.length).toBe(1)
    const mom = zs[0]!
    expect(mom.zstats!.type).toBe('mother')
    expect(mom.zstats!.hpMax).toBe(INFECTION.mother.hpBase + INFECTION.mother.hpPerHuman * 2)
    expect(mom.team).toBe('B')
    for (const p of s.players) expect(sent(s.msgs, p.id, MsgType.Infected).some(m => (m as { playerId: number }).playerId === mom.id && (m as { kind: string }).kind === 'mother')).toBe(true)
    expect(s.room.serverNow).toBeLessThan(mom.invulnUntil)
  })

  it('does not re-pick the previous round mother', () => {
    const s = setup(3)
    run(s.room, 2200)
    const first = zombiesOf(s.room)[0]!.id
    // force the next round
    s.m.devEndRound(s.room, 'A')
    run(s.room, 1100)   // RoundEnd -> PREP round 2
    expect(s.room.phase).toBe(MatchPhase.Prep)
    run(s.room, 2100)
    expect(zombiesOf(s.room)[0]!.id).not.toBe(first)
  })

  it('zombie claws enough times -> the human turns into a zombie in place, stands up after transformMs, can claw others', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const [v1, v2] = humansOf(s.room)
    mom.state.pos = [0, 0, 0]; v1!.state.pos = [0, 0, -1.5]; v2!.state.pos = [30, 0, 30]
    let seq = 1000
    const hits = Math.ceil(100 / INFECTION.mother.clawDamage)   // number of hits to take 100 hp
    for (let i = 0; i < hits; i++) {
      v1!.state.pos = [0, 0, -1.5]; v1!.state.vel = [0, 0, 0]   // claws knock back: reset the position for each hit
      enqueueCmds(mom, [{ seq: seq++, buttons: Btn.Fire, yaw: 0, pitch: 0, weapon: 0 }], s.room.serverNow); run(s.room, 16)   // real nowMs: the server rejects cmds too far ahead of the clock
      if (i === 0) expect(v1!.hp).toBe(100 - INFECTION.mother.clawDamage)
      if (i < hits - 1) { run(s.room, 750); seq += 45 }   // weapon timing is based on seq (60 cmd/s)
    }
    expect(v1!.role).toBe('zombie')                     // infected in place, not dead
    expect(v1!.alive).toBe(true)
    expect(v1!.state.pos[2]).toBeCloseTo(-1.5, 1)
    expect(v1!.zstats!.type).toBe('normal')
    expect(v1!.team).toBe('B')
    expect(s.m.humans(s.room)).toBe(1)
    expect(sent(s.msgs, v2!.id, MsgType.Infected).some(m => (m as { kind: string }).kind === 'infected' && (m as { byId: number }).byId === mom.id)).toBe(true)
    expect(s.room.serverNow).toBeLessThan(v1!.transformUntil)
    // cannot claw while transforming
    v2!.state.pos = [0, 0, -3]; v1!.state.pos = [0, 0, -1.5]; mom.state.pos = [0, 0, 0]
    claw(v1!, 5000); run(s.room, 16)
    expect(v2!.hp).toBe(INFECTION.hero.hp)   // v2 is the last human -> hero
    run(s.room, INFECTION.transformMs + 100)
    claw(v1!, 5050)
    v2!.state.pos = [0, 0, -3 + v1!.state.pos[2] + 1.5]   // placed within v1's claw range
    v2!.state.pos = [v1!.state.pos[0], 0, v1!.state.pos[2] - 1.5]
    run(s.room, 16)
    expect(v2!.hp).toBeLessThan(INFECTION.hero.hp)
  })

  it('infection points: the infector gets +1 (+1 more if mother zombie); scoreboard has pts/inf/role columns', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const v = humansOf(s.room)[0]!
    v.hp = 0; v.killerId = mom.id
    run(s.room, 32)
    expect(v.role).toBe('zombie')
    const row: { pts?: number; inf?: number; role?: string } = {}
    s.m.scoreboardRow(s.room, mom, row as never)
    expect(row.inf).toBe(1)
    expect(row.pts).toBe(INFECTION.points.infect + INFECTION.points.mother)
    expect(row.role).toBe('zombie')
  })

  it('shooting a zombie dead: the human gets +2 points; 5s later the zombie respawns farthest from humans', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const [h1, h2] = humansOf(s.room)
    h1!.state.pos = [-25, 0, 0]; h2!.state.pos = [-25, 0, 4]; mom.state.pos = [-25, 0, -3]
    mom.hp = 0; mom.killerId = h1!.id
    run(s.room, 32)
    expect(mom.alive).toBe(false)
    const row: { pts?: number; zk?: number } = {}
    s.m.scoreboardRow(s.room, h1!, row as never)
    expect(row.zk).toBe(1)
    expect(row.pts).toBe(INFECTION.points.killZombie)
    run(s.room, INFECTION.zombieRespawnMs - 200)
    expect(mom.alive).toBe(false)
    run(s.room, 400)
    expect(mom.alive).toBe(true)
    expect(mom.role).toBe('zombie')
    expect(mom.hp).toBe(mom.zstats!.hpMax)
    const dNear = Math.min(...[h1!, h2!].map(h => Math.hypot(h.state.pos[0] - mom.state.pos[0], h.state.pos[2] - mom.state.pos[2])))
    expect(dNear).toBeGreaterThan(3)
  })

  it('exactly 1 human left -> hero: hp 200, Hero flag; zombie hp shrinks with player count', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const [v1, v2] = humansOf(s.room)
    const before = mom.zstats!.hpMax
    v1!.hp = 0; v1!.killerId = mom.id
    run(s.room, 32)
    expect(mom.zstats!.hpMax).toBe(before - INFECTION.mother.hpPerHuman)
    expect(v2!.hero).toBe(true)
    expect(v2!.hp).toBe(INFECTION.hero.hp)
    expect(v2!.damageMult).toBe(INFECTION.hero.damageMult)
    expect(sent(s.msgs, v1!.id, MsgType.HeroChosen).length).toBe(1)
    sendSnapshots(s.room, 0, s.room.serverNow)
    const snap = sent(s.msgs, v2!.id, MsgType.Snapshot).pop() as { players: { id: number; flags: number }[] }
    expect(snap.players.find(p => p.id === v2!.id)!.flags & NetFlag.Hero).toBeTruthy()
  })

  it('everyone infected -> zombies win the round (RoundEnd winner B); time up with humans left -> humans win, +3 points per survivor', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    for (const h of humansOf(s.room)) { h.hp = 0; h.killerId = mom.id }
    run(s.room, 64)
    expect(s.room.phase).toBe(MatchPhase.RoundEnd)
    expect(sent(s.msgs, mom.id, MsgType.RoundEnd).pop()).toMatchObject({ winner: 'B', reason: 'infected_all' })

    const t = toLive()
    t.room.phaseEndsAt = t.room.serverNow + 100
    run(t.room, 200)
    expect(t.room.phase).toBe(MatchPhase.RoundEnd)
    expect(sent(t.msgs, t.players[0]!.id, MsgType.RoundEnd).pop()).toMatchObject({ winner: 'A', reason: 'time_survive' })
    const h = humansOf(t.room)[0]!
    const row: { pts?: number } = {}
    t.m.scoreboardRow(t.room, h, row as never)
    expect(row.pts).toBe(INFECTION.points.surviveRound)
  })

  it('out of rounds: MATCH_END with the top scorer; then a new round', () => {
    const s = toLive()
    s.m.devEndRound(s.room, 'A')
    run(s.room, 1100)               // -> PREP round 2
    run(s.room, 2200)               // → LIVE
    s.m.devEndRound(s.room, 'A')
    run(s.room, 1100)               // both rounds done -> MATCH_END
    expect(s.room.phase).toBe(MatchPhase.Ended)
    expect(sent(s.msgs, s.players[0]!.id, MsgType.MatchEnd).length).toBe(1)
    run(s.room, 1100)
    expect(s.room.phase).toBe(MatchPhase.Prep)
    expect(s.m.round).toBe(1)
  })

  it('joining mid-LIVE round -> enters directly as a zombie', () => {
    const s = toLive()
    const j = s.join('late')
    expect(j.role).toBe('zombie')
    expect(j.team).toBe('B')
    expect(j.alive).toBe(true)
  })

  it('the only mother zombie leaves -> a new mother is picked immediately', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    s.room.leave(mom.id)
    run(s.room, 64)
    expect(zombiesOf(s.room).length).toBe(1)
    expect(zombiesOf(s.room)[0]!.zstats!.type).toBe('mother')
  })

  it('/zombie and /human switch roles; humans cannot hit humans (no friendly fire)', () => {
    const s = setup()
    const p = s.players[0]!
    expect(handleDebugCmd(s.room, p, '/zombie')).toBe(true)
    expect(p.role).toBe('zombie')
    expect(handleDebugCmd(s.room, p, '/human')).toBe(true)
    expect(p.role).toBe('human')
    expect(p.team).toBe('A')
  })

  it('sniff (I.3): Q -> humans within 18m receive Sniffed, beyond 18m do not; 15s cooldown; snapshot reports remaining time', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const [near, far] = humansOf(s.room)
    mom.state.pos = [0, 0, 0]; near!.state.pos = [10, 0, 0]; far!.state.pos = [25, 0, 0]
    enqueueCmds(mom, [{ seq: 9000, buttons: Btn.Sniff, yaw: 0, pitch: 0, weapon: 0 }], 0)
    run(s.room, 32)
    expect(sent(s.msgs, near!.id, MsgType.Sniffed).length).toBe(1)
    expect(sent(s.msgs, far!.id, MsgType.Sniffed).length).toBe(0)
    expect(mom.sniffReadyAt).toBeGreaterThan(s.room.serverNow + 14_000)
    enqueueCmds(mom, [{ seq: 9010, buttons: Btn.Sniff, yaw: 0, pitch: 0, weapon: 0 }], 0)   // still on cooldown
    run(s.room, 64)
    expect(sent(s.msgs, near!.id, MsgType.Sniffed).length).toBe(1)
    sendSnapshots(s.room, 0, s.room.serverNow)
    const snap = sent(s.msgs, near!.id, MsgType.Snapshot).pop() as { players: { id: number; sniffLeft?: number; sniffCd?: number }[] }
    const nz = snap.players.find(p => p.id === mom.id)!
    expect(nz.sniffLeft).toBeGreaterThan(0)
    expect(nz.sniffCd).toBeGreaterThan(10_000)
  })
})
