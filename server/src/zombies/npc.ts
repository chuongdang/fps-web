// Defense zombie NPC (plan 17, T.4/T.5): a Player without a connection, whose input is produced by ZombieNpc each tick via ZombieBrain,
// then goes through the very same stepPlayer (the zombie's stepMovement, claw, hitbox) as a human. The boss zombie additionally has slam / summon / charge.
import { BOSS, Btn, DEFENSE, DT, MsgType, ZOMBIE_TYPES, zombieStatsFor, type DefenseDifficulty, type InputCmd, type Vec3, type ZombieStats } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { defaultMovement } from '@fps/shared'
import type { NpcDriver, Player, Room } from '../room'
import { ZombieBrain, ZOMBIE_AI } from './brain'

export interface NpcCtx {
  difficulty: DefenseDifficulty
  humans(room: Room): Player[]                       // players still alive (including downed ones)
  spawn(typeId: string, x: number, y: number, z: number, free?: boolean): Player | null   // spawn extra zombies (the boss summons a horde)
  players(room: Room): number
}

type BossAct =
  | { kind: 'slam'; until: number }
  | { kind: 'charge'; phase: 'wind' | 'run'; until: number; yaw: number; hit: Set<number>; startedAt: number }
  | { kind: 'stun'; until: number }

const TARGET_EVERY_MS = 1000
const SEP_RADIUS = 0.8
const SEP_WEIGHT = 0.9
const CHARGE_WALL_SPEED_FRAC = 0.35

const _tgt: Vec3 = [0, 0, 0]

export class ZombieNpc implements NpcDriver {
  readonly brain: ZombieBrain
  readonly stats: ZombieStats & { attackMs: number }
  private seq = 0
  private flip = false
  private readonly cmdA: InputCmd = { seq: 0, buttons: 0, yaw: 0, pitch: 0, weapon: 0 }
  private readonly cmdB: InputCmd = { seq: 0, buttons: 0, yaw: 0, pitch: 0, weapon: 0 }
  private targetId = -1
  private nextTargetAt = 0
  private nextAttackAt = 0
  private boostUntil = 0
  private nextRallyAt = 0
  // boss
  private act: BossAct | null = null
  private nextSlamAt = 0
  private nextChargeAt = 0
  private lastHpFrac = 1
  private summoned = 0
  readonly isBoss: boolean

  constructor(readonly typeId: string, private readonly ctx: NpcCtx, room: Room, players: number, rng: () => number = Math.random) {
    const def = ZOMBIE_TYPES[typeId]!
    this.stats = zombieStatsFor(typeId, ctx.difficulty, players)
    this.isBoss = def.abilities.includes('slam')
    const nav = room.nav!
    this.brain = new ZombieBrain(nav, { hole: def.abilities.includes('crawl_holes'), leap: def.abilities.includes('leap') }, rng)
    this.hasRally = def.abilities.includes('rally')
    this.alwaysCrawl = def.abilities.includes('crawl_holes')
  }
  private readonly hasRally: boolean
  private readonly alwaysCrawl: boolean   // crawler zombie: always crouched (crawls along the ground, 0.85m tall), not only when squeezing through a gap

  // ── Every tick, before stepPlayer
  drive(room: Room, p: Player, now: number): void {
    const cmd = (this.flip = !this.flip) ? this.cmdA : this.cmdB
    cmd.seq = this.seq++
    cmd.weapon = 0
    cmd.buttons = 0
    cmd.pitch = 0
    const s = p.state

    if (now >= this.boostUntil && p.speedMult !== 1 && !(this.act?.kind === 'charge')) p.speedMult = 1
    if (this.hasRally) this.rally(room, p, now)

    if (this.isBoss && this.bossTick(room, p, cmd, now)) { cmd.yaw = this.act && this.act.kind === 'charge' ? this.act.yaw : s.yaw; p.inputQueue.push(cmd); return }

    // pick a target (staggered by id), then move / attack
    if (now >= this.nextTargetAt) { this.nextTargetAt = now + TARGET_EVERY_MS + (p.id % 7) * 20; this.targetId = this.pickTarget(room, p) }
    const tgt = room.players.get(this.targetId)
    if (!tgt || !tgt.alive || tgt.downed) { this.targetId = -1; this.nextTargetAt = 0 }
    if (tgt && tgt.alive) {
      _tgt[0] = tgt.state.pos[0]; _tgt[1] = tgt.state.pos[1]; _tgt[2] = tgt.state.pos[2]
      const r = this.brain.step(cmd, s, _tgt, now, (s.leapCd ?? 0) <= 0)
      if (r.attack) {
        const hd = Math.hypot(_tgt[0] - s.pos[0], _tgt[2] - s.pos[2])
        cmd.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(_tgt[1] + 1.1 - (s.pos[1] + 1.6), Math.max(0.2, hd))))
        if (now >= this.nextAttackAt) { cmd.buttons |= Btn.Fire; this.nextAttackAt = now + this.stats.attackMs }
      } else this.separate(room, p, cmd)
      if (!r.attack) this.clearDowned(room, p, cmd)
      if (r.stuckMs >= DEFENSE.stuckTeleportMs) this.unstick(room, p, now)
    }
    if (this.alwaysCrawl) cmd.buttons |= Btn.Crouch
    p.inputQueue.push(cmd)
  }

  /** The nearest player by WALKING PATH (A*); with no path yet, by straight-line distance */
  private pickTarget(room: Room, p: Player): number {
    let humans = this.ctx.humans(room)
    if (humans.length === 0) return -1
    const standing = humans.filter(h => !h.downed)   // downed players are not targeted (while anyone is still standing they are ignored)
    if (standing.length > 0) humans = standing
    if (humans.length === 1) return humans[0]!.id
    const nav = room.nav
    let best = -1, bestCost = Infinity
    const from = nav ? nav.nearest(p.state.pos[0], p.state.pos[1], p.state.pos[2]) : -1
    for (const h of humans) {
      let cost = Math.hypot(h.state.pos[0] - p.state.pos[0], h.state.pos[2] - p.state.pos[2]) * 3   // fallback: rough estimate
      if (nav && from >= 0) {
        const to = nav.nearest(h.state.pos[0], h.state.pos[1], h.state.pos[2])
        const path = to >= 0 ? nav.findNodePath(from, to, undefined, this.brain.ability) : null
        if (path) { cost = 0; for (let i = 1; i < path.length; i++) cost += Math.hypot(nav.x[path[i]!]! - nav.x[path[i - 1]!]!, nav.z[path[i]!]! - nav.z[path[i - 1]!]!) + Math.abs(nav.y[path[i]!]! - nav.y[path[i - 1]!]!) }
      }
      if (cost < bestCost) { bestCost = cost; best = h.id }
    }
    return best
  }

  /** A zombie inside DEFENSE.down.clearRadiusM around a downed player (and not yet within claw range of its target): drop the path and back away from the downed player so teammates can revive them */
  private clearDowned(room: Room, p: Player, cmd: InputCmd): void {
    let best: Player | null = null, bestD: number = DEFENSE.down.clearRadiusM
    for (const h of this.ctx.humans(room)) {
      if (!h.downed || !h.alive) continue
      const d = Math.hypot(p.state.pos[0] - h.state.pos[0], p.state.pos[2] - h.state.pos[2])
      if (d < bestD) { bestD = d; best = h }
    }
    if (!best) return
    const dx = p.state.pos[0] - best.state.pos[0], dz = p.state.pos[2] - best.state.pos[2]
    cmd.yaw = Math.atan2(-dx, -dz)   // walking direction = (−sin yaw, −cos yaw) = away from the downed player
    cmd.buttons = (cmd.buttons & ~(Btn.Forward | Btn.Back | Btn.Left | Btn.Right | Btn.Jump | Btn.Ability)) | Btn.Forward
  }

  // Separation: steer away from other zombies within SEP_RADIUS (only while on a normal walk)
  private separate(room: Room, p: Player, cmd: InputCmd): void {
    const wp = this.brain.waypoint
    if (wp && wp.kind >= 3) return
    let rx = 0, rz = 0
    for (const o of room.players.values()) {
      if (o === p || !o.npc || !o.alive) continue
      const dx = p.state.pos[0] - o.state.pos[0], dz = p.state.pos[2] - o.state.pos[2]
      const d = Math.hypot(dx, dz)
      if (d < SEP_RADIUS && d > 1e-3 && Math.abs(p.state.pos[1] - o.state.pos[1]) < 1.5) { const w = (SEP_RADIUS - d) / SEP_RADIUS; rx += dx / d * w; rz += dz / d * w }
    }
    if (rx === 0 && rz === 0) return
    // current walking direction (−sin yaw, −cos yaw) plus the push force
    const fx = -Math.sin(cmd.yaw) + rx * SEP_WEIGHT, fz = -Math.cos(cmd.yaw) + rz * SEP_WEIGHT
    cmd.yaw = Math.atan2(-fx, -fz)
  }

  // Stuck for long: if no player can see it, reset it to the nearest valid node
  private unstick(room: Room, p: Player, now: number): void {
    const nav = room.nav
    this.brain.reset()
    if (!nav) return
    for (const h of this.ctx.humans(room)) {
      if (!h.world) continue
      const eye: Vec3 = [h.state.pos[0], h.state.pos[1] + 1.6, h.state.pos[2]]
      const dx = p.state.pos[0] - eye[0], dy = p.state.pos[1] + 1 - eye[1], dz = p.state.pos[2] - eye[2]
      const len = Math.hypot(dx, dy, dz)
      if (len > 40) continue
      const hit = h.world.castRay(eye, [dx / len, dy / len, dz / len], len)
      if (!hit || hit.dist >= len - 0.3) return   // a player can see it: do not teleport
    }
    const n = nav.nearest(p.state.pos[0], p.state.pos[1], p.state.pos[2], 6)
    if (n >= 0) { p.state.pos[0] = nav.x[n]!; p.state.pos[1] = nav.y[n]! + 0.05; p.state.pos[2] = nav.z[n]!; p.state.vel[0] = p.state.vel[1] = p.state.vel[2] = 0 }
    void now
  }

  // Zombie roar: every 10s speeds up nearby zombies by 25% for 5s (the client shows glowing eyes via the speed flag)
  private rally(room: Room, p: Player, now: number): void {
    if (now < this.nextRallyAt) return
    this.nextRallyAt = now + DEFENSE.rally.everyMs
    for (const o of room.players.values()) {
      if (!o.npc || !o.alive) continue
      if (Math.hypot(o.state.pos[0] - p.state.pos[0], o.state.pos[2] - p.state.pos[2]) > DEFENSE.rally.radius) continue
      o.speedMult = DEFENSE.rally.speedMult
      ;(o.npc as ZombieNpc).boostUntil = now + DEFENSE.rally.durationMs
    }
  }

  // ── Boss. Returns true if an ability is taking over control this tick (it has already written cmd).
  private bossTick(room: Room, p: Player, cmd: InputCmd, now: number): boolean {
    const st = p.zstats!
    const frac = st.hpMax > 0 ? p.hp / st.hpMax : 1
    // summon a horde when health crosses 75% / 50% / 25%
    while (this.summoned < BOSS.summon.thresholds.length && frac < BOSS.summon.thresholds[this.summoned]!) {
      this.summoned++
      for (let i = 0; i < BOSS.summon.count; i++) {
        const a = (i / BOSS.summon.count) * Math.PI * 2
        this.ctx.spawn(BOSS.summon.type, p.state.pos[0] + Math.cos(a) * BOSS.summon.radiusM, p.state.pos[1] + 0.1, p.state.pos[2] + Math.sin(a) * BOSS.summon.radiusM, true)
      }
      const o: Telegraph = { kind: 'summon', pos: [p.state.pos[0], p.state.pos[1], p.state.pos[2]], radius: BOSS.summon.radiusM, endsAt: now + 1500 }
      this.telegraph(room, o)
    }
    this.lastHpFrac = frac
    const humans = this.ctx.humans(room)
    const act = this.act
    if (act) {
      if (act.kind === 'stun') {
        if (now >= act.until) { this.act = null; p.takenMult = 1 } else return true
      } else if (act.kind === 'slam') {
        if (now < act.until) return true
        this.act = null
        this.slamHit(room, p, humans)
        return true
      } else {   // charge
        if (act.phase === 'wind') {
          if (now < act.until) return true
          act.phase = 'run'; act.until = now + BOSS.charge.durationMs; act.startedAt = now
          p.speedMult = BOSS.charge.speed / st.runSpeed
        }
        // charging
        cmd.buttons |= Btn.Forward
        const sp = Math.hypot(p.state.vel[0], p.state.vel[2])
        for (const h of humans) {
          if (act.hit.has(h.id)) continue
          if (Math.hypot(h.state.pos[0] - p.state.pos[0], h.state.pos[2] - p.state.pos[2]) < 1.6 && Math.abs(h.state.pos[1] - p.state.pos[1]) < 1.8) {
            act.hit.add(h.id)
            this.hurtHuman(room, p, h, BOSS.charge.damage, BOSS.charge.knockHoriz, BOSS.charge.knockUp)
          }
        }
        if (now - act.startedAt > 250 && sp < BOSS.charge.speed * CHARGE_WALL_SPEED_FRAC) {   // hit a wall: stunned for 2s, takes extra damage
          p.speedMult = 1
          this.act = { kind: 'stun', until: now + BOSS.charge.stunMs }
          p.takenMult = BOSS.charge.stunDamageMult
          return true
        }
        if (now >= act.until) { p.speedMult = 1; this.act = null; return false }
        cmd.yaw = act.yaw
        return true
      }
    }
    // pick a new ability
    let near: Player | null = null, nearD = Infinity
    for (const h of humans) { const d = Math.hypot(h.state.pos[0] - p.state.pos[0], h.state.pos[2] - p.state.pos[2]); if (d < nearD) { nearD = d; near = h } }
    if (!near) return false
    if (nearD <= BOSS.slam.triggerM && now >= this.nextSlamAt) {
      this.nextSlamAt = now + BOSS.slam.cooldownMs + BOSS.slam.windupMs
      this.act = { kind: 'slam', until: now + BOSS.slam.windupMs }
      this.telegraph(room, { kind: 'slam', pos: [p.state.pos[0], p.state.pos[1], p.state.pos[2]], radius: BOSS.slam.radiusM, endsAt: now + BOSS.slam.windupMs })
      return true
    }
    if (nearD >= BOSS.charge.minM && nearD <= BOSS.charge.maxM && Math.abs(near.state.pos[1] - p.state.pos[1]) < 1.2 && now >= this.nextChargeAt) {
      const yaw = Math.atan2(-(near.state.pos[0] - p.state.pos[0]), -(near.state.pos[2] - p.state.pos[2]))
      this.nextChargeAt = now + BOSS.charge.cooldownMs
      this.act = { kind: 'charge', phase: 'wind', until: now + BOSS.charge.windupMs, yaw, hit: new Set(), startedAt: now }
      this.telegraph(room, { kind: 'charge', pos: [p.state.pos[0], p.state.pos[1], p.state.pos[2]], dir: [-Math.sin(yaw), 0, -Math.cos(yaw)], radius: BOSS.charge.speed * BOSS.charge.durationMs / 1000, endsAt: now + BOSS.charge.windupMs })
      return true
    }
    return false
  }

  private slamHit(room: Room, p: Player, humans: Player[]): void {
    for (const h of humans) {
      const dx = h.state.pos[0] - p.state.pos[0], dz = h.state.pos[2] - p.state.pos[2]
      if (Math.hypot(dx, dz) > BOSS.slam.radiusM || Math.abs(h.state.pos[1] - p.state.pos[1]) > 2.5) continue
      this.hurtHuman(room, p, h, BOSS.slam.damage, BOSS.slam.knockHoriz, BOSS.slam.knockUp)
    }
  }

  private hurtHuman(room: Room, boss: Player, h: Player, damage: number, horiz: number, up: number): void {
    const dmg = Math.max(1, Math.round(damage * (this.ctx.difficulty === 'hard' ? 1.25 : this.ctx.difficulty === 'easy' ? 0.7 : 1)))
    if (room.serverNow >= h.invulnUntil && h.alive && h.hp > 0 && !h.downed) {
      h.hp -= dmg
      h.lastHurtAt = room.serverNow
      if (h.hp <= 0) { h.killerId = boss.id; h.killWeapon = 9; h.killHeadshot = false }
      h.transport.send({ t: MsgType.Hurt, origin: [boss.state.pos[0], boss.state.pos[1] + 1.6, boss.state.pos[2]], damage: dmg })
    }
    const dx = h.state.pos[0] - boss.state.pos[0], dz = h.state.pos[2] - boss.state.pos[2], dl = Math.hypot(dx, dz) || 1
    h.state.vel[0] += dx / dl * horiz; h.state.vel[2] += dz / dl * horiz; h.state.vel[1] += up
    h.state.grounded = false
  }

  private telegraph(room: Room, o: Telegraph): void {
    const msg = { t: MsgType.Telegraph, kind: o.kind, pos: o.pos, radius: o.radius, endsAt: o.endsAt, ...(o.dir ? { dir: o.dir } : null) } as const
    for (const q of room.players.values()) if (!q.npc) q.transport.send(msg)
  }
}
interface Telegraph { kind: 'slam' | 'charge' | 'summon'; pos: [number, number, number]; dir?: [number, number, number]; radius: number; endsAt: number }

/** Attach a collision world to the zombie NPC once it has loaded (asynchronous, like bots). Tests may set room.npcWorld to use a fake world. */
export function attachNpcWorld(room: Room, p: Player): void {
  const make = room.npcWorld
  if (make) { Promise.resolve(make()).then(w => { if (room.players.get(p.id) === p) p.world = w; else w.dispose() }); return }
  const cfg = defaultMovement
  createWorld(room.map, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(w => {
    if (room.players.get(p.id) === p) p.world = w
    else w.dispose()
  })
}
void DT; void ZOMBIE_AI
