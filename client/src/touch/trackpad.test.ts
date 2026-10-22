import { describe, it, expect } from 'vitest'
import { wheelLook, MAX_WHEEL_PX } from './trackpad'

const out = { dx: 0, dy: 0 }

describe('wheelLook', () => {
  it('negates natural-scrolling deltas so the swipe direction is the turn direction', () => {
    wheelLook(-30, 12, 0, 800, out)   // fingers right and up (natural scrolling: deltaX < 0, deltaY > 0 would be fingers up)
    expect(out).toEqual({ dx: 30, dy: -12 })
  })
  it('converts line and page modes to pixels', () => {
    wheelLook(0, 2, 1, 800, out)
    expect(out.dy).toBe(-32)
    wheelLook(0, 0.05, 2, 800, out)
    expect(out.dy).toBe(-40)
  })
  it('limits one event', () => {
    wheelLook(-9999, 9999, 0, 800, out)
    expect(out).toEqual({ dx: MAX_WHEEL_PX, dy: -MAX_WHEEL_PX })
  })
})
