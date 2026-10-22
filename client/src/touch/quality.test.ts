import { describe, it, expect } from 'vitest'
import { pixelRatioFor, readQuality, DEFAULT_QUALITY } from './quality'

describe('pixelRatioFor', () => {
  it('caps a 3x phone screen by the level', () => {
    expect(pixelRatioFor(3, 'low')).toBe(1)
    expect(pixelRatioFor(3, 'medium')).toBe(1.5)
    expect(pixelRatioFor(3, 'high')).toBe(2)
  })
  it('never goes above what the screen has', () => {
    expect(pixelRatioFor(1, 'high')).toBe(1)
    expect(pixelRatioFor(1.25, 'high')).toBe(1.25)
  })
  it('survives nonsense ratios', () => {
    expect(pixelRatioFor(0, 'high')).toBe(1)
    expect(pixelRatioFor(NaN, 'high')).toBe(1)
    expect(pixelRatioFor(-2, 'medium')).toBe(1)
  })
})

describe('readQuality', () => {
  it('uses the default when nothing is set', () => { expect(readQuality('', null)).toBe(DEFAULT_QUALITY) })
  it('uses the saved choice', () => { expect(readQuality('', 'low')).toBe('low') })
  it('ignores a corrupt saved value', () => { expect(readQuality('', 'ultra')).toBe(DEFAULT_QUALITY) })
  it('the URL wins over the saved choice, and a bad URL value is ignored', () => {
    expect(readQuality('?quality=high', 'low')).toBe('high')
    expect(readQuality('?quality=max', 'low')).toBe('low')
  })
})
