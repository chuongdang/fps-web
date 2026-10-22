import { lerp } from './math'
import type { MovementConfig, PlayerState } from './movement'
import type { WeaponDef, WeaponState } from './weapons'

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const smoothstep = (t: number): number => t * t * (3 - 2 * t)

/** Bloom of weapon `def` at time nowMs (seq timescale): recovers after bloomRecoverDelayMs since the most recent shot. */
export function currentBloom(ws: WeaponState, def: WeaponDef, nowMs: number): number {
  const sp = def.spread
  const dt = Math.max(0, (nowMs - ws.lastShotMs[def.id]! - sp.bloomRecoverDelayMs) / 1000)
  return Math.max(0, ws.bloomDeg[def.id]! - sp.bloomRecoverDegPerSec * dt)
}

export interface SpreadParts { base: number; move: number; air: number; bloom: number; mult: number; total: number }

/**
 * Spread (cone half-angle, degrees) of weapon `def` right now, broken down by part (written into `out`, no allocation).
 * Pure: only reads state + nowMs (never the real clock). total = (base + move + air + bloom) × mult (ADS); sniper: lerp(unscopedDeg, …, adsT).
 * `forShot` = use the bloom that was applied to the shot just fired (ws.shotBloomDeg) instead of the current bloom, so the first bullet does not carry its own bloom.
 */
export function spreadParts(out: SpreadParts, p: PlayerState, ws: WeaponState, def: WeaponDef, cfg: MovementConfig, nowMs: number, forShot = false): SpreadParts {
  const s = def.spread
  const ads = def.ads
  const adsT = p.adsT
  out.base = p.crouching || p.slideTimer > 0 ? s.crouchDeg : s.standDeg
  out.move = 0
  out.air = 0
  if (!p.grounded) {
    out.air = s.airDeg
  } else {
    const speed = Math.hypot(p.vel[0], p.vel[2])
    // Full run speed of this weapon (already multiplied by moveSpeedMul and the ADS factor) → t = 1
    const runMax = cfg.runSpeed * def.moveSpeedMul * (ads ? lerp(1, ads.moveMult, adsT) : 1)
    const t = clamp01((speed - s.accurateSpeed) / Math.max(1e-3, runMax - s.accurateSpeed))
    out.move = s.moveDeg * smoothstep(t)
  }
  out.bloom = forShot ? ws.shotBloomDeg : currentBloom(ws, def, nowMs)
  const sum = out.base + out.move + out.air + out.bloom
  if (s.unscopedDeg !== undefined) {   // sniper: not scoped = fixed, fully scoped = the normal formula
    out.mult = 1
    out.total = lerp(s.unscopedDeg, sum, adsT)
  } else {
    out.mult = ads ? lerp(1, ads.spreadMult, adsT) : 1
    out.total = sum * out.mult
  }
  return out
}

const _parts: SpreadParts = { base: 0, move: 0, air: 0, bloom: 0, mult: 1, total: 0 }
export function computeSpreadDeg(p: PlayerState, ws: WeaponState, def: WeaponDef, cfg: MovementConfig, nowMs: number, forShot = false): number {
  return spreadParts(_parts, p, ws, def, cfg, nowMs, forShot).total
}

/** Call right after firing a shot: remember the bloom used for this shot, then add its bloom. nowMs = time of the shot (seq timescale). */
export function onShotBloom(ws: WeaponState, def: WeaponDef, nowMs: number): void {
  const before = currentBloom(ws, def, nowMs)
  ws.shotBloomDeg = before
  ws.bloomDeg[def.id] = Math.min(def.spread.bloomMaxDeg, before + def.spread.bloomPerShotDeg)
  ws.lastShotMs[def.id] = nowMs
}
