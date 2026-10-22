import { FALL_DAMAGE } from './constants'

/** Damage on landing with fall speed `impactSpeed` (m/s, positive = moving down). 0 if negligible. */
export function fallDamage(impactSpeed: number): number {
  const { safeSpeed, lethalSpeed, maxDamage } = FALL_DAMAGE
  if (!(impactSpeed > safeSpeed)) return 0
  const k = Math.min(1, (impactSpeed - safeSpeed) / (lethalSpeed - safeSpeed))
  return Math.max(1, Math.round(maxDamage * k * k))
}
