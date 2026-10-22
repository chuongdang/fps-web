import { TOUCH } from './config'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** The stick follows the shorter side of the screen (the height in landscape), so it stays thumb-sized on any phone. The action buttons are sized in buttons.ts. */
export function joystickRadius(width: number, height: number): number {
  return clamp(Math.min(width, height) * TOUCH.joystickRadiusFrac, TOUCH.joystickRadiusMin, TOUCH.joystickRadiusMax)
}
