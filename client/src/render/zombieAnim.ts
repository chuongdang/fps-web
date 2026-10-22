import type { Slot } from './locomotion'

// Zombie animation (plan 16, ZF.4): the Mixamo z_* set is shared by every model (same 65-bone skeleton), including infected players.
// Pure math so it is testable; characterRig.ts applies it to the mixer.
export const Z_CLIPS = ['z_idle', 'z_walk', 'z_run', 'z_crawl', 'z_jump'] as const
export const Z_DEATH = ['z_death_1', 'z_death_2'] as const

/** Movement slot -> clip. Zombies have no dedicated backward/sideways walk: borrow z_walk; crouch = crawl. */
export function zombieSlotClip(slot: Slot): string {
  switch (slot) {
    case 'idle': return 'z_idle'
    case 'run': return 'z_run'
    case 'crouchIdle': case 'crouchWalk': return 'z_crawl'
    case 'jump': case 'slide': return 'z_jump'
    default: return 'z_walk'
  }
}

// Speed (m/s) at which the clip's feet look right; timeScale = speed / ref, clamped to avoid freezing / over-fast animation
// (measured from the feet in the clip itself: z_walk is very slow ~0.5 m/s, z_run ~2.5 m/s, z_crawl ~0.5 m/s)
export const ZOMBIE_REF_SPEED = { walk: 0.6, run: 2.6, crawl: 0.5 }
export const ZOMBIE_RATE_MIN = 0.5
export const ZOMBIE_RATE_MAX = 2.6

/** Zombie threshold for switching z_walk -> z_run (z_walk is too slow to keep up with the zombie walking speed) */
export const ZOMBIE_RUN_START = 1.5
export const ZOMBIE_RUN_BLEND = 1

export function zombieClipRate(clip: string, speed: number): number {
  const ref = clip === 'z_walk' ? ZOMBIE_REF_SPEED.walk : clip === 'z_run' ? ZOMBIE_REF_SPEED.run : clip === 'z_crawl' ? ZOMBIE_REF_SPEED.crawl : 0
  if (ref <= 0) return 1
  return Math.min(ZOMBIE_RATE_MAX, Math.max(ZOMBIE_RATE_MIN, speed / ref))
}

/** z_jump: hold the middle frame while airborne (fraction of the clip length) */
export const ZOMBIE_JUMP_HOLD = 0.4

/**
 * Claw attack: plays only a segment [from, to] (fraction of the clip length, around when the arm swings fastest) over `sec` seconds.
 * Normal claw = z_attack_2 (swing at ~42% of the clip); heavy claw = z_attack_1 (two beats at ~19% and ~32%).
 */
export const ZOMBIE_ATTACK = {
  light: { clip: 'z_attack_2', from: 0.12, to: 0.62, sec: 0.5 },
  heavy: { clip: 'z_attack_1', from: 0.08, to: 0.45, sec: 0.65 },
} as const
export type ZombieAttackKind = keyof typeof ZOMBIE_ATTACK

/** Transformation: z_transform is squeezed to fit `sec` seconds (the server's invulnerable + frozen time) */
export function fitRate(clipDur: number, from: number, to: number, sec: number): number {
  return Math.max(0.1, ((to - from) * clipDur) / Math.max(0.05, sec))
}
