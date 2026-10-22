// Infection mode (plan 16, part I): balance parameters. Tune numbers here, do not hardcode in logic.
import type { ZombieStats } from './zombie'

export interface InfectionZombieDef { hpBase: number; hpPerHuman: number; runSpeed: number; clawDamage: number; knockbackResist: number; regenPerSec: number }

export const INFECTION = {
  minPlayers: 3,
  startMoney: 6000,            // per round, not carried over to the next round
  buyAnywhereDuringPrep: true, // during the prep phase you can buy anywhere
  motherCount: (players: number) => (players >= 8 ? 2 : 1),
  mother: { hpBase: 2000, hpPerHuman: 300, runSpeed: 6.0, clawDamage: 40, knockbackResist: 0.3, regenPerSec: 50 } as InfectionZombieDef,
  normal: { hpBase: 1000, hpPerHuman: 100, runSpeed: 5.5, clawDamage: 30, knockbackResist: 0.0, regenPerSec: 30 } as InfectionZombieDef,
  zombieRespawnMs: 5000,       // a downed zombie respawns (still a zombie)
  transformMs: 1500,
  pickMs: 2000,                // from picking the mother zombie until invulnerability ends (the mother transforms in place)
  hero: { hp: 200, damageMult: 1.5, speedMult: 1.1 },
  points: { surviveRound: 3, infect: 1, killZombie: 2, killAsHero: 3, mother: 1 },
  sniff: { cooldownMs: 15000, radius: 18, durationMs: 2500 }, // zombie "sniff" ability (I.3)
  towerDecay: { enabled: false, afterSec: 40, dps: 2 },       // "tower collapse" rule (I.2): only enable when the user agrees
} as const

export type InfectionZombieType = 'mother' | 'normal'

/** Stats of one zombie when `humans` humans are alive: hpMax = hpBase + hpPerHuman × humans */
export function infectionStats(type: InfectionZombieType, humans: number): ZombieStats {
  const d = INFECTION[type]
  return { type, hpMax: d.hpBase + d.hpPerHuman * humans, runSpeed: d.runSpeed, clawDamage: d.clawDamage, knockbackResist: d.knockbackResist, regenPerSec: d.regenPerSec }
}
