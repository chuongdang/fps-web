// Run-speed multiplier of a player by state (hero, downed): the server sets Player.speedMult, the client derives it from the NetFlag bits in the snapshot.
import { INFECTION } from './infection'
import { DEFENSE } from './defense'
import { defaultMovement, Btn } from './movement'
import { NetFlag } from './protocol'

export function downedSpeedMul(runSpeed = defaultMovement.runSpeed): number { return DEFENSE.down.crawlSpeed / runSpeed }
export function heroSpeedMul(): number { return INFECTION.hero.speedMult }

/** Run-speed multiplier of a HUMAN by flags (zombies use their own config so they do not go through here) */
export function flagSpeedMul(flags: number, runSpeed = defaultMovement.runSpeed): number {
  if (flags & NetFlag.Downed) return downedSpeedMul(runSpeed)
  if (flags & NetFlag.Hero) return heroSpeedMul()
  return 1
}

/** Buttons disabled while downed: no jump, no crouch, no grenade throw, no ability */
export const DOWNED_BUTTON_MASK = ~(Btn.Jump | Btn.Crouch | Btn.QuickNade | Btn.CycleNade | Btn.Ability)
/** Weapon slot of the pistol: a downed player can only fire the pistol */
export const DOWNED_WEAPON_SLOT = 1
