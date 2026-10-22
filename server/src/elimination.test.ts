import { describe, it, expect } from 'vitest'
import { ECONOMY_ELIM, MATCH, MatchPhase, MsgType, defaultMovement, loadMap, type AnyMsg, type MapFile, type Transport, type TeamId, type RoomOptions } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from './room'
import { stepRoom } from './simulation'
import { handleDebugCmd } from './debugCmds'
import type { EliminationMode } from './modes/elimination'

const map = loadMap({
  name: 't', mirrorX: true, boxes: [], ramps: [],
  spawnsA: [{ pos: [-25, 0, 0], yaw: 0 }, { pos: [-25, 0, 4], yaw: 0 }, { pos: [-25, 0, -4], yaw: 0 }],
  buyZoneA: { min: [-30, -1, -20], max: [-19, 3, 20] },
} as MapFile)

const flat: CollisionWorld = {
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true,
  castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}

const OPTS: RoomOptions = { mode: 'elimination', settings: { roundsToWin: 3, roundTimeSec: 60 } }

function setup() {
  const rm = new RoomManager(map, () => 0, MATCH)
  const msgs = new Map<string, AnyMsg[]>()
  const join = (name: string, team: TeamId) => {
    const list: AnyMsg[] = []
    msgs.set(name, list)
    const t: Transport = { send: m => { list.push(m) }, onMessage: () => {}, onClose: () => {} }
    const res = rm.tryJoin('r', name, t, 0, team, undefined, undefined, OPTS)!
    res.player.world = flat
    return res.player
  }
  return { rm, join, msgs, room: () => rm.rooms.get('r')! }
}

const run = (room: Room, ms: number) => { const to = room.serverNow + ms; for (let t = room.serverNow + 16; t <= to; t += 16) stepRoom(room, defaultMovement, t) }
const phaseOf = (r: Room): MatchPhase => r.phase
const mode = (room: Room) => room.mode as EliminationMode
const kill = (room: Room, killer: Player, victim: Player) => { victim.killerId = killer.id; victim.hp = 0; run(room, 32) }

// 1v1 at the start of FREEZE in round 1 (freeze 1s, round 60s to run fast)
function oneVsOne() {
  const s = setup()
  const a = s.join('a', 'A'), b = s.join('b', 'B')
  const room = s.room()
  mode(room).s.freezeSec = 1; mode(room).s.roundEndSec = 1; mode(room).s.halftimeSec = 1; mode(room).s.matchEndSec = 1
  run(room, 32)
  return { ...s, a, b, room }
}

describe('Elimination - phases', () => {
  it('one player per team: WARMUP -> FREEZE -> LIVE, each player on a spawn point in their base', () => {
    const { room, a, b } = oneVsOne()
    expect(room.phase).toBe(MatchPhase.Freeze)
    expect(a.state.pos[0]).toBeLessThan(0); expect(b.state.pos[0]).toBeGreaterThan(0)
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Playing)
  })

  it('WARMUP: dead players respawn immediately', () => {
    const s = setup()
    const a = s.join('a', 'A')
    kill(s.room(), a, a)
    run(s.room(), 64)
    expect(a.alive).toBe(true)
  })

  it('kill the opponent -> RoundEnd for the winning team (1-0), win money $3000; after roundEndSec both respawn for round 2', () => {
    const { room, a, b } = oneVsOne()
    run(room, 1100)
    const m0 = a.money, m1 = b.money
    kill(room, a, b)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA).toBe(1)
    expect(a.money).toBe(m0 + ECONOMY_ELIM.killReward + ECONOMY_ELIM.roundWin)
    expect(b.money).toBe(m1 + ECONOMY_ELIM.roundLossBase)
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Freeze)
    expect(mode(room).round).toBe(2)
    expect(a.alive && b.alive).toBe(true)
  })

  it('LIVE: dead players do not respawn', () => {
    const { room, a, b } = oneVsOne()
    run(room, 1100)
    kill(room, a, b)
    run(room, 500)
    expect(b.alive).toBe(false)
  })

  it('time up, same number alive: the team with more hp wins', () => {
    const { room, a, b, msgs } = oneVsOne()
    run(room, 1100)
    b.hp = 40; a.hp = 80
    run(room, 60_100)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA).toBe(1)
    expect(msgs.get('a')!.find(m => m.t === MsgType.RoundEnd)).toMatchObject({ winner: 'A', reason: 'time_hp' })
  })

  it('time up, 2 alive vs 1 alive: the larger team wins (time_alive)', () => {
    const s = setup()
    s.join('a', 'A'); s.join('c', 'A'); s.join('b', 'B')
    const room = s.room()
    mode(room).s.freezeSec = 1
    run(room, 1200)
    expect(room.phase).toBe(MatchPhase.Playing)
    run(room, 60_100)
    expect(room.scoreA).toBe(1)
    expect(s.msgs.get('b')!.find(m => m.t === MsgType.RoundEnd)).toMatchObject({ winner: 'A', reason: 'time_alive' })
  })

  it('time up exactly even -> draw, score unchanged, loss streak kept', () => {
    const { room } = oneVsOne()
    run(room, 1100 + 60_100)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA + room.scoreB).toBe(0)
  })

  it('both die on the same tick -> draw', () => {
    const { room, a, b } = oneVsOne()
    run(room, 1100)
    a.hp = 0; b.hp = 0
    run(room, 32)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA + room.scoreB).toBe(0)
  })

  it('survivor keeps their guns, the dead player goes back to the default loadout', () => {
    const { room, a, b } = oneVsOne()
    run(room, 1100)
    a.loadout.slots[3] = { key: 'sniper', paid: 4750 }
    b.loadout.slots[3] = { key: 'smg', paid: 1500 }
    kill(room, a, b)
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Freeze)
    expect(a.loadout.slots[3]?.key).toBe('sniper')
    expect(b.loadout.slots[3]?.key).toBe('ak47')
  })

  it('buy: only within buyTimeSec from the start of FREEZE', () => {
    const { room, a } = oneVsOne()
    expect(room.mode.canBuy(room, a, room.serverNow)).toBe(true)
    run(room, 1100 + 20_000)
    expect(room.mode.canBuy(room, a, room.serverNow)).toBe(false)
  })

  it('team reaches roundsToWin -> MATCH_END, 1s later a new match at 0-0 round 1', () => {
    const { room, a, b, msgs } = oneVsOne()
    for (let i = 0; i < 3; i++) {
      run(room, 1100)           // freeze over
      if (phaseOf(room) !== MatchPhase.Playing) break
      kill(room, a, b)
      if (phaseOf(room) === MatchPhase.RoundEnd) run(room, 1100)
      if (phaseOf(room) === MatchPhase.Halftime) run(room, 1100)
    }
    expect(room.phase).toBe(MatchPhase.Ended)
    expect(room.scoreA).toBe(3)
    expect(msgs.get('a')!.some(m => m.t === MsgType.MatchEnd && m.winner === 'A')).toBe(true)
    run(room, 1100)
    expect(room.scoreA + room.scoreB).toBe(0)
    expect(mode(room).round).toBe(1)
    expect(room.phase).toBe(MatchPhase.Freeze)
  })

  it('after round roundsToWin-1: half-time break, swap sides, money back to $800', () => {
    const { room, a, b } = oneVsOne()
    for (let i = 0; i < 2; i++) { run(room, 1100); kill(room, a, b); if (i === 0) run(room, 1100) }
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Halftime)
    expect(room.sideSwapped).toBe(true)
    expect(a.money).toBe(ECONOMY_ELIM.startMoney)
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Freeze)
    expect(a.state.pos[0]).toBeGreaterThan(0)   // team A is now in the B-side base
  })

  it('joining mid-round: spectate only, play next round, no money for this round', () => {
    const { room, a, b, join } = oneVsOne()
    run(room, 1100)
    const c = join('c', 'A')
    expect(c.alive).toBe(false)
    const m = c.money
    kill(room, a, b)
    expect(c.money).toBe(m)
    run(room, 1100)
    expect(c.alive).toBe(true)
  })

  it('a team has nobody connected: the other team wins the round, back to WARMUP keeping the score', () => {
    const { room, b } = oneVsOne()
    run(room, 1100)
    room.leave(b.id)
    run(room, 32)
    expect(room.phase).toBe(MatchPhase.Waiting)
    expect(room.scoreA).toBe(1)
  })

  it('ChooseTeam is only allowed in WARMUP / FREEZE', () => {
    const { room, a } = oneVsOne()
    expect(room.mode.canSwitchTeam(room, a)).toBe(true)
    run(room, 1100)
    expect(room.mode.canSwitchTeam(room, a)).toBe(false)
  })
})

describe('debug commands (M.8)', () => {
  it('/endround A ends the round for A; /endround draw draws; /time resets the clock; /money; /hp; /kill', () => {
    const { room, a } = oneVsOne()
    run(room, 1100)
    expect(handleDebugCmd(room, a, '/time 10')).toBe(true)
    expect(room.phaseEndsAt - room.serverNow).toBe(10_000)
    expect(handleDebugCmd(room, a, '/money 16000')).toBe(true)
    expect(a.money).toBe(16000)
    expect(handleDebugCmd(room, a, '/hp 30')).toBe(true)
    expect(a.hp).toBe(30)
    expect(handleDebugCmd(room, a, '/endround A')).toBe(true)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA).toBe(1)
    expect(handleDebugCmd(room, a, '/endround xyz')).toBe(false)
    expect(handleDebugCmd(room, a, '/bogus')).toBe(false)
  })
  it('/setround 9 jumps to round 9; /kill suicides', () => {
    const { room, a } = oneVsOne()
    expect(handleDebugCmd(room, a, '/setround 3')).toBe(true)
    expect(mode(room).round).toBe(3)
    expect(room.phase).toBe(MatchPhase.Freeze)
    run(room, 1100)
    expect(handleDebugCmd(room, a, '/kill')).toBe(true)
    run(room, 32)
    expect(a.alive).toBe(false)
  })
})
