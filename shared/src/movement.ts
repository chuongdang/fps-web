export const Btn = {
  Forward: 1 << 0,
  Back:    1 << 1,
  Left:    1 << 2,
  Right:   1 << 3,
  Jump:    1 << 4,
  Crouch:  1 << 5,
  Fire:    1 << 6,
  Reload:  1 << 7,
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
}

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
