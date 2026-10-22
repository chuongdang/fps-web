import { describe, it, expect } from 'vitest'
import { DEFAULT_PREFS, OPACITY_VALUE, SIZE_SCALE, TOUCH_OPACITIES, TOUCH_SIZES, parsePrefs } from './prefs'

describe('touch prefs', () => {
  it('nothing stored: the defaults (normal size, full opacity, right hand)', () => {
    expect(parsePrefs({ size: null, opacity: null, hand: null })).toEqual(DEFAULT_PREFS)
  })
  it('valid stored values are kept', () => {
    expect(parsePrefs({ size: 'large', opacity: 'low', hand: 'left' })).toEqual({ size: 'large', opacity: 'low', hand: 'left' })
  })
  it('garbage falls back per field, the other fields are not lost', () => {
    expect(parsePrefs({ size: 'huge', opacity: 'medium', hand: '' })).toEqual({ size: 'normal', opacity: 'medium', hand: 'right' })
  })
  it('sizes only grow (a smaller layout would overlap the clamped buttons) and opacity stays in (0, 1]', () => {
    for (const s of TOUCH_SIZES) expect(SIZE_SCALE[s]).toBeGreaterThanOrEqual(1)
    expect(SIZE_SCALE.normal).toBe(1)
    for (const o of TOUCH_OPACITIES) { expect(OPACITY_VALUE[o]).toBeGreaterThan(0); expect(OPACITY_VALUE[o]).toBeLessThanOrEqual(1) }
  })
})
