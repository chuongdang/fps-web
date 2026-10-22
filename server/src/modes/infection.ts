// Infection (plan 16, part I): everyone starts as a human, after prepSec seconds a few become mother zombies; a zombie clawing a human turns them into a zombie.
//
// WARMUP ─(≥ 3 players)→ PREP ─→ (pick mothers) LIVE ─→ ROUND_END ─┬→ PREP (next round)
//                                                            └→ MATCH_END ─(15s)→ PREP round 1 / WARMUP
// Humans = team A, zombies = team B: the existing "no friendly fire" rule means humans do not hurt each other and zombies do not claw zombies.
import {
  Btn, ECONOMY_INFECTION, INFECTION, MatchPhase, MsgType, infectionStats,
  type InfectionSettings, type MatchStateMsg, type RoomStatus, type ScoreboardRow, type TeamId,
} from '@fps/shared'
import type { Player, Room } from '../room'
import { broadcastScoreboard, setPhase } from '../match'
import type { MatchMode } from './index'

const MS = 1000
const MIN_PLAYERS_TO_CONTINUE = 2
const MAX_SPAWN_CANDIDATES = 160

interface Score { pts: number; inf: number; zk: number }
interface SpawnPoint { pos: [number, number, number]; yaw: number }

export class InfectionMode implements MatchMode {
  readonly mode = 'infection' as const
  round = 1
  private readonly score = new Map<number, Score>()
  private lastMothers = new Set<number>()
  private lastCounts = { humans: -1, zombies: -1 }
  private heroChosen = false
  private candidates: SpawnPoint[] | null = null
  private candidatesFor: unknown = null

  constructor(readonly s: InfectionSettings) {}

  economy() { return ECONOMY_INFECTION }

  private sc(p: Player): Score {
    let v = this.score.get(p.id)
    if (!v) { v = { pts: 0, inf: 0, zk: 0 }; this.score.set(p.id, v) }
    return v
  }

  humans(room: Room): number {
    let n = 0
    for (const p of room.players.values()) if (p.role === 'human') n++
    return n
  }
  zombies(room: Room): number { return room.players.size - this.humans(room) }

  // ── Spawn points: nav (ground, evenly spread) if available, otherwise every spawn point of the map
  private spawnCandidates(room: Room): SpawnPoint[] {
    const key = room.nav ?? room.map
    if (this.candidates && this.candidatesFor === key) return this.candidates
    const out: SpawnPoint[] = []
    const nav = room.nav
    if (nav) {
      const ground: number[] = []
      for (let i = 0; i < nav.count; i++) if (nav.y[i]! < 0.3) ground.push(i)
      const step = Math.max(1, Math.floor(ground.length / MAX_SPAWN_CANDIDATES))
      for (let k = 0; k < ground.length; k += step) { const i = ground[k]!; out.push({ pos: [nav.x[i]!, nav.y[i]! + 0.1, nav.z[i]!], yaw: 0 }) }
    }
    if (out.length === 0) for (const sp of [...room.map.spawns.A, ...room.map.spawns.B]) out.push({ pos: [sp.pos[0], sp.pos[1], sp.pos[2]], yaw: sp.yaw })
    this.candidates = out
    this.candidatesFor = key
    return out
  }

  /** n points far from each other (farthest-point sampling, random first point) */
  private spreadPoints(room: Room, n: number): SpawnPoint[] {
    const c = this.spawnCandidates(room)
    const chosen: SpawnPoint[] = []
    const minD = new Float64Array(c.length).fill(Infinity)
    let next = Math.floor(room.random() * c.length)
    for (let k = 0; k < n; k++) {
      const sp = c[next]!
      chosen.push({ pos: [sp.pos[0], sp.pos[1], sp.pos[2]], yaw: room.random() * Math.PI * 2 - Math.PI })
      let best = -1, bestD = -1
      for (let i = 0; i < c.length; i++) {
        minD[i] = Math.min(minD[i]!, Math.hypot(c[i]!.pos[0] - sp.pos[0], c[i]!.pos[2] - sp.pos[2]))
        if (minD[i]! > bestD) { bestD = minD[i]!; best = i }
      }
      next = best
    }
    return chosen
  }

  /** The point farthest from the humans (for respawning zombies) */
  private farthestFromHumans(room: Room): SpawnPoint {
    const c = this.spawnCandidates(room)
    let best = c[0]!, bestD = -1
    for (const sp of c) {
      let near = Infinity
      for (const o of room.players.values()) {
        if (o.role !== 'human' || !o.alive) continue
        near = Math.min(near, Math.hypot(o.state.pos[0] - sp.pos[0], o.state.pos[2] - sp.pos[2]))
      }
      if (near > bestD) { bestD = near; best = sp }
    }
    return { pos: [best.pos[0], best.pos[1], best.pos[2]], yaw: room.random() * Math.PI * 2 - Math.PI }
  }

  // ── State machine
  tick(room: Room, now: number): void {
    const enough = room.players.size >= INFECTION.minPlayers
    const stay = room.players.size >= MIN_PLAYERS_TO_CONTINUE
    switch (room.phase) {
      case MatchPhase.Waiting:
        if (enough) this.startPrep(room, now)
        break
      case MatchPhase.Prep:
        if (!stay) this.toWaiting(room)
        else if (now >= room.phaseEndsAt) this.pickMothers(room, now)
        break
      case MatchPhase.Playing: {
        if (!stay) { this.toWaiting(room); break }
        if (this.zombies(room) === 0 && this.humans(room) >= 2) this.makeMothers(room, 1, now)   // the only mother zombie just left
        this.rescaleAndAnnounce(room)
        const h = this.humans(room)
        if (h === 0) this.endRound(room, now, 'B', 'infected_all')
        else if (now >= room.phaseEndsAt) this.endRound(room, now, 'A', 'time_survive')
        break
      }
      case MatchPhase.RoundEnd:
        if (now >= room.phaseEndsAt) {
          if (this.round >= this.s.rounds) this.endMatch(room, now)
          else if (!stay) this.toWaiting(room)
          else { this.round++; this.startPrep(room, now) }
        }
        break
      case MatchPhase.Ended:
        if (now >= room.phaseEndsAt) this.newMatch(room, now, enough)
        break
    }
  }

  private toWaiting(room: Room): void {
    for (const p of room.players.values()) if (p.role === 'zombie') room.makeHuman(p, 'A')
    setPhase(room, MatchPhase.Waiting, 0)
  }

  // Round start: everyone is human, money = startMoney, spread evenly across the map
  private startPrep(room: Room, now: number): void {
    room.grenades = []; room.smokes = []
    this.heroChosen = false
    for (const p of room.players.values()) p.transport.send({ t: MsgType.RoundReset, round: this.round })
    const pts = this.spreadPoints(room, room.players.size)
    let i = 0
    for (const p of room.players.values()) {
      room.makeHuman(p, 'A')
      room.resetEconomy(p)
      room.respawn(p, pts[i++]!)
      p.invulnUntil = 0
    }
    this.lastCounts = { humans: -1, zombies: -1 }
    this.announceCounts(room)
    setPhase(room, MatchPhase.Prep, now + this.s.prepSec * MS)
  }

  private pickMothers(room: Room, now: number): void {
    this.makeMothers(room, INFECTION.motherCount(room.players.size), now)
    setPhase(room, MatchPhase.Playing, now + this.s.roundTimeSec * MS)
  }

  /** Randomly pick `count` players as mother zombies; do not re-pick last round's mothers if there are other choices */
  private makeMothers(room: Room, count: number, _now: number): void {
    const humans = [...room.players.values()].filter(p => p.role === 'human')
    if (humans.length === 0) return
    const fresh = humans.filter(p => !this.lastMothers.has(p.id))
    const pool = fresh.length >= count ? fresh : humans
    const chosen: Player[] = []
    const left = pool.slice()
    while (chosen.length < count && left.length > 0) chosen.push(left.splice(Math.floor(room.random() * left.length), 1)[0]!)
    this.lastMothers = new Set(chosen.map(p => p.id))
    const humansAfter = humans.length - chosen.length
    for (const p of chosen) {
      room.makeZombie(p, infectionStats('mother', humansAfter), INFECTION.transformMs + INFECTION.pickMs)   // transform in place, invulnerable until the banner finishes
      for (const o of room.players.values()) o.transport.send({ t: MsgType.Infected, playerId: p.id, byId: null, kind: 'mother' })
    }
    this.rescaleAndAnnounce(room)
  }

  // Clawed to death -> the human turns into a zombie in place (not counted as a death, no weapon drop)
  onLethal(room: Room, p: Player): boolean {
    if (room.phase !== MatchPhase.Playing || p.role !== 'human') return false
    const killer = room.players.get(p.killerId)
    const by = killer && killer.zstats && killer.id !== p.id ? killer : null
    const humansAfter = this.humans(room) - 1
    room.makeZombie(p, infectionStats('normal', humansAfter), INFECTION.transformMs)
    p.state.vel[0] = 0; p.state.vel[2] = 0
    p.killerId = -1
    if (by) {
      const sc = this.sc(by)
      sc.inf++
      sc.pts += INFECTION.points.infect + (by.zstats!.type === 'mother' ? INFECTION.points.mother : 0)
    }
    for (const o of room.players.values()) o.transport.send({ t: MsgType.Infected, playerId: p.id, byId: by ? by.id : null, kind: 'infected' })
    this.rescaleAndAnnounce(room)
    return true
  }

  // Zombie health is recomputed whenever the number of living humans changes: hpMax = hpBase + hpPerHuman × humans (current health keeps its % ratio); 1 human left -> hero
  private rescaleAndAnnounce(room: Room): void {
    const humans = this.humans(room)
    if (humans !== this.lastCounts.humans) {
      for (const z of room.players.values()) {
        const st = z.zstats
        if (!st || (st.type !== 'mother' && st.type !== 'normal')) continue
        const next = infectionStats(st.type, humans)
        const ratio = st.hpMax > 0 ? z.hp / st.hpMax : 1
        z.zstats = { ...st, hpMax: next.hpMax }
        if (z.alive) z.hp = Math.max(1, ratio * next.hpMax)
      }
    }
    if (room.phase === MatchPhase.Playing && humans === 1 && this.zombies(room) >= 1 && !this.heroChosen) {
      const hero = [...room.players.values()].find(p => p.role === 'human')!
      if (hero.hp <= 0) { this.announceCounts(room); return }   // the last human is being settled as dead this same tick: no rescue
      this.heroChosen = true
      hero.hero = true
      hero.hp = INFECTION.hero.hp
      hero.damageMult = INFECTION.hero.damageMult
      hero.speedMult = INFECTION.hero.speedMult
      for (const o of room.players.values()) o.transport.send({ t: MsgType.HeroChosen, playerId: hero.id })
    }
    this.announceCounts(room)
  }

  private announceCounts(room: Room): void {
    const humans = this.humans(room), zombies = this.zombies(room)
    if (humans === this.lastCounts.humans && zombies === this.lastCounts.zombies) return
    this.lastCounts = { humans, zombies }
    for (const o of room.players.values()) o.transport.send({ t: MsgType.InfectionCount, humans, zombies })
  }

  private endRound(room: Room, now: number, winner: TeamId, reason: 'infected_all' | 'time_survive'): void {
    if (winner === 'A') {   // time up with humans alive: each survivor gets +surviveRound
      for (const p of room.players.values()) if (p.role === 'human') this.sc(p).pts += INFECTION.points.surviveRound
    }
    for (const p of room.players.values()) p.transport.send({ t: MsgType.RoundEnd, round: this.round, winner, reason })
    setPhase(room, MatchPhase.RoundEnd, now + this.s.roundEndSec * MS)
    broadcastScoreboard(room)
  }

  private endMatch(room: Room, now: number): void {
    let mvp: Player | null = null
    for (const p of room.players.values()) if (!mvp || this.sc(p).pts > this.sc(mvp).pts) mvp = p
    for (const p of room.players.values()) p.transport.send({ t: MsgType.MatchEnd, winner: null, scoreA: 0, scoreB: 0, mvpId: mvp?.id ?? null })
    setPhase(room, MatchPhase.Ended, now + this.s.matchEndSec * MS)
    broadcastScoreboard(room)
  }

  private newMatch(room: Room, now: number, enough: boolean): void {
    this.round = 1
    this.score.clear()
    this.lastMothers.clear()
    for (const p of room.players.values()) { p.kills = 0; p.deaths = 0 }
    if (enough) this.startPrep(room, now)
    else this.toWaiting(room)
  }

  // ── MatchMode hooks
  onPlayerJoin(room: Room, p: Player): void {
    this.sc(p)
    if (room.phase === MatchPhase.Playing) {   // joined mid-round: enters straight away as a zombie
      room.makeZombie(p, infectionStats('normal', this.humans(room)), 0)
      room.respawn(p, this.farthestFromHumans(room))
      p.invulnUntil = 0
    }
  }

  onPlayerLeave(_room: Room, p: Player): void { this.score.delete(p.id) }

  onKill(room: Room, killer: Player | null, victim: Player): number {
    if (room.phase !== MatchPhase.Playing && room.phase !== MatchPhase.RoundEnd) return 0
    victim.deaths++
    if (victim.role === 'zombie' && killer && killer.role === 'human') {
      killer.kills++
      const sc = this.sc(killer)
      sc.zk++
      sc.pts += killer.hero ? INFECTION.points.killAsHero : INFECTION.points.killZombie
    }
    return 0
  }

  afterDeaths(): void { /* no team change based on kill count */ }

  respawnDelayMs(room: Room, p?: Player): number | null {
    if (room.phase === MatchPhase.Prep || room.phase === MatchPhase.Waiting || room.phase === MatchPhase.Ended) return 0
    return p?.role === 'zombie' ? INFECTION.zombieRespawnMs : 3000
  }

  pickSpawn(room: Room, p: Player): SpawnPoint | null {
    if (room.phase === MatchPhase.Playing && p.role === 'zombie') return this.farthestFromHumans(room)
    return this.spreadPoints(room, 1)[0] ?? null
  }

  joinTeam(): TeamId { return 'A' }
  buyAnywhere(room: Room, p: Player): boolean { return room.phase === MatchPhase.Prep && p.role === 'human' && INFECTION.buyAnywhereDuringPrep }
  canBuy(room: Room, p: Player): boolean { return room.phase === MatchPhase.Prep && p.role === 'human' }
  canSwitchTeam(): boolean { return false }

  scoreboardRow(_room: Room, p: Player, row: ScoreboardRow): void {
    const sc = this.sc(p)
    row.pts = sc.pts; row.inf = sc.inf; row.zk = sc.zk; row.role = p.role
  }

  roomStatus(room: Room): RoomStatus {
    if (room.phase === MatchPhase.Waiting) return { code: 'waiting' }
    return { code: 'infectionRound', round: Math.min(this.round, this.s.rounds), maxRounds: this.s.rounds, humans: this.humans(room), zombies: this.zombies(room) }
  }

  stateMessage(room: Room): MatchStateMsg {
    return {
      t: MsgType.MatchState, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
      scoreA: 0, scoreB: 0, sideSwapped: false,
      mode: 'infection', round: this.round, maxRounds: this.s.rounds,
      aliveA: this.humans(room), aliveB: this.zombies(room),
      buyEndsAt: room.phase === MatchPhase.Prep ? room.phaseEndsAt : null,
    }
  }

  // Q: zombie sniff - humans within the radius get a red outline through walls on the zombie's screen (drawn by the client), and a nearby growl is heard
  onCmd(room: Room, p: Player, buttons: number): void {
    if ((buttons & Btn.Sniff) === 0 || p.role !== 'zombie' || !p.alive || room.phase !== MatchPhase.Playing) return
    if (room.serverNow < p.sniffReadyAt || room.serverNow < p.transformUntil) return
    p.sniffUntil = room.serverNow + INFECTION.sniff.durationMs
    p.sniffReadyAt = room.serverNow + INFECTION.sniff.cooldownMs
    for (const o of room.players.values()) {
      if (o.role !== 'human' || !o.alive) continue
      if (Math.hypot(o.state.pos[0] - p.state.pos[0], o.state.pos[2] - p.state.pos[2]) <= INFECTION.sniff.radius) o.transport.send({ t: MsgType.Sniffed, byId: p.id })
    }
  }

  // ── Debug commands
  devSetRole(room: Room, p: Player, role: 'zombie' | 'human'): boolean {
    if (role === 'zombie') room.makeZombie(p, infectionStats('normal', this.humans(room) - (p.role === 'human' ? 1 : 0)), 0)
    else room.makeHuman(p, 'A')
    this.rescaleAndAnnounce(room)
    return true
  }

  devEndRound(room: Room, winner: 'A' | 'B' | 'draw'): boolean {
    if (room.phase !== MatchPhase.Playing) return false
    this.endRound(room, room.serverNow, winner === 'B' ? 'B' : 'A', winner === 'B' ? 'infected_all' : 'time_survive')
    return true
  }
}
