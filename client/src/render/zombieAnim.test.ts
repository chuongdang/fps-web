import { describe, expect, it } from 'vitest'
import { SLOTS } from './locomotion'
import { Z_CLIPS, Z_DEATH, ZOMBIE_ATTACK, ZOMBIE_RATE_MAX, ZOMBIE_RATE_MIN, fitRate, zombieClipRate, zombieSlotClip } from './zombieAnim'

describe('animation zombie (ZF.4)', () => {
  it('every movement slot has a valid z_* clip', () => {
    for (const s of SLOTS) expect(Z_CLIPS as readonly string[]).toContain(zombieSlotClip(s))
    expect(zombieSlotClip('crouchWalk')).toBe('z_crawl')
    expect(zombieSlotClip('walkB')).toBe('z_walk')
  })
  it('timeScale follows speed, clamped to a range; a clip not driven by speed = 1', () => {
    expect(zombieClipRate('z_run', 0)).toBe(ZOMBIE_RATE_MIN)
    expect(zombieClipRate('z_run', 100)).toBe(ZOMBIE_RATE_MAX)
    expect(zombieClipRate('z_walk', 0.6)).toBeCloseTo(1, 5)
    expect(zombieClipRate('z_idle', 5)).toBe(1)
    expect(zombieClipRate('z_jump', 5)).toBe(1)
  })
  it('the claw swing lies within the clip and fits the swing time; fitRate squeezes the clip segment into exactly that many seconds', () => {
    for (const a of Object.values(ZOMBIE_ATTACK)) {
      expect(a.from).toBeGreaterThanOrEqual(0)
      expect(a.to).toBeLessThanOrEqual(1)
      expect(a.to).toBeGreaterThan(a.from)
    }
    // 4s clip, a 50% segment in 0.5s -> plays 4x faster
    expect(fitRate(4, 0.1, 0.6, 0.5)).toBeCloseTo(4, 5)
    expect(Z_DEATH).toEqual(['z_death_1', 'z_death_2'])
  })
})
