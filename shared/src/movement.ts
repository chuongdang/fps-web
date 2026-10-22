export const Btn = {
  Forward: 1 << 0,
  Back:    1 << 1,
  Left:    1 << 2,
  Right:   1 << 3,
  Jump:    1 << 4,
  Crouch:  1 << 5,
  Fire:    1 << 6,
  Reload:  1 << 7,
  Aim:     1 << 8,   // hold right mouse: aim (ADS / scope); while holding a grenade = low throw (roll)
  QuickNade: 1 << 9, // G key: take out a grenade + pull the pin immediately, release = strong throw then auto-switch back to the previous weapon
  Ability:  1 << 10, // E key: zombie ability (high leap). Humans do not use it
  Flashlight: 1 << 11, // flashlight (humans, night): a LEVEL not an edge — the client sends the desired state in every cmd (F key toggles)
  Sniff:    1 << 12, // Q key: zombie sniff (Infection, plan 16 I.3)
  CycleNade: 1 << 13, // press the grenade key (4) again while holding a grenade: switch type (HE ↔ smoke), like CS 1.6. Rising edge
} as const

export interface InputCmd {
  seq: number
  buttons: number
  yaw: number
  pitch: number
  weapon: number
  fireRenderTime?: number
}

export interface PlayerState {
  pos: [number, number, number]
  vel: [number, number, number]
  yaw: number
  pitch: number
  grounded: boolean
  crouching: boolean
  slideTimer: number
  slideCooldown: number
  adsT: number   // 0..1: ADS level (0 = hip, 1 = fully aimed); affects run speed so it lives in the movement state
  leapCd?: number   // seconds left on the high-leap cooldown (zombie, plan 16); missing = 0. Lives in the state to stay deterministic
}

/** ADS parameters of the weapon being held, for stepMovement */
export interface AdsMove {
  inMs: number
  outMs: number
  moveMult: number
}
/** Default rate at which adsT falls when holding something that cannot ADS (switching to pistol/knife while aiming) */
export const ADS_DEFAULT_OUT_MS = 100

export interface MovementConfig {
  runSpeed: number
  crouchSpeed: number
  groundAccel: number
  airAccel: number
  airWishCap: number
  friction: number
  stopSpeed: number
  gravity: number
  jumpVelocity: number
  standHeight: number
  crouchHeight: number
  radius: number
  eyeStand: number
  eyeCrouch: number
  slideBoost: number
  slideDuration: number
  slideFriction: number
  slideCooldown: number
  slideMinSpeed: number
  // Zombie only (plan 16, ZF.2) – left empty in the human config
  leap?: { velY: number; forward: number; cooldownMs: number }   // high-leap ability (Btn.Ability)
  hopPenalty?: number   // 0..1: each jump off the ground loses this much horizontal speed (anti bunny hop)
}

export const defaultMovement: MovementConfig = {
  runSpeed:      8.5,
  crouchSpeed:   4.0,
  groundAccel:   10,
  airAccel:      12,
  airWishCap:    1.0,
  friction:      6,
  stopSpeed:     2.0,
  gravity:       22,
  jumpVelocity:  7.0,
  standHeight:   1.8,
  crouchHeight:  1.2,
  radius:        0.4,
  eyeStand:      1.6,
  eyeCrouch:     1.0,
  slideBoost:    3.0,
  slideDuration: 0.6,
  slideFriction: 0.8,
  slideCooldown: 1.0,
  slideMinSpeed: 6.0,
}

import type { CollisionWorld } from './physics/world'
import { lerp } from './math'

// Reusable scratch to avoid per-tick allocation
const _wd: [number, number, number] = [0, 0, 0]

function _applyFriction(vel: [number, number, number], friction: number, stopSpeed: number, dt: number): void {
  const speed = Math.hypot(vel[0], vel[2])
  if (speed < 1e-4) { vel[0] = 0; vel[2] = 0; return }
  const control  = Math.max(speed, stopSpeed)
  const newSpeed = Math.max(speed - control * friction * dt, 0)
  const k        = newSpeed / speed
  vel[0] *= k; vel[2] *= k
}

function _accelerate(vel: [number, number, number], wishDir: [number, number, number], wishSpeed: number, accel: number, dt: number): void {
  const current = vel[0] * wishDir[0] + vel[2] * wishDir[2]
  const add     = wishSpeed - current
  if (add <= 0) return
  const a = Math.min(accel * wishSpeed * dt, add)
  vel[0] += a * wishDir[0]
  vel[2] += a * wishDir[2]
}

export function stepMovement(
  state: PlayerState,
  input: InputCmd,
  world: CollisionWorld,
  cfg: MovementConfig,
  dt: number,
  speedMul = 1,   // run-speed multiplier by held weapon (weaponLogic.moveSpeedMul); client and server must pass the same
  ads: AdsMove | null = null,   // whether the held weapon can ADS (null = no); weaponLogic.adsMoveFor
  adsWant = false,   // wants to ADS (holding Aim, not reloading/switching weapon); movement also checks that you are on the ground and not sliding
): PlayerState {
  world.setCrouchHeight?.(cfg.crouchHeight)
  const pos: [number, number, number] = [state.pos[0], state.pos[1], state.pos[2]]
  const vel: [number, number, number] = [state.vel[0], state.vel[1], state.vel[2]]
  let grounded      = state.grounded
  let crouching     = state.crouching
  let slideTimer    = state.slideTimer
  let slideCooldown = state.slideCooldown
  let leapCd        = state.leapCd ?? 0
  // Can ADS when on the ground and not sliding (checked on the state BEFORE the tick); otherwise adsT decays on its own
  const aimOk = !!ads && adsWant && grounded && state.slideTimer <= 0
  let adsT = state.adsT
  if (aimOk) adsT = Math.min(1, adsT + dt * 1000 / ads!.inMs)
  else adsT = Math.max(0, adsT - dt * 1000 / (ads ? ads.outMs : ADS_DEFAULT_OUT_MS))

  const yaw     = input.yaw
  const jumping = !!(input.buttons & Btn.Jump)
  const wantCrouch = !!(input.buttons & Btn.Crouch)

  // Start a slide: Crouch just pressed (rising edge) on the ground, fast enough, cooldown elapsed
  const hSpeed = Math.hypot(vel[0], vel[2])
  if (wantCrouch && !crouching && grounded && !jumping && hSpeed >= cfg.slideMinSpeed && slideCooldown <= 0) {
    vel[0] += vel[0] / hSpeed * cfg.slideBoost
    vel[2] += vel[2] / hSpeed * cfg.slideBoost
    slideTimer    = cfg.slideDuration
    slideCooldown = cfg.slideCooldown
  }

  // Crouching state: stay crouched if button held or no room to stand
  if (wantCrouch) {
    crouching = true
  } else if (crouching) {
    crouching = !world.canStand(pos)
  }

  // wishDir from WASD + yaw (horizontal only)
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw)
  let wx = 0, wz = 0
  if (input.buttons & Btn.Forward) { wx -= sinY; wz -= cosY }
  if (input.buttons & Btn.Back)    { wx += sinY; wz += cosY }
  if (input.buttons & Btn.Left)    { wx -= cosY; wz += sinY }
  if (input.buttons & Btn.Right)   { wx += cosY; wz -= sinY }
  const wlen = Math.hypot(wx, wz)
  _wd[0] = wlen > 1e-6 ? wx / wlen : 0
  _wd[1] = 0
  _wd[2] = wlen > 1e-6 ? wz / wlen : 0

  const wishSpeed = (crouching ? cfg.crouchSpeed : cfg.runSpeed) * speedMul * (ads ? lerp(1, ads.moveMult, adsT) : 1)

  // Release Crouch (and able to stand up) → the slide ends
  if (!crouching) slideTimer = 0
  const sliding = slideTimer > 0 && grounded

  if (grounded) {
    if (cfg.leap && (input.buttons & Btn.Ability) && leapCd <= 0) {
      // High-leap ability: fixed vel.y + horizontal momentum along the look direction (yaw), cooldown cooldownMs
      vel[1]   = cfg.leap.velY
      vel[0]  -= Math.sin(yaw) * cfg.leap.forward
      vel[2]  -= Math.cos(yaw) * cfg.leap.forward
      grounded = false
      slideTimer = 0
      leapCd   = cfg.leap.cooldownMs / 1000
    } else if (jumping) {
      vel[1]   = cfg.jumpVelocity
      grounded = false
      slideTimer = 0
      if (cfg.hopPenalty) { vel[0] *= 1 - cfg.hopPenalty; vel[2] *= 1 - cfg.hopPenalty }
      // skip friction on jump tick
    } else if (sliding) {
      // Sliding: low friction, cannot steer
      _applyFriction(vel, cfg.slideFriction, cfg.stopSpeed, dt)
    } else {
      _applyFriction(vel, cfg.friction, cfg.stopSpeed, dt)
      _accelerate(vel, _wd, wishSpeed, cfg.groundAccel, dt)
    }
  } else {
    _accelerate(vel, _wd, Math.min(wishSpeed, cfg.airWishCap), cfg.airAccel, dt)
  }

  vel[1] -= cfg.gravity * dt

  const res = world.moveCharacter(pos, [vel[0] * dt, vel[1] * dt, vel[2] * dt], crouching)
  pos[0] = res.pos[0]; pos[1] = res.pos[1]; pos[2] = res.pos[2]
  grounded = res.grounded

  if (grounded && vel[1] < 0)      vel[1] = 0
  if (res.hitCeiling && vel[1] > 0) vel[1] = 0

  slideTimer    = Math.max(0, slideTimer    - dt)
  slideCooldown = Math.max(0, slideCooldown - dt)
  leapCd        = Math.max(0, leapCd        - dt)

  return { pos, vel, yaw: input.yaw, pitch: input.pitch, grounded, crouching, slideTimer, slideCooldown, adsT, leapCd }
}

export function lerpState(a: PlayerState, b: PlayerState, t: number): PlayerState {
  return {
    pos: [lerp(a.pos[0], b.pos[0], t), lerp(a.pos[1], b.pos[1], t), lerp(a.pos[2], b.pos[2], t)],
    vel: b.vel,
    yaw: b.yaw,
    pitch: b.pitch,
    grounded: b.grounded,
    crouching: b.crouching,
    slideTimer: b.slideTimer,
    slideCooldown: b.slideCooldown,
    adsT: b.adsT,
    leapCd: b.leapCd,
  }
}

