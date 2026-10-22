import { describe, it, expect } from 'vitest'
import { isTap } from './gesture'
import { TOUCH } from './config'

describe('isTap', () => {
  it('a short touch that barely moved is a tap', () => {
    expect(isTap(0, 80)).toBe(true)
    expect(isTap(TOUCH.tapSlopPx, TOUCH.tapMaxMs)).toBe(true)
  })
  it('a drag is not a tap, however short', () => {
    expect(isTap(TOUCH.tapSlopPx + 1, 50)).toBe(false)
  })
  it('a long press is not a tap, even without moving', () => {
    expect(isTap(0, TOUCH.tapMaxMs + 1)).toBe(false)
  })
})
