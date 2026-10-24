import {
  Btn, DT, MatchPhase, NetFlag, INPUT_STARVE_GRACE_TICKS, INPUT_GAP_WAIT_TICKS, MAX_INPUTS_PER_TICK, MAX_INPUT_QUEUE, MsgType, SEQ_AHEAD_SLACK_MS, SNAPSHOT_EVERY_TICKS, TICK_RATE, VOID_Y,
  WEAPONS, ZOMBIE, CLAW_HEAVY_ID, DEFENSE, fallDamage, DOWNED_BUTTON_MASK, DOWNED_WEAPON_SLOT, isValidCmd, movementFor, phaseButtonMask, moveSpeedMul, adsMoveFor, adsWanted, recoverRecoil, stateToNet, stepMovement, stepWeaponCmd, weaponStatesEqual, copyWeaponState, makeWeaponState,
  type MovementConfig, type NetPlayer,
} from '@fps/shared'
import type { Player, Room } from './room'
import { resolveShot } from './shooting'
import { spawnThrown, stepGrenades } from './grenades'
import { stepWeaponDrops } from './weaponDrops'
import { pruneSmokes } from './smoke'
import { updateMatch } from './match'

// When there is no new input, keep the movement direction but do not repeat one-shot actions
const HELD_MASK = ~(Btn.Jump | Btn.Fire | Btn.Reload | Btn.Ability | Btn.Sniff)
const MAX_CMDS_PER_MSG = 16

// Client cmds are untrusted: drop invalid ones; if the queue gets too long, drop the oldest cmd.
// The queue is kept sorted by seq without duplicates: an unreliable channel delivers packets late, out of order and with repeats of the same cmds.
// seq drives weapon timing (fire rate/reload), so it must not run faster than real time:
// a cmd whose seq exceeds SEQ_AHEAD_SLACK_MS relative to the first cmd's reference is dropped (seq jumps, bursts).
export function enqueueCmds(p: Player, cmds: unknown, nowMs: number = performance.now()): void {
  if (!Array.isArray(cmds)) return
  for (let i = 0; i < cmds.length && i < MAX_CMDS_PER_MSG; i++) {
    const c = cmds[i]
    if (!isValidCmd(c)) continue
    const offset = nowMs - c.seq * 1000 / TICK_RATE
    if (p.seqOffset === null) p.seqOffset = offset
    else if (offset < p.seqOffset - SEQ_AHEAD_SLACK_MS) continue
    if (c.seq <= p.lastProcessedSeq) continue   // already simulated: a repeat of a cmd that was sent redundantly
    const q = p.inputQueue
    let at = q.length
    while (at > 0 && q[at - 1]!.seq > c.seq) at--
    if (at > 0 && q[at - 1]!.seq === c.seq) continue   // already queued
    q.splice(at, 0, c)
    if (q.length > MAX_INPUT_QUEUE) q.shift()
  }
}

// Transforming (plan 16): invulnerable, stationary, cannot shoot. The client applies the same rule via NetFlag.Transform
function buttonMask(p: Player, room: Room | null): number {
  if (room && room.serverNow < p.transformUntil) return 0
  const m = phaseButtonMask(room?.phase ?? MatchPhase.Playing, p.alive)
  return p.downed ? m & DOWNED_BUTTON_MASK : m   // downed: no jumping/crouching/throwing grenades
}

// Landing after a fall (not grounded on the previous step, grounded on this one): deduct health by fall speed, CS style.
// Living players only (zombies jumping from heights is normal; invulnerable right after respawn; downed players take no extra damage).
// Running out of health from a fall = suicide (killerId = self, like falling off the map).
function applyFallDamage(p: Player, room: Room | null, wasGrounded: boolean, velYBefore: number, gravity: number): void {
  if (wasGrounded || !p.state.grounded || !room || !p.alive || p.zstats || p.downed || p.hp <= 0 || room.serverNow < p.invulnUntil) return
  const damage = fallDamage(-(velYBefore - gravity * DT))   // velocity before movement zeroes vel.y on landing
  if (damage <= 0) return
  p.hp -= damage
  p.lastHurtAt = room.serverNow
  if (p.hp <= 0) { p.killerId = p.id; p.killWeapon = p.weapon.current; p.killHeadshot = false }
  const pos = p.state.pos
  p.transport.send({ t: MsgType.Hurt, origin: [pos[0], pos[1], pos[2]], damage, fall: true })
}

export function stepPlayer(p: Player, baseCfg: MovementConfig, room: Room | null = null): void {
  if (!p.world) return
  const cfg = movementFor(baseCfg, p.zstats, p.speedMult)
  let ran = 0
  while (ran < MAX_INPUTS_PER_TICK && p.inputQueue.length > 0) {
    const head = p.inputQueue[0]!
    if (p.lastProcessedSeq >= 0 && head.seq > p.lastProcessedSeq + 1 && p.transport.unreliableActive?.()) {
      // Only over an unreliable channel (a WebSocket delivers in order, so a gap there is final): a cmd is missing before the head because its packet is late
      // or was lost. Wait for it a few ticks; after that the step is given up and the queue moves on.
      if (ran > 0) break
      p.gapTicks = (p.gapTicks ?? 0) + 1
      if (p.gapTicks <= INPUT_GAP_WAIT_TICKS) break
    }
    p.gapTicks = 0
    const cmd = p.inputQueue.shift()!
    if (cmd.seq <= p.lastProcessedSeq) continue   // duplicate or old
    // Forbidden buttons (dead / countdown / match over): strip the buttons, still step so the player falls to the ground, turns and keeps being acked.
    // The client applies the same phaseButtonMask, so prediction matches.
    const mask = buttonMask(p, room)
    let eff = cmd
    if ((cmd.buttons & ~mask) !== 0) {
      eff = p.deadCmd
      eff.seq = cmd.seq; eff.yaw = cmd.yaw; eff.pitch = cmd.pitch; eff.weapon = cmd.weapon
      eff.buttons = cmd.buttons & mask; eff.fireRenderTime = cmd.fireRenderTime
    }
    if (p.downed) {   // downed: only a pistol can be held (without one, no shooting)
      if (eff === cmd) { eff = p.deadCmd; eff.seq = cmd.seq; eff.yaw = cmd.yaw; eff.pitch = cmd.pitch; eff.buttons = cmd.buttons & mask; eff.fireRenderTime = cmd.fireRenderTime }
      eff.weapon = DOWNED_WEAPON_SLOT
      if ((p.weapon.slots[DOWNED_WEAPON_SLOT] ?? -1) < 0) eff.buttons &= ~(Btn.Fire | Btn.Reload)
    }
    // Speed depends on the weapon held BEFORE this cmd (weapon switches happen at the end of the tick); the client predicts and replays in the same order
    const wasGrounded = p.state.grounded, velYBefore = p.state.vel[1]
    p.state = stepMovement(p.state, eff, p.world, cfg, DT, moveSpeedMul(p.weapon), adsMoveFor(p.weapon), adsWanted(p.weapon, eff.buttons, cmd.seq * 1000 / TICK_RATE))
    applyFallDamage(p, room, wasGrounded, velYBefore, cfg.gravity)
    p.lastProcessedSeq = cmd.seq
    p.lastCmd = cmd
    p.flashlight = p.alive && !p.zstats && (eff.buttons & Btn.Flashlight) !== 0
    if (room && eff.buttons !== 0) room.mode.onCmd?.(room, p, eff.buttons)
    // Runs even when dead (buttons are masked so no shooting): wantSlot/reload completion matches the client's prediction
    const ev = stepWeaponCmd(p.weapon, eff)
    if (ev === 'fired' && p.alive) {
      p.shotsFired++
      p.invulnUntil = 0   // the first valid shot ends invulnerability
      if (room) {
        const cur = WEAPONS[p.weapon.current]!
        const windup = cur.id === CLAW_HEAVY_ID ? ZOMBIE.heavyWindupMs : cur.category === 'claw' ? p.zstats?.windupMs ?? 0 : 0
        if (windup > 0) p.pendingClaw = { at: room.serverNow + windup, cmd: { ...eff }, defId: cur.id }   // telegraphed claw: a player who backs off in time is missed
        else resolveShot(p, room, eff, baseCfg)
      }
    } else if (room && p.alive && (ev === 'pull' || ev === 'cancel' || ev === 'threw')) {
      // Grenade: the animation is drawn for others; a real throw creates the grenade (state is already post this cmd)
      const mode = p.weapon.nade.mode
      if (ev === 'threw') { p.invulnUntil = 0; spawnThrown(room, p, mode, cfg) }
      const kind = WEAPONS[p.weapon.current]!.key
      const anim = { t: MsgType.GrenadeAnim, playerId: p.id, phase: ev === 'pull' ? 'pulling' : ev === 'threw' ? 'throw' : 'cancel', mode, ...(kind === 'm67' ? {} : { kind }) } as const
      for (const o of room.players.values()) o.transport.send(anim)
    }
    recoverRecoil(p.recoil, WEAPONS[p.weapon.current]!, p.weapon, cmd.seq * 1000 / TICK_RATE, DT)
    ran++
  }
  if (ran > 0) { p.starvedTicks = 0; return }

  // Queue empty. A cmd arriving a few ms late due to jitter is normal: running an 'idle' step right away
  // would advance the server one step the client never predicted -> constant reconcile drift. So wait at
  // most INPUT_STARVE_GRACE_TICKS ticks (a late cmd is made up for, at most MAX_INPUTS_PER_TICK per tick).
  // Only run idle for players who have sent no cmd yet (lastCmd null) or have been silent too long.
  p.starvedTicks++
  if (p.lastCmd && p.starvedTicks <= INPUT_STARVE_GRACE_TICKS) return

  // Keep running lastCmd with Jump/Fire/Reload removed, without advancing lastProcessedSeq
  const idle = p.idleCmd
  const last = p.lastCmd
  idle.buttons = last ? last.buttons & HELD_MASK & buttonMask(p, room) : 0
  idle.yaw = last ? last.yaw : p.state.yaw
  idle.pitch = last ? last.pitch : p.state.pitch
  const wasGrounded = p.state.grounded, velYBefore = p.state.vel[1]
  p.state = stepMovement(p.state, idle, p.world, cfg, DT, moveSpeedMul(p.weapon), adsMoveFor(p.weapon), false)
  applyFallDamage(p, room, wasGrounded, velYBefore, cfg.gravity)
}

// Heavy claw reaching its hit time (positions re-measured now: a player who backs off in time is missed) + zombie health regen
function stepZombieExtras(p: Player, room: Room, baseCfg: MovementConfig): void {
  const pc = p.pendingClaw
  if (pc && room.serverNow >= pc.at) {
    p.pendingClaw = null
    if (p.alive && p.zstats) resolveShot(p, room, pc.cmd, baseCfg, WEAPONS[pc.defId])
  }
  const z = p.zstats
  if (z && p.alive && p.hp > 0 && p.hp < z.hpMax && room.serverNow - p.lastHurtAt >= ZOMBIE.regenDelayMs) {
    p.hp = Math.min(z.hpMax, p.hp + z.regenPerSec * DT)
  }
}

// serverTime = the time of this tick; the hitbox history is recorded at this timestamp after everyone has stepped
export function stepRoom(room: Room, cfg: MovementConfig, serverTime = room.serverNow, tick?: number): void {
  room.serverNow = serverTime
  room.tick = tick ?? room.tick + 1
  for (const p of room.players.values()) {
    if (p.bot && p.world) p.bot.drive(room, p, serverTime)   // the bot generates input before stepping, like a client sending a cmd
    else if (p.npc && p.world && p.alive) p.npc.drive(room, p, serverTime)
    stepPlayer(p, cfg, room)
    stepZombieExtras(p, room, cfg)
    if (p.alive && p.state.pos[1] < VOID_Y) { p.hp = 0; p.killerId = p.id; p.killWeapon = p.weapon.current; p.killHeadshot = false }   // fell off the map
  }
  room.finalizeDeaths()
  pruneSmokes(room)
  stepGrenades(room)   // after finalizeDeaths: grenades dropped by players who just died are already in the list
  stepWeaponDrops(room)   // likewise for guns dropped by players who just died
  room.respawnDue()
  updateMatch(room)
  room.history.record(serverTime, room.players.values())
}

// The snapshot contains everyone; only `ack` differs between clients
export function sendSnapshots(room: Room, tick: number, serverTime: number): void {
  if (tick % SNAPSHOT_EVERY_TICKS !== 0 || room.players.size === 0) return
  const players: NetPlayer[] = []
  for (const p of room.players.values()) {
    const flags = (p.alive ? 0 : NetFlag.Dead) | (p.alive && serverTime < p.invulnUntil ? NetFlag.Invuln : 0)
      | (p.zstats ? NetFlag.Zombie : 0) | (p.hero ? NetFlag.Hero : 0) | (p.flashlight ? NetFlag.Flashlight : 0) | (serverTime < p.transformUntil ? NetFlag.Transform : 0)
    const np = stateToNet(p.id, p.state, Math.max(0, p.hp), flags, p.team, p.weapon.current, p.killStreak)
    if (p.zstats && p.sniffReadyAt > serverTime) { np.sniffCd = p.sniffReadyAt - serverTime; if (p.sniffUntil > serverTime) np.sniffLeft = p.sniffUntil - serverTime }
    if (p.zstats) { np.hpMax = p.zstats.hpMax; np.runSpeed = p.zstats.runSpeed; np.ztype = p.zstats.type; if (p.zstats.scale && p.zstats.scale !== 1) np.zscale = p.zstats.scale }
    if (p.downed) { np.flags |= NetFlag.Downed; np.downLeft = Math.max(0, p.downUntil - serverTime); if (p.reviveProgressMs > 0) np.reviveP = Math.min(1, p.reviveProgressMs / DEFENSE.down.reviveMs) }
    players.push(np)
  }
  for (const p of room.players.values()) {
    if (p.npc) continue   // NPC zombies have no connection
    // The weapon state (~300 bytes) and the loadout (~60) are the receiver's own and rarely change: send them only when they differ from what this client
    // already holds (the connection is ordered and reliable; the client keeps the last one, net/snapshots.ts). The first snapshot always carries both.
    // Not over an unreliable channel though: a lost snapshot would leave the client with a stale weapon state until the next change. Then everything is sent
    // every time, and the first snapshot after going back to the WebSocket is a full one again.
    if (p.transport.unreliableActive?.()) p.snapSent = undefined
    const sent = p.snapSent
    const loadoutKey = JSON.stringify(p.loadout.slots)
    const wpnChanged = !sent || !weaponStatesEqual(sent.wpn, p.weapon) || sent.wpn.magMult !== p.weapon.magMult
    const loadoutChanged = !sent || sent.loadout !== loadoutKey
    if ((wpnChanged || loadoutChanged) && !p.transport.unreliableActive?.()) {
      const ss = p.snapSent ??= { wpn: makeWeaponState(p.weapon.slots, p.weapon.magMult), loadout: loadoutKey }
      if (wpnChanged) { ss.wpn.magMult = p.weapon.magMult; copyWeaponState(ss.wpn, p.weapon) }
      ss.loadout = loadoutKey
    }
    p.transport.send({ t: MsgType.Snapshot, tick, serverTime, ack: p.lastProcessedSeq, players, ...(wpnChanged ? { wpn: p.weapon } : null), money: p.money, ...(loadoutChanged ? { loadout: p.loadout.slots } : null) })
  }
}
