// M67 grenade (plan 12). All gameplay / physics / damage numbers live here, not hardcoded in logic.
export const GRENADE = {
  key: 'm67',
  price: 300,
  maxCarry: 2,
  pinPullMs: 350,          // minimum mouse hold to pull the pin
  fuseMs: 3000,            // counted from leaving the hand
  throwSpeed: { strong: 32, lob: 12 },   // m/s
  throwUpDeg: { strong: 10, lob: 3 },    // added to pitch
  inheritVelocity: 0.5,    // adds 50% of the thrower's velocity
  radius: 0.045,           // m, spherical collision
  gravity: 22,             // same as MovementConfig gravity
  restitution: 0.35,       // bounciness
  friction: 0.6,           // tangential friction per contact
  rollDrag: 2.5,           // m/s² deceleration while rolling on the floor
  restSpeed: 0.25,         // below this speed it comes to rest
  bounceMinSpeed: 1.0,     // m/s: an impact faster than this counts as a bounce ('bounce' event); slower on the floor = rolling
  damageMax: 98,
  innerRadius: 1.0,        // within this radius: full damage
  outerRadius: 7.0,
  selfDamageMult: 0.5,
  knockback: 3.0,          // m/s push away from the blast centre (0 = off)
  shakeRadius: 15,
  warnRadius: 8,           // show a nearby-grenade warning
  autoSwitchBackMs: 450,   // after throwing the last one, auto-switch back to the previous weapon
  throwCooldownMs: 500,    // after a throw: cannot pull a new pin right away (matches the arm-swing + new grenade raise animation)
}

/** Smoke grenade (as in CS 1.6): no damage, bursts into a smoke cloud that blocks vision (bullets still pass through). Flight/bounce physics shared with GRENADE. */
export const SMOKE = {
  key: 'smoke',
  price: 300,
  maxCarry: 1,             // CS 1.6: carry 1 of each type
  fuseMs: 1800,            // counted from leaving the hand: smoke blooms
  bloomMs: 1500,           // the cloud grows from 0 to full radius
  durationMs: 18000,       // total smoke lifetime (from bloom, including growth and fade)
  fadeMs: 3500,            // gradual fade at the end
  radius: 4.0,             // m, full radius
  centerLift: 0.8,         // m: smoke centre raised off the ground (the grenade lies on the floor, smoke rises to block sight)
}

/** Maximum number of grenades of type `key` that can be carried (weapon key: 'm67' | 'smoke') */
export function maxCarryOf(key: string): number {
  return key === SMOKE.key ? SMOKE.maxCarry : GRENADE.maxCarry
}

/** How long the fuse burns (ms) from leaving the hand */
export function fuseMsOf(key: string): number {
  return key === SMOKE.key ? SMOKE.fuseMs : GRENADE.fuseMs
}

/** Smoke radius (m) `ageMs` after bloom: grows ease-out over bloomMs, then holds; 0 when expired. Server (blocks bot vision) and client (rendering) share this */
export function smokeRadiusAt(ageMs: number): number {
  if (ageMs < 0 || ageMs >= SMOKE.durationMs) return 0
  const t = Math.min(1, ageMs / SMOKE.bloomMs)
  const grow = 1 - (1 - t) * (1 - t)
  const left = SMOKE.durationMs - ageMs
  const fade = left < SMOKE.fadeMs ? Math.max(0.35, left / SMOKE.fadeMs) : 1   // fade: shrinks to at most 35% then vanishes
  return SMOKE.radius * grow * fade
}

export type ThrowMode = 'strong' | 'lob'

// Player throw state: lives in WeaponState; server and client run the same stepWeaponCmd so prediction matches
export interface ThrowState {
  phase: 'idle' | 'pulling' | 'ready'
  mode: ThrowMode
  pressSeq: number   // cmd seq when the button was pressed (pin pulled after pinPullMs)
  quick: boolean     // entered via the G key: switch back to the previous weapon after throwing
}

export function makeThrowState(): ThrowState {
  return { phase: 'idle', mode: 'strong', pressSeq: 0, quick: false }
}
