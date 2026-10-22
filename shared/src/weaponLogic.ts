import { WEAPONS, SWITCH_MS, MAX_PELLETS, GRENADE_IDS, isGrenadeId, magSizeOf, GRENADE_SLOT, CLAW_ID, CLAW_HEAVY_ID } from './weapons'
import { onShotBloom } from './spread'
import { GRENADE } from './grenade'
import type { WeaponDef, WeaponState } from './weapons'
import { hashSeed, mulberry32 } from './math'
import { shootDir } from './hitbox'
import { Btn } from './movement'
import type { AdsMove, InputCmd } from './movement'
import { TICK_RATE } from './constants'

const DEG = Math.PI / 180

// Accumulated recoil (rad), separate from the mouse yaw/pitch
export interface RecoilState {
  pitch: number
  yaw: number
}

export function makeRecoilState(): RecoilState {
  return { pitch: 0, yaw: 0 }
}

export type WeaponEvent = 'none' | 'fired' | 'dry' | 'reloadStart' | 'reloadEnd' | 'switched' | 'pull' | 'cancel' | 'threw'

/** Start reloading if needed. Returns true if it actually started. */
export function startReload(ws: WeaponState, def: WeaponDef, nowMs: number): boolean {
  if (ws.reloadEndMs > 0) return false
  if (ws.ammo[def.id]! >= magSizeOf(def, ws.magMult)) return false
  ws.reloadEndMs = nowMs + def.reloadMs
  return true
}

/** Switch weapon, cancelling any reload in progress. Locks firing for SWITCH_MS. */
export function switchWeapon(ws: WeaponState, id: number, nowMs: number): boolean {
  if (id === ws.current || id < 0 || id >= WEAPONS.length) return false
  ws.current = id
  ws.reloadEndMs = 0
  ws.switchEndMs = nowMs + SWITCH_MS
  if (!isGrenadeId(id)) ws.nextFireMs = Math.max(ws.nextFireMs, nowMs + SWITCH_MS)   // grenades do not lock: the pin pull (0.35s) runs in parallel with the raise animation
  ws.nade.phase = 'idle'   // switching weapon mid pin-pull: cancel (if not thrown yet the grenade is kept)
  ws.switchBackAtMs = 0
  return true
}

/** The other grenade type than `id` that still has some left (HE ↔ smoke), or -1 */
export function otherNade(ws: WeaponState, id: number): number {
  for (const g of GRENADE_IDS) if (g !== id && (ws.ammo[g] ?? 0) > 0) return g
  return -1
}

/** Switch to slot `slot` if it has a weapon. Empty slot / already held → false. */
export function selectSlot(ws: WeaponState, slot: number, nowMs: number): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot >= ws.slots.length) return false
  let id = ws.slots[slot]!
  if (id < 0) return false
  if (slot === GRENADE_SLOT && (ws.ammo[id] ?? 0) <= 0) {   // the selected type is out but the other remains: select the other
    id = otherNade(ws, id)
    if (id < 0) return false
    ws.slots[slot] = id
  }
  if (slot === GRENADE_SLOT && ws.slot !== GRENADE_SLOT) ws.prevSlot = ws.slot   // remember the weapon slot to switch back to after the throw
  ws.slot = slot
  return switchWeapon(ws, id, nowMs)
}

/** Run-speed multiplier by held weapon (the ADS part goes separately via adsMoveFor + adsT). */
export function moveSpeedMul(ws: WeaponState): number {
  return WEAPONS[ws.current]?.moveSpeedMul ?? 1
}

/** ADS parameters of the held weapon for stepMovement (null = weapon cannot ADS). Returns a shared per-weapon object, no allocation. */
const ADS_MOVE: (AdsMove | null)[] = WEAPONS.map(w => (w.ads ? { inMs: w.ads.inMs, outMs: w.ads.outMs, moveMult: w.ads.moveMult } : null))
export function adsMoveFor(ws: WeaponState): AdsMove | null {
  return ADS_MOVE[ws.current] ?? null
}
/** Wants to ADS in this cmd: Aim held, not reloading, not in the weapon-switch lock. (On ground / not sliding is checked by stepMovement.) */
export function adsWanted(ws: WeaponState, buttons: number, nowMs: number): boolean {
  return (buttons & Btn.Aim) !== 0 && ws.reloadEndMs === 0 && nowMs >= ws.switchEndMs
}

/**
 * Fire if possible. Does not fire when: reloading, before nextFireMs, out of ammo,
 * or a semi-auto weapon whose trigger has been held since the previous tick.
 * Always updates triggerHeld from triggerDown.
 */
export function tryFire(ws: WeaponState, def: WeaponDef, nowMs: number, triggerDown: boolean): boolean {
  const wasHeld = ws.triggerHeld
  ws.triggerHeld = triggerDown
  if (!triggerDown) return false
  if (ws.reloadEndMs > 0) return false
  if (nowMs < ws.nextFireMs) return false
  if (!def.melee && ws.ammo[def.id]! <= 0) return false
  if (!def.auto && wasHeld) return false

  if (!def.melee) ws.ammo[def.id]!--
  ws.nextFireMs = nowMs + def.fireIntervalMs
  ws.shotSeq++
  if (!def.melee) onShotBloom(ws, def, nowMs)   // store the bloom used for this shot (ws.shotBloomDeg), then add the new bloom
  return true
}

/**
 * One weapon logic tick. Order: finish reload → reload via R → fire / pull the trigger when empty.
 * Out of ammo and the trigger is pulled (a fresh press or an auto weapon) → 'dry' + auto reload, exactly once.
 */
export function stepWeapon(
  ws: WeaponState,
  nowMs: number,
  triggerDown: boolean,
  reloadPressed: boolean,
): WeaponEvent {
  const def = WEAPONS[ws.current]!

  if (ws.reloadEndMs > 0 && nowMs >= ws.reloadEndMs) {
    ws.reloadEndMs = 0
    ws.ammo[def.id] = magSizeOf(def, ws.magMult)
    ws.triggerHeld = triggerDown   // mouse held through reload completion: a semi-auto weapon does not fire by itself
    return 'reloadEnd'
  }

  if (reloadPressed && startReload(ws, def, nowMs)) return 'reloadStart'

  if (tryFire(ws, def, nowMs, triggerDown)) return 'fired'

  if (!def.melee && triggerDown && ws.reloadEndMs === 0 && ws.ammo[def.id]! <= 0 && nowMs >= ws.nextFireMs) {
    startReload(ws, def, nowMs)
    return 'dry'
  }
  return 'none'
}

/**
 * Fire direction = look angle + current recoil + spread (random seeded by playerId, shotSeq),
 * then add this shot's kick to the recoil. `shotSeq` is the seq of the shot just fired (ws.shotSeq - 1).
 * Writes the result into `out`.
 */
export function computeShot(
  out: [number, number, number],
  rec: RecoilState,
  def: WeaponDef,
  playerId: number,
  shotSeq: number,
  yaw: number,
  pitch: number,
  spreadDeg: number,
): void {
  const rng = mulberry32(hashSeed(playerId, shotSeq))
  // Uniform point in a disc of radius spread (cone)
  const r   = spreadDeg * DEG * Math.sqrt(rng())
  const phi = rng() * 2 * Math.PI
  const kickYaw = (rng() * 2 - 1) * def.recoilYawDeg * DEG

  const d = shootDir(yaw + rec.yaw + r * Math.cos(phi), pitch + rec.pitch + r * Math.sin(phi))
  out[0] = d[0]; out[1] = d[1]; out[2] = d[2]

  rec.pitch += def.recoilPitchDeg * DEG
  rec.yaw   += kickYaw
}

/**
 * Fire directions for every ray of one shot (normal weapons: 1 ray). Random spread seeded by (playerId, shotSeq[, ray index]);
 * recoil is added only once, after all rays are computed. Returns the ray count, writes into outs[0..n).
 */
export function computeShotDirs(
  outs: [number, number, number][],
  rec: RecoilState,
  def: WeaponDef,
  playerId: number,
  shotSeq: number,
  yaw: number,
  pitch: number,
  spreadDeg: number,
): number {
  const n = def.pellets ?? 1
  if (n === 1) { computeShot(outs[0]!, rec, def, playerId, shotSeq, yaw, pitch, spreadDeg); return 1 }
  // Multiple rays: moving/airborne spread SHIFTS the pattern centre (one random point, own seed at the last ray index),
  // while the pellets scatter inside a fixed cone pelletConeDeg around that centre
  const cone = def.spread.pelletConeDeg ?? spreadDeg
  let cYaw = yaw, cPitch = pitch
  if (def.spread.pelletConeDeg !== undefined && spreadDeg > 0) {
    const rng = mulberry32(hashSeed(playerId, shotSeq * MAX_PELLETS + (MAX_PELLETS - 1)))
    const r = spreadDeg * DEG * Math.sqrt(rng()), phi = rng() * 2 * Math.PI
    cYaw += r * Math.cos(phi); cPitch += r * Math.sin(phi)
  }
  const recPitch = rec.pitch, recYaw = rec.yaw
  for (let i = 0; i < n; i++) {
    rec.pitch = recPitch; rec.yaw = recYaw   // every ray uses the recoil from before the shot
    computeShot(outs[i]!, rec, def, playerId, shotSeq * MAX_PELLETS + i, cYaw, cPitch, cone)
  }
  // rec was reset before the last ray and only then gets the kick, so the kick is added exactly once for the whole shot
  return n
}

/** Damage multiplier by distance (1 if the weapon has no falloff). */
export function damageFalloff(def: WeaponDef, dist: number): number {
  const f = def.falloff
  if (!f || dist <= f.fullM) return 1
  if (dist >= f.endM) return f.minMult
  return 1 + (f.minMult - 1) * (dist - f.fullM) / (f.endM - f.fullM)
}

/** Recoil recovers to 0 when not firing (nowMs >= nextFireMs, or earlier if the weapon has recoilRecoverDelayMs). */
export function recoverRecoil(rec: RecoilState, def: WeaponDef, ws: WeaponState, nowMs: number, dt: number): void {
  const resumeMs = def.recoilRecoverDelayMs === undefined ? ws.nextFireMs : ws.nextFireMs - def.fireIntervalMs + def.recoilRecoverDelayMs
  if (nowMs < resumeMs) return
  const step = def.recoilRecoverDegPerSec * DEG * dt
  rec.pitch = rec.pitch > 0 ? Math.max(0, rec.pitch - step) : Math.min(0, rec.pitch + step)
  rec.yaw   = rec.yaw   > 0 ? Math.max(0, rec.yaw   - step) : Math.min(0, rec.yaw   + step)
}

/**
 * One weapon logic tick per cmd: switch weapon (cmd.weapon) then stepWeapon. Time = seq * 1000 / TICK_RATE
 * (not the server tick) so client and server compute fire rate/reload identically.
 */
export function stepWeaponCmd(ws: WeaponState, cmd: InputCmd): WeaponEvent {
  const nowMs = cmd.seq * 1000 / TICK_RATE
  // cmd.weapon = slot 0–4. Only switch when the value CHANGES versus the previous cmd: buying a weapon makes the server change the slot first, an old cmd still in flight
  // carries the old slot but must not drag it back.
  if (cmd.weapon !== ws.wantSlot) {
    ws.wantSlot = cmd.weapon
    selectSlot(ws, cmd.weapon, nowMs)
  }
  // After a throw (G or last grenade): auto-switch back to the previous weapon
  let autoSwitched = false
  if (ws.switchBackAtMs > 0 && nowMs >= ws.switchBackAtMs) {
    ws.switchBackAtMs = 0
    if (isGrenadeId(ws.current) && ws.nade.phase === 'idle') {
      const back = (ws.slots[ws.prevSlot] ?? -1) >= 0 ? ws.prevSlot : ws.slots.findIndex((id, i) => id >= 0 && i !== GRENADE_SLOT)
      // do NOT set wantSlot: this is a logic-driven switch (like buying a weapon), an old in-flight cmd carrying the old slot must not drag it back; the client picks up ws.slot when it sees 'switched'
      if (back >= 0) { selectSlot(ws, back, nowMs); autoSwitched = true }
    }
  }
  const quickDown = !!(cmd.buttons & Btn.QuickNade)
  const ev = stepGrenade(ws, cmd, nowMs, quickDown)
  if (ev !== null) return ev === 'none' && autoSwitched ? 'switched' : ev   // holding a grenade (or just pressed G): do not run weapon logic
  let trigger = !!(cmd.buttons & Btn.Fire)
  if (WEAPONS[ws.current]!.category === 'claw') {
    // Zombie: left mouse = normal claw, right mouse (Aim) = heavy claw; both share the fire cadence (nextFireMs)
    const heavy = !!(cmd.buttons & Btn.Aim)
    ws.current = heavy ? CLAW_HEAVY_ID : CLAW_ID
    trigger = trigger || heavy
  }
  if (autoSwitched) { stepWeapon(ws, nowMs, trigger, !!(cmd.buttons & Btn.Reload)); return 'switched' }
  return stepWeapon(ws, nowMs, trigger, !!(cmd.buttons & Btn.Reload))
}

/**
 * Grenade (plan 12): G = take out + pull the pin immediately (strong throw), holding slot 5 then Fire = strong throw, Aim = low throw.
 * Hold ≥ pinPullMs to become "ready"; release when ready = throw; release before that = cancel. No "cooking": the fuse only burns after leaving the hand.
 * Returns null if this tick has no grenade work (so normal weapon logic runs).
 */
function stepGrenade(ws: WeaponState, cmd: InputCmd, nowMs: number, quickDown: boolean): WeaponEvent | null {
  const n = ws.nade
  const fireD = !!(cmd.buttons & Btn.Fire), aimD = !!(cmd.buttons & Btn.Aim)
  const cycleEdge = !!(cmd.buttons & Btn.CycleNade) && !ws.cycleHeld
  ws.cycleHeld = !!(cmd.buttons & Btn.CycleNade)
  let ev: WeaponEvent | null = null

  // G while holding something else: go to the grenade slot (selected type) + pull the pin immediately
  const sel = ws.slots[GRENADE_SLOT] ?? -1
  if (quickDown && !isGrenadeId(ws.current) && !ws.quickHeld && sel >= 0 && (ws.ammo[sel] ?? 0) > 0) {
    selectSlot(ws, GRENADE_SLOT, nowMs)   // switch driven by logic (does not touch wantSlot): the client does not send the grenade slot when G is pressed
    n.phase = 'pulling'; n.mode = 'strong'; n.pressSeq = cmd.seq; n.quick = true
    ev = 'pull'
  }
  ws.quickHeld = quickDown
  if (!isGrenadeId(ws.current)) return null

  // Press the grenade key again while holding one (pin not pulled yet): switch to another type that still has some, like CS 1.6
  if (cycleEdge && ev === null && n.phase === 'idle') {
    const other = otherNade(ws, ws.current)
    if (other >= 0) {
      ws.slots[GRENADE_SLOT] = other
      switchWeapon(ws, other, nowMs)
      ws.triggerHeld = !!(cmd.buttons & (Btn.Fire | Btn.Aim | Btn.QuickNade))
      return 'switched'
    }
  }

  const anyDown = fireD || aimD || quickDown
  const wasDown = ws.triggerHeld
  const cur = ws.current
  if (ev === null) {
    if (n.phase === 'idle') {
      if (anyDown && !wasDown && nowMs >= ws.nextFireMs && (ws.ammo[cur] ?? 0) > 0) {
        n.phase = 'pulling'; n.mode = aimD && !fireD && !quickDown ? 'lob' : 'strong'; n.pressSeq = cmd.seq; n.quick = quickDown
        ev = 'pull'
      }
    } else {
      const held = n.mode === 'lob' ? aimD : (fireD || quickDown)
      if (n.phase === 'pulling') {
        if (!held) {
          n.phase = 'idle'
          ev = 'cancel'
          if (n.quick) ws.switchBackAtMs = nowMs   // G released early: back to the old weapon immediately
          n.quick = false
        } else if ((cmd.seq - n.pressSeq) * 1000 / TICK_RATE >= GRENADE.pinPullMs) n.phase = 'ready'
      } else if (!held) {   // ready + release = throw
        n.phase = 'idle'
        ws.ammo[cur]!--
        ws.throwSeq++
        ws.nextFireMs = nowMs + GRENADE.throwCooldownMs
        if (ws.ammo[cur]! <= 0) ws.slots[GRENADE_SLOT] = otherNade(ws, cur)   // this type ran out: pick the other if any, else empty slot (-1)
        if (ws.ammo[cur]! <= 0 || n.quick) ws.switchBackAtMs = nowMs + GRENADE.autoSwitchBackMs
        n.quick = false
        ev = 'threw'
      }
    }
  } else if (n.phase === 'pulling' && (cmd.seq - n.pressSeq) * 1000 / TICK_RATE >= GRENADE.pinPullMs) n.phase = 'ready'
  ws.triggerHeld = anyDown
  return ev ?? 'none'
}

export function copyWeaponState(dst: WeaponState, src: WeaponState): void {
  dst.current = src.current
  dst.slot = src.slot
  dst.wantSlot = src.wantSlot
  for (let i = 0; i < src.slots.length; i++) dst.slots[i] = src.slots[i]!
  for (let i = 0; i < src.ammo.length; i++) dst.ammo[i] = src.ammo[i]!
  dst.nade.phase = src.nade.phase; dst.nade.mode = src.nade.mode; dst.nade.pressSeq = src.nade.pressSeq; dst.nade.quick = src.nade.quick
  dst.throwSeq = src.throwSeq
  dst.prevSlot = src.prevSlot
  dst.switchBackAtMs = src.switchBackAtMs
  dst.quickHeld = src.quickHeld
  dst.cycleHeld = src.cycleHeld
  dst.reloadEndMs = src.reloadEndMs
  dst.nextFireMs = src.nextFireMs
  dst.shotSeq = src.shotSeq
  dst.triggerHeld = src.triggerHeld
  for (let i = 0; i < src.bloomDeg.length; i++) { dst.bloomDeg[i] = src.bloomDeg[i]!; dst.lastShotMs[i] = src.lastShotMs[i]! }
  dst.shotBloomDeg = src.shotBloomDeg
  dst.switchEndMs = src.switchEndMs
  dst.magMult = src.magMult
}

export function weaponStatesEqual(a: WeaponState, b: WeaponState): boolean {
  for (let i = 0; i < a.slots.length; i++) if (a.slots[i] !== b.slots[i]) return false
  if (a.nade.phase !== b.nade.phase || a.nade.mode !== b.nade.mode || a.nade.pressSeq !== b.nade.pressSeq || a.nade.quick !== b.nade.quick ||
      a.throwSeq !== b.throwSeq || a.prevSlot !== b.prevSlot || a.switchBackAtMs !== b.switchBackAtMs || a.quickHeld !== b.quickHeld || a.cycleHeld !== b.cycleHeld) return false
  if (a.current !== b.current || a.slot !== b.slot || a.wantSlot !== b.wantSlot || a.reloadEndMs !== b.reloadEndMs || a.nextFireMs !== b.nextFireMs ||
      a.shotSeq !== b.shotSeq || a.triggerHeld !== b.triggerHeld || a.shotBloomDeg !== b.shotBloomDeg || a.switchEndMs !== b.switchEndMs) return false
  for (let i = 0; i < a.bloomDeg.length; i++) if (a.bloomDeg[i] !== b.bloomDeg[i] || a.lastShotMs[i] !== b.lastShotMs[i]) return false
  for (let i = 0; i < a.ammo.length; i++) if (a.ammo[i] !== b.ammo[i]) return false
  return true
}
