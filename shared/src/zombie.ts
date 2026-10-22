// Shared zombie base for Infection (plan 16) and Defense (plan 17). Pure, no Three.js/DOM imports.
import { defaultMovement, type MovementConfig } from './movement'
import { weaponByKey } from './weapons'

export type Role = 'human' | 'zombie'

export const ZOMBIE = {
  /** Crawl through bullet holes: crouches lower than a human (1.2m) so it fits through */
  crouchHeight: 0.85,
  eyeCrouch: 0.7,
  /** Each jump off the ground loses this much horizontal speed (anti bunny hop) */
  hopPenalty: 0.3,
  /** E ability: vel.y 13.8 (apex ≈ 4.3m), +5 m/s along the look direction, 8s cooldown */
  leap: { velY: 13.8, forward: 5, cooldownMs: 8000 },
  /** Heavy claw: lands after the windup, damage × mult. Misses if the victim backs out of range during the swing */
  heavyWindupMs: 300,
  heavyDamageMult: 2,
  /** Knockback when hit by bullets (impulse = damage × k × (1 − knockbackResist)) */
  knockbackPerDamage: { shotgun: 0.06, sniper: 0.05, rulo: 0.05, ak47: 0.025, m16: 0.02, smg: 0.015, colt: 0.02 } as Readonly<Record<string, number>>,
  knockbackUp: 0.25,        // upward component = impulse × this factor
  knockbackMaxHSpeed: 14,   // clamp total horizontal velocity after the push
  knockbackAirMult: 1.5,    // pushed harder while airborne
  regenDelayMs: 4000,       // health only regenerates after going this long without being hit
} as const

/** Stats of one specific zombie (Infection: by type mother/normal; Defense: from zombieTypes.json) */
export interface ZombieStats {
  type: string
  hpMax: number
  runSpeed: number
  clawDamage: number
  knockbackResist: number
  regenPerSec: number
  windupMs?: number     // a normal claw telegraphs for this many ms before landing (Defense NPC zombies: 250)
  headMult?: number     // fixed head multiplier replacing the weapon's (Defense zombies: 2, boss 3)
  scale?: number        // hitbox size relative to a human (boss 2.2)
  shoveSpeed?: number   // a claw hit shoves the player back at about this m/s (brute)
}

// Zombie movement config: cached by (human cfg, runSpeed) so nothing is allocated each tick
const cache = new WeakMap<MovementConfig, Map<number, MovementConfig>>()
export function zombieMovement(base: MovementConfig, runSpeed: number): MovementConfig {
  let m = cache.get(base)
  if (!m) { m = new Map(); cache.set(base, m) }
  let c = m.get(runSpeed)
  if (!c) {
    c = {
      ...base,
      runSpeed,
      crouchSpeed: Math.min(base.crouchSpeed, runSpeed),   // a slow zombie (crawling) is no faster when crouched
      crouchHeight: ZOMBIE.crouchHeight,
      eyeCrouch: ZOMBIE.eyeCrouch,
      slideMinSpeed: Infinity,   // no sliding
      leap: ZOMBIE.leap,
      hopPenalty: ZOMBIE.hopPenalty,
    }
    m.set(runSpeed, c)
  }
  return c
}

// Faster humans (hero ×1.1): separate cache, same reason
const humanCache = new WeakMap<MovementConfig, Map<number, MovementConfig>>()
function scaledHuman(base: MovementConfig, speedMul: number): MovementConfig {
  let m = humanCache.get(base)
  if (!m) { m = new Map(); humanCache.set(base, m) }
  let c = m.get(speedMul)
  if (!c) { c = { ...base, runSpeed: base.runSpeed * speedMul }; m.set(speedMul, c) }
  return c
}

/** Movement config for one player: zombies have their own config, heroes run faster. Server and client must call it identically. */
export function movementFor(base: MovementConfig, zombie: { runSpeed: number } | null | undefined, speedMul = 1): MovementConfig {
  if (zombie) return zombieMovement(base, zombie.runSpeed * speedMul)
  return speedMul === 1 ? base : scaledHuman(base, speedMul)
}

/** Default for tests / places where the zombie type is unknown */
export const ZOMBIE_DEFAULT_RUN_SPEED = 9.5
export const zombieDefaultMovement: MovementConfig = zombieMovement(defaultMovement, ZOMBIE_DEFAULT_RUN_SPEED)

/** Extra knockback velocity for a zombie shot by weapon `weaponKey` dealing `damage`; written into out = [vx, vy, vz] (horizontal dir is the unit vector shooter → zombie) */
export function knockbackImpulse(out: [number, number, number], weaponKey: string, damage: number, resist: number, dirX: number, dirZ: number, airborne: boolean): void {
  const k = ZOMBIE.knockbackPerDamage[weaponKey] ?? 0
  const imp = damage * k * (1 - resist) * (airborne ? ZOMBIE.knockbackAirMult : 1)
  out[0] = dirX * imp; out[1] = imp * ZOMBIE.knockbackUp; out[2] = dirZ * imp
}

/** Add impulse to velocity, then clamp horizontal speed ≤ knockbackMaxHSpeed */
export function applyKnockback(vel: [number, number, number], imp: readonly [number, number, number]): void {
  vel[0] += imp[0]; vel[1] += imp[1]; vel[2] += imp[2]
  const h = Math.hypot(vel[0], vel[2])
  if (h > ZOMBIE.knockbackMaxHSpeed) { const k = ZOMBIE.knockbackMaxHSpeed / h; vel[0] *= k; vel[2] *= k }
}

export function isClawKey(key: string): boolean { return weaponByKey(key)?.category === 'claw' }

/**
 * E ability triggered from STANDING STILL (horizontal velocity 0 → only the `forward` momentum remains): flight time and horizontal distance covered until landing at height `dy`
 * relative to the take-off point (simulated exactly tick by tick like stepMovement: gravity applied before the move). null = never reaches that height.
 * Nav (jump edges) and the zombie brain share this to take off at the right spot.
 */
export function leapFlight(dy: number, gravity = defaultMovement.gravity, dt = 1 / 60): { time: number; dist: number } | null {
  let y = 0, vy: number = ZOMBIE.leap.velY, ticks = 0, reached = dy <= 0
  while (ticks < 600) {
    vy -= gravity * dt
    y += vy * dt
    ticks++
    if (y >= dy) reached = true
    if (reached && vy < 0 && y <= dy) return { time: ticks * dt, dist: ZOMBIE.leap.forward * ticks * dt }
    if (vy < 0 && y < Math.min(dy, 0) - 1) return null
  }
  return null
}
/** Apex height of the E ability relative to the take-off point */
export function leapApex(gravity = defaultMovement.gravity): number { return ZOMBIE.leap.velY * ZOMBIE.leap.velY / (2 * gravity) }

// ── Zombie appearance (ZF.1): each zombie randomly picks (by id, deterministic) a model + tint + a ±6% size offset.
// Empty `models` (zombie glb not built yet) → the client uses that person's Cop/Terrorist model + tint (see plan 16, ZF.1).
import zombieModelsRaw from './zombieModels.json'
import { hashSeed, mulberry32 } from './math'

export interface ZombieModelDef { id: string; file: string; scale: number; eyeBone: string; eyeOffset: [number, number, number] }
export interface ZombieLookDef {
  models: ZombieModelDef[]
  /** Dedicated model id for the mother zombie (Infection); not part of the random pick for normal zombies */
  motherModel?: string
  variation: { scaleJitter: number; tints: string[]; tintStrength: number; infectedTint: string; infectedTintStrength: number; eyeGlow: string }
}
export const ZOMBIE_LOOK: ZombieLookDef = zombieModelsRaw as ZombieLookDef

export interface ZombieVariation { model: ZombieModelDef | null; scale: number; tint: string; tintStrength: number }

/**
 * Variant of zombie `id`. `fromHuman`: a zombie made by infecting a player (uses the Cop/Terrorist model, fixed blue-grey tint);
 * `tintOverride` (Defense: colour by type) replaces the random tint. `modelOverride` assigns a model to one type.
 */
export function zombieVariation(id: number, opts: { fromHuman?: boolean; tintOverride?: string | null; modelOverride?: string | null } = {}): ZombieVariation {
  const v = ZOMBIE_LOOK.variation
  const rng = mulberry32(hashSeed(id, 0x2b1e))
  const scale = 1 + (rng() * 2 - 1) * v.scaleJitter
  const tintPick = v.tints[Math.floor(rng() * v.tints.length)] ?? '#9fb59a'
  const pool = ZOMBIE_LOOK.models.filter(m => m.id !== ZOMBIE_LOOK.motherModel)
  const modelPick = pool.length > 0 ? pool[Math.floor(rng() * pool.length)]! : null
  if (opts.fromHuman) {   // an infected player keeps their own model; only the mother (modelOverride) has a dedicated zombie model, with little tint so the original texture stays visible
    const own = opts.modelOverride ? ZOMBIE_LOOK.models.find(m => m.id === opts.modelOverride) ?? null : null
    return { model: own, scale, tint: v.infectedTint, tintStrength: own ? v.infectedTintStrength * 0.4 : v.infectedTintStrength }
  }
  const model = opts.modelOverride ? ZOMBIE_LOOK.models.find(m => m.id === opts.modelOverride) ?? modelPick : modelPick
  return { model, scale, tint: opts.tintOverride ?? tintPick, tintStrength: opts.tintOverride ? Math.max(v.tintStrength, 0.5) : v.tintStrength }
}
