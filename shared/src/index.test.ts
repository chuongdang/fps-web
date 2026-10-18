import { describe, it, expect } from 'vitest'
import { TICK_RATE, DT } from './index'

describe('placeholder', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2)
  })

  it('DT = 1/TICK_RATE', () => {
    expect(DT).toBeCloseTo(1 / TICK_RATE)
  })
})
