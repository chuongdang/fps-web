import { describe, it, expect } from 'vitest'
import { fallDamage } from './fallDamage'
import { FALL_DAMAGE } from './constants'
import { defaultMovement } from './movement'

describe('fallDamage', () => {
  it('no damage at or below the safe threshold (including upward / NaN)', () => {
    expect(fallDamage(0)).toBe(0)
    expect(fallDamage(-5)).toBe(0)
    expect(fallDamage(FALL_DAMAGE.safeSpeed)).toBe(0)
    expect(fallDamage(NaN)).toBe(0)
  })
  it('just past the threshold costs at least 1 HP, growing with the square', () => {
    expect(fallDamage(FALL_DAMAGE.safeSpeed + 0.1)).toBe(1)
    const mid = (FALL_DAMAGE.safeSpeed + FALL_DAMAGE.lethalSpeed) / 2
    expect(fallDamage(mid)).toBe(25)   // (0,5)² × 100
  })
  it('at the lethal threshold (and beyond) costs exactly maxDamage', () => {
    expect(fallDamage(FALL_DAMAGE.lethalSpeed)).toBe(FALL_DAMAGE.maxDamage)
    expect(fallDamage(99)).toBe(FALL_DAMAGE.maxDamage)
  })
  it('monotonically increasing', () => {
    let prev = 0
    for (let v = 0; v < 30; v += 0.25) { const d = fallDamage(v); expect(d).toBeGreaterThanOrEqual(prev); prev = d }
  })
  it('heights: jumping off a 1.1 m object (jump apex) or 4 m costs no HP; 8 m costs HP; 11 m kills', () => {
    const v = (h: number) => Math.sqrt(2 * defaultMovement.gravity * h)
    expect(fallDamage(v(4))).toBe(0)
    expect(fallDamage(v(8))).toBeGreaterThan(0)
    expect(fallDamage(v(8))).toBeLessThan(100)
    expect(fallDamage(v(11))).toBe(100)
  })
})
