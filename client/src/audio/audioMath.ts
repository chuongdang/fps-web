// Pure functions of the audio system (no Web Audio) — so they can be tested.

export const dbToGain = (db: number): number => Math.pow(10, db / 20)

/** Picks a random element, avoiding `last` if there are ≥ 2 options. */
export function pickNoRepeat<T>(items: T[], last: T | undefined, rnd: () => number): T | undefined {
  if (items.length === 0) return undefined
  if (items.length === 1) return items[0]
  let i = Math.floor(rnd() * items.length)
  if (items[i] === last) i = (i + 1 + Math.floor(rnd() * (items.length - 1))) % items.length
  return items[i]
}

/** Random value in [-amp, +amp]. */
export const randSpread = (amp: number, rnd: () => number = Math.random): number => (rnd() * 2 - 1) * amp

// ── Low-ammo warning ──────────────────────────────────────────────────────
export const LOW_AMMO_FRACTION = 0.25

/** `ammoLeft` is the ammo remaining AFTER the shot just fired. */
export const lowAmmoActive = (ammoLeft: number, magSize: number): boolean =>
  ammoLeft <= magSize * LOW_AMMO_FRACTION

/** pitchFactor = 1 + 0.6 * (1 − ammoLeft / (magSize * 0.25)) */
export const lowAmmoPitchFactor = (ammoLeft: number, magSize: number): number =>
  1 + 0.6 * (1 - ammoLeft / (magSize * LOW_AMMO_FRACTION))

// ── Reload ────────────────────────────────────────────────────────────────────
/** Timing (ratio 0..1) of n round-loading sounds spread evenly across [from, to]. */
export function reloadInsertTimes(n: number, from: number, to: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [(from + to) / 2]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1))
  return out
}

// ── Other players' guns ───────────────────────────────────────────────────────────
/** Lowpass cutoff by distance: the farther, the more muffled, minimum 1500Hz. */
export const distanceCutoff = (d: number): number => Math.max(1500, 18000 * Math.pow(0.5, d / 15))

// ── Hit sound ───────────────────────────────────────────────────────────────
export const COMBO_WINDOW_MS = 400
export const COMBO_STEP = 0.03
export const COMBO_MAX = 0.15
export const DEDUPE_MS = 30

/** Consecutive hits within 400ms: +3% pitch each, max +15%. */
export class ComboTracker {
  private count = 0
  private lastMs = -Infinity
  /** Call each time a hit sound is actually played; returns the pitch factor. */
  hit(nowMs: number): number {
    this.count = nowMs - this.lastMs <= COMBO_WINDOW_MS ? this.count + 1 : 0
    this.lastMs = nowMs
    return 1 + Math.min(COMBO_MAX, COMBO_STEP * this.count)
  }
}

/** Multiple events within 30ms play only one: a later event plays only if clearly "heavier". */
export class HitDeduper {
  private lastMs = -Infinity
  private lastWeight = 0
  accept(nowMs: number, weight: number): boolean {
    if (nowMs - this.lastMs < DEDUPE_MS && weight <= this.lastWeight) return false
    this.lastMs = nowMs
    this.lastWeight = weight
    return true
  }
}

// ── Footsteps ─────────────────────────────────────────────────────────────────
export type StepEvent = 'step' | 'land' | null

/**
 * Decides when to play footsteps / landing. One step per `stepDist` meters travelled on the ground;
 * no steps while sliding or airborne. Landing when the fall speed (previous tick) > landSpeed.
 * The first ground contact (falling from the spawn point) is ignored.
 */
export class StepTracker {
  private acc = 0
  private airVy = 0
  private wasGrounded = false
  private armed = false

  update(
    grounded: boolean, vy: number, speedXZ: number, sliding: boolean, dt: number,
    stepDist: number, landSpeed: number, minSpeed: number,
  ): StepEvent {
    if (!grounded) {
      this.airVy = vy
      this.wasGrounded = false
      return null
    }
    if (!this.wasGrounded) {
      this.wasGrounded = true
      const wasArmed = this.armed
      this.armed = true
      if (wasArmed && -this.airVy > landSpeed) { this.acc = 0; return 'land' }
    }
    if (sliding || speedXZ <= minSpeed) return null
    this.acc += speedXZ * dt
    if (this.acc >= stepDist) { this.acc -= stepDist; return 'step' }
    return null
  }
}
