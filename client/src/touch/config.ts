// Touch control tunables (plan 19). Client-only feel values, kept in one place so they can be tuned on a real phone.
// Gameplay values (speed, damage, ...) stay in shared/.
export const TOUCH = {
  /** radians of camera turn per CSS pixel dragged (the mouse default is 0.0022 per mouse count) */
  lookSens: 0.005,

  /** two-finger trackpad swipe: camera radians per CSS px of swipe at the default mouse sensitivity (scaled by the fps_sens setting) */
  trackpadLookSens: 0.004,

  /** a touch that starts in the left share of the screen drives the joystick, anywhere else it looks around */
  joystickZone: 0.45,
  /** joystick radius = this share of the shorter screen side, clamped to [min, max] CSS px */
  joystickRadiusFrac: 0.14,
  joystickRadiusMin: 44,
  joystickRadiusMax: 84,
  /** inside this share of the radius the stick does nothing */
  deadZone: 0.25,
  /** an axis is on when its share of the stick direction exceeds this. sin(22.5°) = 8 equal sectors (forward, forward-right, ...) */
  axisThreshold: 0.38,

  /** a touch that moves less than this and ends within tapMaxMs counts as a tap (tap-to-spectate, tap the world to close the shop) */
  tapSlopPx: 12,
  tapMaxMs: 300,
} as const
