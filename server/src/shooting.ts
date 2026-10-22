import {
  MAX_PELLETS, MAX_REWIND_MS, MsgType, WEAPONS, TICK_RATE, ZOMBIE, CLAW_HEAVY_ID, computeShotDirs, computeSpreadDeg, damageFalloff, hitboxesFor, rayAabb, movementFor, knockbackImpulse, applyKnockback,
  type HitBox, type ShotFxMsg, type InputCmd, type MovementConfig, type PlayerState, type WeaponDef,
} from '@fps/shared'
import type { Player, Room } from './room'
import type { PastPlayer } from './lagComp'

const dirs: [number, number, number][] = Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])
const hitTotals = new Map<number, { damage: number; headshot: boolean }>()
const eye: [number, number, number] = [0, 0, 0]
const past: PastPlayer = { pos: [0, 0, 0], crouching: false, alive: true }
// hitboxesFor only reads pos/crouching
const pastState = { pos: past.pos, crouching: false } as unknown as PlayerState
const kbImp: [number, number, number] = [0, 0, 0]

// Time to rewind to: fireRenderTime clamped to [serverNow - MAX_REWIND_MS, serverNow];
// without fireRenderTime there is no rewind.
export function rewindTime(fireRenderTime: number | undefined, serverNow: number): number {
  if (fireRenderTime === undefined) return serverNow
  return Math.min(serverNow, Math.max(serverNow - MAX_REWIND_MS, fireRenderTime))
}

// Score one shot by `shooter` (the cmd just ran, state is already post-cmd). Opponents are rewound to cmd.fireRenderTime (lag compensation); walls and the shooter are not.
// Ray origin = shooter's eye; direction = yaw/pitch + recoil + spread (seed playerId, shotSeq) like the client;
// walls: castRay in the shooter's own world; other players: ray vs AABB.
export function resolveShot(shooter: Player, room: Room, cmd: InputCmd, baseCfg: MovementConfig, defOverride?: WeaponDef): void {
  const ws = shooter.weapon
  const def = defOverride ?? WEAPONS[ws.current]!
  const s = shooter.state
  const cfg = movementFor(baseCfg, shooter.zstats, shooter.speedMult)
  // Zombie claw: damage depends on the zombie type; a heavy claw doubles it
  const baseDamage = shooter.zstats && def.category === 'claw'
    ? shooter.zstats.clawDamage * (def.id === CLAW_HEAVY_ID ? ZOMBIE.heavyDamageMult : 1)
    : def.damage * shooter.damageMult

  const pellets = computeShotDirs(dirs, shooter.recoil, def, shooter.id, ws.shotSeq - 1, cmd.yaw, cmd.pitch, computeSpreadDeg(s, ws, def, cfg, cmd.seq * 1000 / TICK_RATE, true))
  eye[0] = s.pos[0]; eye[1] = s.pos[1] + (s.crouching ? cfg.eyeCrouch : cfg.eyeStand); eye[2] = s.pos[2]

  const t = rewindTime(cmd.fireRenderTime, room.serverNow)
  if (cmd.fireRenderTime !== undefined && cmd.fireRenderTime < t) shooter.rewindClamped++   // rewind request beyond the limit
  const rewound = t < room.serverNow && room.history.locate(t)
  const debugBoxes: HitBox[] | null = shooter.debugShots ? [] : null

  // Accumulate the damage of all rays per victim (one Hurt + one HitConfirm per player per shot)
  hitTotals.clear()
  const dists: number[] = []
  for (let k = 0; k < pellets; k++) {
    const dir = dirs[k]!
    const wallHit = shooter.world?.castRay(eye, dir, def.range) ?? null
    let bestDist = wallHit ? wallHit.dist : def.range
    let hitId = -1
    let hitPart: 'head' | 'body' | 'legs' = 'body'

    for (const other of room.players.values()) {
      if (other === shooter) continue
      if (other.team === shooter.team && !room.rules.friendlyFire) continue   // teammate: bullets pass through
      let state: PlayerState = other.state
      let alive = other.alive
      if (rewound && room.history.get(other.id, past)) {
        pastState.crouching = past.crouching
        state = pastState
        alive = past.alive
      }
      if (!alive) continue
      for (const box of hitboxesFor(state, movementFor(baseCfg, other.zstats, other.speedMult), other.zstats?.scale ?? 1)) {
        if (k === 0) debugBoxes?.push(box)
        const d = rayAabb(eye, dir, box, bestDist)
        if (d !== null && d < bestDist) { bestDist = d; hitId = other.id; hitPart = box.part }
      }
    }
    dists.push(bestDist)

    if (hitId >= 0) {
      const hm = room.players.get(hitId)?.zstats?.headMult ?? def.headMult   // Defense zombies: head x2 (boss x3) regardless of the gun
      const mult = hitPart === 'head' ? hm : hitPart === 'legs' ? def.legMult : 1
      const dmg = Math.round(baseDamage * mult * damageFalloff(def, bestDist))
      const tot = hitTotals.get(hitId)
      if (tot) { tot.damage += dmg; tot.headshot ||= hitPart === 'head' }
      else hitTotals.set(hitId, { damage: dmg, headshot: hitPart === 'head' })
    }
  }
  if (debugBoxes) {
    shooter.transport.send({
      t: MsgType.DebugShot,
      origin: [eye[0], eye[1], eye[2]], dir: [dirs[0]![0], dirs[0]![1], dirs[0]![2]], boxes: debugBoxes,
    })
  }

  for (const [hitId, tot] of hitTotals) {
    const target = room.players.get(hitId)!
    const damage = tot.damage
    const headshot = tot.headshot
    // Invulnerability uses the server's current time (no rewind). Only living players not yet settled as dead lose health.
    const invuln = room.serverNow < target.invulnUntil
    // Zombies do not attack downed players (so teammates have time to rescue; downed players only die when the bleed-out timer ends)
    const applied = invuln || !target.alive || target.hp <= 0 || (target.downed && shooter.npc) ? 0 : Math.round(damage * target.takenMult)
    if (applied > 0) {
      target.hp -= applied
      target.lastHurtAt = room.serverNow
      room.mode.onDamage?.(room, shooter, target, applied)
      if (target.zstats && !def.melee) {   // a zombie hit by bullets is knocked back (shotguns push very hard), including being thrown off ledges while airborne
        const dx = target.state.pos[0] - s.pos[0], dz = target.state.pos[2] - s.pos[2]
        const dl = Math.hypot(dx, dz) || 1
        knockbackImpulse(kbImp, def.key, applied, target.zstats.knockbackResist, dx / dl, dz / dl, !target.state.grounded)
        applyKnockback(target.state.vel, kbImp)
      }
      if (target.hp <= 0) { target.killerId = shooter.id; target.killWeapon = def.id; target.killHeadshot = headshot }
      target.transport.send({ t: MsgType.Hurt, origin: [eye[0], eye[1], eye[2]], damage: applied })
      if (shooter.zstats?.shoveSpeed && def.melee && !target.zstats) {   // brute: a claw hit knocks the player back (off wall ledges!)
        const dx = target.state.pos[0] - s.pos[0], dz = target.state.pos[2] - s.pos[2], dl = Math.hypot(dx, dz) || 1
        target.state.vel[0] += dx / dl * shooter.zstats.shoveSpeed; target.state.vel[2] += dz / dl * shooter.zstats.shoveSpeed
      }
    }
    shooter.transport.send({ t: MsgType.HitConfirm, damage: applied, headshot, targetId: hitId })
  }

  const fx: ShotFxMsg = {
    t: MsgType.ShotFx, shooterId: shooter.id, weapon: def.id,
    origin: [eye[0], eye[1], eye[2]],
    dir: [dirs[0]![0], dirs[0]![1], dirs[0]![2]],
    dist: dists[0]!,
  }
  if (pellets > 1) {
    fx.extra = []
    for (let k = 1; k < pellets; k++) fx.extra.push({ dir: [dirs[k]![0], dirs[k]![1], dirs[k]![2]], dist: dists[k]! })
  }
  for (const other of room.players.values()) if (other !== shooter) other.transport.send(fx)
}
