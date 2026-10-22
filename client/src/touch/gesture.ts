import { TOUCH } from './config'

/** A tap = a touch that barely moved and was short. Anything else is a drag (look / stick) or a hold. */
export function isTap(distPx: number, durationMs: number): boolean {
  return distPx <= TOUCH.tapSlopPx && durationMs <= TOUCH.tapMaxMs
}
