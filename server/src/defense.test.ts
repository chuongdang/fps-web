import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { Btn, CLAW_ID, WEAPONS, DEFENSE, MATCH, MatchPhase, MsgType, WAVES, ZOMBIE_TYPES, defaultMovement, loadMap, waveClearBonus, type AnyMsg, type MapFile, type RoomOptions, type Transport } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from './room'
import { enqueueCmds, stepRoom } from './simulation'
import { resolveShot } from './shooting'
import { buildNav, type NavGrid } from './bots/nav'
import { handleDebugCmd } from './debugCmds'
import type { DefenseMode } from './modes/defense'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
let nav: NavGrid
const flat = (): CollisionWorld => ({
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true, castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }), dispose: () => {},
})
beforeAll(async () => { nav = buildNav(await createWorld(map), map, defaultMovement) })

const OPTS: RoomOptions = { mode: 'defense', settings: { waves: 10, intermissionSec: 2, difficulty: 'normal' } }

function setup(humans = 1) {
  const rm = new RoomManager(map, () => 0, MATCH)
  const msgs = new Map<number, AnyMsg[]>()
  const players: Player[] = []
  const join = (name: string) => {
    const list: AnyMsg[] = []
    const t: Transport = { send: m => { list.push(m) }, onMessage: () => {}, onClose: () => {} }
    const res = rm.tryJoin('r', name, t, 0, 'auto', undefined, undefined, OPTS)!
    res.player.world = flat()
    msgs.set(res.player.id, list)
    players.push(res.player)
    const room = res.room
    room.nav = nav
    room.npcWorld = flat
    return res.player
  }
  for (let i = 0; i < humans; i++) join(`p${i}`)
  const room = rm.rooms.get('r')!
  const m = room.mode as DefenseMode
  m.s.prepSec = 1; m.s.endSec = 1; m.s.intermissionSec = 2
  return { rm, room, m, players, join, msgs }
}
const run = (room: Room, ms: number) => { const to = room.serverNow + ms; for (let t = room.serverNow + 16; t <= to; t += 16) stepRoom(room, defaultMovement, t) }
const of = (msgs: Map<number, AnyMsg[]>, id: number, t: number) => msgs.get(id)!.filter(m => m.t === t)
const npcs = (room: Room) => [...room.players.values()].filter(p => p.npc)
const aliveNpcs = (room: Room) => npcs(room).filter(p => p.alive)
/** Kill every living zombie on behalf of `killer` (hp to 0, kill credited to killer) */
const killAll = (room: Room, killer: Player) => { for (const z of aliveNpcs(room)) { z.hp = 0; z.killerId = killer.id }; run(room, 32) }

function toWave1() {
  const s = setup()
  run(s.room, 100)
  expect(s.room.phase).toBe(MatchPhase.Prep)
  run(s.room, 1100)
  expect(s.room.phase).toBe(MatchPhase.Playing)
  return s
}

describe('Defense - phases (T.1)', () => {
  it('player joins -> PREP -> WAVE 1; player in base A (team A), money $1500, WaveStart sent to the player', () => {
    const s = setup()
    run(s.room, 100)
    const p = s.players[0]!
    expect(p.team).toBe('A')
    expect(p.money).toBe(DEFENSE.startMoney)
    expect(p.state.pos[0]).toBeLessThan(0)
    run(s.room, 1100)
    expect(s.m.wave).toBe(1)
    expect(of(s.msgs, p.id, MsgType.WaveStart).pop()).toMatchObject({ wave: 1, title: WAVES.waves[0]!.title, hint: WAVES.waves[0]!.hint })
  })

  it('wave 1: 10 walkers spawn gradually (1.5s each), each on schedule; zombiesLeft is correct', () => {
    const s = toWave1()
    run(s.room, 100)
    expect(aliveNpcs(s.room).length).toBe(1)
    run(s.room, 1500 * 4)
    expect(aliveNpcs(s.room).length).toBe(5)
    expect(aliveNpcs(s.room).every(z => z.zstats!.type === 'walker' && z.team === 'B')).toBe(true)
    expect(s.m.zombiesLeft(s.room)).toBe(10)
    run(s.room, 1500 * 8)
    expect(aliveNpcs(s.room).length).toBe(10)
  })

  it('all zombies killed: money per type + wave-clear bonus 800+100n, WaveClear, then a break; break over -> wave 2', () => {
    const s = toWave1()
    const p = s.players[0]!
    run(s.room, 1500 * 10)
    const money0 = p.money
    killAll(s.room, p)
    expect(p.money).toBe(money0 + 10 * ZOMBIE_TYPES.walker!.reward + waveClearBonus(1))
    expect(of(s.msgs, p.id, MsgType.WaveClear).pop()).toMatchObject({ wave: 1, bonus: 900 })
    expect(s.m.kind).toBe('intermission')
    expect(s.room.phase).toBe(MatchPhase.Prep)
    run(s.room, 2200)
    expect(s.m.wave).toBe(2)
    expect(of(s.msgs, p.id, MsgType.WaveStart).pop()).toMatchObject({ wave: 2, title: WAVES.waves[1]!.title })
  })

  it('multi-group wave: wave 2 has runners delayed 8s; counts scale with player count (2 players x1.6)', () => {
    const s = setup(2)
    run(s.room, 100)
    run(s.room, 1100)
    s.m.devSetWave(s.room, 2)
    run(s.room, 7000)
    expect(aliveNpcs(s.room).some(z => z.zstats!.type === 'runner')).toBe(false)
    run(s.room, 3000)
    expect(aliveNpcs(s.room).some(z => z.zstats!.type === 'runner')).toBe(true)
    expect(Math.round(10 * (1 + 0.6))).toBe(16)
    expect(s.m.zombiesLeft(s.room)).toBeGreaterThan(16)   // walker 16 + runner 10 (some already spawned)
  })

  it('maxAlive: no more than 28 zombies alive at once, wait when full', () => {
    const s = setup(4)
    run(s.room, 100); run(s.room, 1100)
    s.m.devSetWave(s.room, 8)
    run(s.room, 60_000)
    expect(aliveNpcs(s.room).length).toBeLessThanOrEqual(WAVES.maxAlive)
  })

  it('solo: death is an immediate DEFEAT (no downed state); DefenseEnd carries stats; 20s later back to WARMUP, then re-enter', () => {
    const s = toWave1()
    const p = s.players[0]!
    run(s.room, 3000)
    p.hp = 0; p.killerId = aliveNpcs(s.room)[0]!.id
    run(s.room, 64)
    expect(p.alive).toBe(false)
    expect(s.m.kind).toBe('defeat')
    expect(s.room.phase).toBe(MatchPhase.Ended)
    expect(of(s.msgs, p.id, MsgType.DefenseEnd).pop()).toMatchObject({ result: 'defeat', wave: 1 })
    run(s.room, 1200)
    expect(['waiting', 'prep']).toContain(s.m.kind)
  })

  it('death mid-wave (multiplayer): no respawn until the break, then respawn at full hp with the guns already owned', () => {
    const s = setup(2)
    run(s.room, 100); run(s.room, 1100)
    const [a, b] = s.players as [Player, Player]
    // a is downed, then dies for good (downed timer expires)
    a.hp = 0; run(s.room, 32)
    expect(a.downed).toBe(true)
    a.downUntil = s.room.serverNow + 10
    run(s.room, 100)
    expect(a.alive).toBe(false)
    run(s.room, 3000)
    expect(a.alive).toBe(false)   // still no respawn mid-wave
    killAll(s.room, b); run(s.room, 1500 * 20)   // 2 players: 16 walkers
    killAll(s.room, b)
    run(s.room, 100)
    expect(s.m.kind).toBe('intermission')
    expect(a.alive).toBe(true)
    expect(a.hp).toBe(DEFENSE.prepReviveHp)
  })

  it('wave 10 cleared (with boss) -> VICTORY', () => {
    const s = setup()
    run(s.room, 100); run(s.room, 1100)
    const p = s.players[0]!
    s.m.devSetWave(s.room, 10)
    run(s.room, 300)
    expect(aliveNpcs(s.room).some(z => z.zstats!.type === 'boss')).toBe(true)
    run(s.room, 12_000)
    killAll(s.room, p)
    run(s.room, 50_000)   // 16 walkers, 2.5s each, delayed 10s
    killAll(s.room, p)
    run(s.room, 100)
    expect(s.m.kind).toBe('victory')
    expect(of(s.msgs, p.id, MsgType.DefenseEnd).pop()).toMatchObject({ result: 'victory' })
  })

  it('/wave 9 jumps to wave 9; /clearwave removes the current wave zombies -> wave over', () => {
    const s = setup()
    run(s.room, 100); run(s.room, 1100)
    const p = s.players[0]!
    expect(handleDebugCmd(s.room, p, '/wave 9')).toBe(true)
    expect(s.m.wave).toBe(9)
    run(s.room, 2000)
    expect(aliveNpcs(s.room).length).toBeGreaterThan(0)
    expect(handleDebugCmd(s.room, p, '/clearwave')).toBe(true)
    run(s.room, 100)
    expect(s.m.kind).toBe('intermission')
  })
})

describe('Defense - downed and revive (T.6)', () => {
  function twoPlayers() {
    const s = setup(2)
    run(s.room, 100); run(s.room, 1100)
    run(s.room, 200)
    return s
  }
  it('multiplayer: out of hp -> downed (hp 40, slow crawl), not dead; sidearm only', () => {
    const s = twoPlayers()
    const [a] = s.players as [Player, Player]
    a.hp = 0; a.killerId = aliveNpcs(s.room)[0]?.id ?? -1
    run(s.room, 32)
    expect(a.alive).toBe(true)
    expect(a.downed).toBe(true)
    expect(a.hp).toBe(DEFENSE.down.reviveHp)
    expect(a.speedMult).toBeCloseTo(DEFENSE.down.crawlSpeed / defaultMovement.runSpeed, 6)
  })
  it('teammate within 1.5m holds E for 3s -> revived with 40 hp; getting hit restarts it', () => {
    const s = twoPlayers()
    const [a, b] = s.players as [Player, Player]
    a.hp = 0; run(s.room, 32)
    b.state.pos = [a.state.pos[0] + 1, a.state.pos[1], a.state.pos[2]]
    const hold = (n: number) => { for (let i = 0; i < n; i++) enqueueCmds(b, [{ seq: 3000 + (seq++), buttons: Btn.Ability, yaw: 0, pitch: 0, weapon: 0 }], 0) }
    let seq = 0
    hold(60); run(s.room, 1000)
    expect(a.downed).toBe(true)
    expect(a.reviveProgressMs).toBeGreaterThan(500)
    b.lastHurtAt = s.room.serverNow   // got hit
    run(s.room, 32)
    expect(a.reviveProgressMs).toBe(0)
    b.lastHurtAt = -Infinity
    hold(200); run(s.room, 3500)
    expect(a.downed).toBe(false)
    expect(a.hp).toBe(DEFENSE.down.reviveHp)
    expect(a.speedMult).toBe(1)
  })
  it('last player standing is killed while teammates are already dead -> not downed, immediate DEFEAT', () => {
    const s = twoPlayers()
    const [a, b] = s.players as [Player, Player]
    a.hp = 0; run(s.room, 32)
    a.downUntil = s.room.serverNow - 1   // a bleeds out
    run(s.room, 32)
    expect(a.downed).toBe(false)
    b.hp = 0
    run(s.room, 64)
    expect(b.downed).toBe(false)
    expect(s.m.kind).toBe('defeat')
  })
  it('a zombie claw hit on a downed player does not kill them (only the bleed-out timer does); standing players still lose hp', () => {
    const s = twoPlayers()
    const [a, b] = s.players as [Player, Player]
    a.hp = 0; run(s.room, 32)
    expect(a.downed).toBe(true)
    const z = (s.m as unknown as { spawnZombie(r: Room, t: string, p: [number, number, number], f: boolean): Player | null }).spawnZombie(s.room, 'walker', [a.state.pos[0], a.state.pos[1], a.state.pos[2] + 1.0], true)!
    const claw = (target: Player) => {
      z.state.pos = [target.state.pos[0], target.state.pos[1], target.state.pos[2] + 1.0]
      z.invulnUntil = 0
      resolveShot(z, s.room, { seq: 1, buttons: Btn.Fire, yaw: 0, pitch: 0, weapon: CLAW_ID }, defaultMovement, WEAPONS[CLAW_ID])   // yaw 0 looks toward -Z: at the target
    }
    claw(a)
    expect(a.hp).toBe(DEFENSE.down.reviveHp)
    b.state.pos = [a.state.pos[0] + 40, a.state.pos[1], a.state.pos[2]]
    const before = b.hp
    claw(b)
    expect(b.hp).toBeLessThan(before)
  })
  it('zombies spread away from a downed player: no stacking, so teammates can get in to revive', async () => {
    const s = twoPlayers()
    const [a, b] = s.players as [Player, Player]
    a.hp = 0; run(s.room, 32)
    expect(a.downed).toBe(true)
    b.state.pos = [a.state.pos[0] + 12, a.state.pos[1], a.state.pos[2]]   // target is on the far side of the downed player: the path goes through them
    const spawn = (s.m as unknown as { spawnZombie(r: Room, t: string, p: [number, number, number], f: boolean): Player | null }).spawnZombie
    const zs = [0, 1, 2].map(i => spawn.call(s.m, s.room, 'walker', [a.state.pos[0] - 1 - i * 0.4, a.state.pos[1], a.state.pos[2]], true)!)
    await new Promise(r => setTimeout(r, 0))   // the NPC zombie worlds attach asynchronously
    run(s.room, 6000)
    for (const z of zs) expect(Math.hypot(z.state.pos[0] - a.state.pos[0], z.state.pos[2] - a.state.pos[2])).toBeGreaterThan(DEFENSE.down.clearRadiusM * 0.6)
  })
  it('crawler zombies always crouch (crawl low)', async () => {
    const s = twoPlayers()
    const [a, b] = s.players as [Player, Player]
    b.state.pos = [a.state.pos[0] + 25, a.state.pos[1], a.state.pos[2]]
    const spawn = (s.m as unknown as { spawnZombie(r: Room, t: string, p: [number, number, number], f: boolean): Player | null }).spawnZombie
    const z = spawn.call(s.m, s.room, 'crawler', [a.state.pos[0] + 5, a.state.pos[1], a.state.pos[2]], true)!
    await new Promise(r => setTimeout(r, 0))
    run(s.room, 3000)
    expect(z.state.crouching).toBe(true)
  })
  it('both downed/dead at once -> DEFEAT', () => {
    const s = twoPlayers()
    const [a, b] = s.players as [Player, Player]
    a.hp = 0; b.hp = 0
    run(s.room, 64)
    expect(s.m.kind).toBe('defeat')
  })
})
