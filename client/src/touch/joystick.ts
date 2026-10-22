import { Btn } from '@fps/shared'
import { TOUCH } from './config'

/**
 * Virtual stick -> the digital move buttons the protocol has (no analog speed: it would need a shared/ change).
 * dx, dy: how far the thumb is from where the stick started, in CSS px (y grows downwards, so up = forward).
 * Eight sectors: straight up is Forward only, a diagonal is two buttons.
 */
export function moveBits(dx: number, dy: number, radius: number): number {
  const mag = Math.hypot(dx, dy)
  if (mag < radius * TOUCH.deadZone) return 0
  const nx = dx / mag, ny = dy / mag
  let bits = 0
  if (ny < -TOUCH.axisThreshold) bits |= Btn.Forward
  else if (ny > TOUCH.axisThreshold) bits |= Btn.Back
  if (nx < -TOUCH.axisThreshold) bits |= Btn.Left
  else if (nx > TOUCH.axisThreshold) bits |= Btn.Right
  return bits
}

/** Where to draw the knob: the thumb position, held inside the stick's circle. Writes into `out` (no allocation per move event). */
export function clampToRadius(dx: number, dy: number, radius: number, out: { x: number; y: number }): void {
  const mag = Math.hypot(dx, dy)
  const k = mag > radius ? radius / mag : 1
  out.x = dx * k
  out.y = dy * k
}
