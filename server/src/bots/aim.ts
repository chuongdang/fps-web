// Human-like aiming (plan 15, B.4): does not snap straight to the target.
//  - tracks the enemy position LAGGED by trackingLagMs (does not predict the run direction)
//  - random aim error at the start, decays over time but never reaches 0; a slight jitter always remains
//  - rotation is speed-limited and has inertia (damped spring), so a long flick slightly overshoots then corrects
//  - compensates only part of the recoil (recoilCompensation)
import { MAX_PITCH, type Vec3 } from '@fps/shared'
import { rand, type BotParams } from './params'

const DEG = Math.PI / 180
const SPRING_K = 11            // 1/s: desired velocity = K × angle error (before clamping the speed)
const INERTIA_TAU = 0.06       // s: inertia of the "hand" — source of the slight overshoot (ζ ≈ 0.6)
const HISTORY = 40             // number of target position samples (1 sample/tick → ~0.66s)
const JITTER_EVERY_MS: [number, number] = [150, 300]
const PURSUIT_GAIN = 0.8       // a human follows a running target by matching its angular velocity (smooth pursuit), not just correcting the error
const PURSUIT_TAU = 0.12       // s: filter for the estimated angular velocity

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

/** yaw/pitch (project convention) looking from `from` to `to` */
export function anglesTo(from: Vec3, to: Vec3, out: [number, number]): [number, number] {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  out[0] = Math.atan2(-dx, -dz)
  out[1] = Math.atan2(dy, Math.hypot(dx, dz))
  return out
}

export class Aim {
  yaw = 0
  pitch = 0
  private vYaw = 0
  private vPitch = 0
  // remaining aim error (rad, 2D vector in angle space) + magnitude
  private errYaw = 0
  private errPitch = 0
  private errMag = 0
  private errDirYaw = 0
  private errDirPitch = 0
  private jYaw = 0
  private jPitch = 0
  private jTargetYaw = 0
  private jTargetPitch = 0
  private jNextAt = 0
  private prevDesYaw = NaN
  private prevDesPitch = NaN
  private ffYaw = 0
  private ffPitch = 0
  headTarget = false
  // history of the target position (chest) over time, used to sample with lag
  private readonly hx = new Float64Array(HISTORY)
  private readonly hy = new Float64Array(HISTORY)
  private readonly hz = new Float64Array(HISTORY)
  private readonly ht = new Float64Array(HISTORY)
  private hn = 0
  private hi = 0
  trackedId = -1
  private readonly _a: [number, number] = [0, 0]
  private readonly _delayed: Vec3 = [0, 0, 0]

  constructor(private readonly rng: () => number) {}

  set(yaw: number, pitch: number): void { this.yaw = yaw; this.pitch = pitch; this.vYaw = 0; this.vPitch = 0 }

  /** Start an engagement with a new target: pick head/chest, roll the initial aim error, clear the history */
  begin(id: number, params: BotParams): void {
    this.trackedId = id
    this.hn = 0; this.hi = 0
    this.headTarget = this.rng() < params.headChance
    this.errMag = rand(this.rng, params.aimErrorDeg) * DEG
    const a = this.rng() * 2 * Math.PI
    this.errDirYaw = Math.cos(a); this.errDirPitch = Math.sin(a)
  }

  /** Each new burst/shot within the same engagement: re-pick head/chest and rebuild part of the error (a human does not aim perfectly the whole fight) */
  reroll(params: BotParams): void {
    this.headTarget = this.rng() < params.headChance
    this.errMag = Math.max(this.errMag, rand(this.rng, params.aimErrorDeg) * DEG * 0.5)
    const a = this.rng() * 2 * Math.PI
    this.errDirYaw = Math.cos(a); this.errDirPitch = Math.sin(a)
  }

  end(): void { this.trackedId = -1; this.hn = 0; this.prevDesYaw = NaN }

  /** Record the target position at this tick (every tick while it is visible) */
  record(x: number, y: number, z: number, nowMs: number): void {
    this.hx[this.hi] = x; this.hy[this.hi] = y; this.hz[this.hi] = z; this.ht[this.hi] = nowMs
    this.hi = (this.hi + 1) % HISTORY
    if (this.hn < HISTORY) this.hn++
  }

  /** Target position lagMs ago (interpolated between two samples; with too little history, the oldest sample) */
  delayed(nowMs: number, lagMs: number): Vec3 {
    const out = this._delayed
    if (this.hn === 0) { out[0] = out[1] = out[2] = 0; return out }
    const want = nowMs - lagMs
    let prev = -1
    for (let k = 0; k < this.hn; k++) {
      const idx = (this.hi - 1 - k + HISTORY) % HISTORY
      if (this.ht[idx]! <= want) {
        if (prev < 0) { out[0] = this.hx[idx]!; out[1] = this.hy[idx]!; out[2] = this.hz[idx]!; return out }
        const t0 = this.ht[idx]!, t1 = this.ht[prev]!
        const f = t1 > t0 ? (want - t0) / (t1 - t0) : 0
        out[0] = this.hx[idx]! + (this.hx[prev]! - this.hx[idx]!) * f
        out[1] = this.hy[idx]! + (this.hy[prev]! - this.hy[idx]!) * f
        out[2] = this.hz[idx]! + (this.hz[prev]! - this.hz[idx]!) * f
        return out
      }
      prev = idx
    }
    const old = (this.hi - this.hn + HISTORY) % HISTORY   // not enough history: oldest sample
    out[0] = this.hx[old]!; out[1] = this.hy[old]!; out[2] = this.hz[old]!
    return out
  }

  /**
   * One tick: turn the hand toward the desired angle (desiredYaw/Pitch, excluding error) + error + jitter − recoil compensation.
   * `withError` = false when only turning the head to look (no engagement). speedMul slows it down when looking around.
   */
  step(dt: number, nowMs: number, desiredYaw: number, desiredPitch: number, recYaw: number, recPitch: number, params: BotParams, withError: boolean, speedMul = 1): void {
    if (withError) {
      this.errMag = Math.max(0, this.errMag - params.aimErrorDecayPerSec * DEG * dt)
      if (nowMs >= this.jNextAt) {
        // uniform point in a disc of radius 2·jitter → standard deviation per axis = aimJitterDeg
        const m = 2 * params.aimJitterDeg * DEG * Math.sqrt(this.rng()), a = this.rng() * 2 * Math.PI
        this.jTargetYaw = Math.cos(a) * m; this.jTargetPitch = Math.sin(a) * m
        this.jNextAt = nowMs + rand(this.rng, JITTER_EVERY_MS)
      }
      const f = 1 - Math.exp(-dt / 0.08)
      this.jYaw += (this.jTargetYaw - this.jYaw) * f
      this.jPitch += (this.jTargetPitch - this.jPitch) * f
      this.errYaw = this.errDirYaw * this.errMag
      this.errPitch = this.errDirPitch * this.errMag
    } else { this.errYaw = 0; this.errPitch = 0; this.jYaw = 0; this.jPitch = 0 }

    const comp = withError ? params.recoilCompensation : 1
    const goalYaw = desiredYaw + this.errYaw + this.jYaw - comp * recYaw
    const goalPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, desiredPitch + this.errPitch + this.jPitch - comp * recPitch))

    // angular velocity of the target (excluding error/jitter) to follow it when it runs sideways
    if (withError && !Number.isNaN(this.prevDesYaw)) {
      const kf = 1 - Math.exp(-dt / PURSUIT_TAU)
      this.ffYaw += (wrapAngle(desiredYaw - this.prevDesYaw) / dt - this.ffYaw) * kf
      this.ffPitch += ((desiredPitch - this.prevDesPitch) / dt - this.ffPitch) * kf
    } else { this.ffYaw = 0; this.ffPitch = 0 }
    this.prevDesYaw = withError ? desiredYaw : NaN; this.prevDesPitch = desiredPitch

    const maxV = params.aimSpeedDegPerSec * DEG * speedMul
    const clampV = (v: number) => Math.max(-maxV, Math.min(maxV, v))
    const f = 1 - Math.exp(-dt / INERTIA_TAU)
    this.vYaw += (clampV(wrapAngle(goalYaw - this.yaw) * SPRING_K + PURSUIT_GAIN * this.ffYaw) - this.vYaw) * f
    this.vPitch += (clampV((goalPitch - this.pitch) * SPRING_K + PURSUIT_GAIN * this.ffPitch) - this.vPitch) * f
    this.yaw = wrapAngle(this.yaw + this.vYaw * dt)
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.vPitch * dt))
  }

  /** Angle (rad) between the current look direction and the direction to (yaw, pitch) */
  angleTo(yaw: number, pitch: number): number {
    const dy = wrapAngle(yaw - this.yaw) * Math.cos((pitch + this.pitch) / 2), dp = pitch - this.pitch
    return Math.hypot(dy, dp)
  }

  anglesToward(from: Vec3, to: Vec3): [number, number] { return anglesTo(from, to, this._a) }
}
