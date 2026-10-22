import { describe, it, expect } from 'vitest'
import { isTouchMode, isPortrait, readTouchEnv } from './detect'

describe('isTouchMode', () => {
  const desktop = { forced: false, hasPointerLock: true, anyPointerFine: true }

  it('desktop with a mouse stays in desktop mode', () => {
    expect(isTouchMode(desktop)).toBe(false)
  })
  it('iOS Safari: no Pointer Lock API', () => {
    expect(isTouchMode({ ...desktop, hasPointerLock: false })).toBe(true)
  })
  it('iPad with a trackpad: a fine pointer exists but there is still no Pointer Lock', () => {
    expect(isTouchMode({ forced: false, hasPointerLock: false, anyPointerFine: true })).toBe(true)
  })
  it('Android Chrome: Pointer Lock exists but there is no mouse', () => {
    expect(isTouchMode({ ...desktop, anyPointerFine: false })).toBe(true)
  })
  it('?touch=1 forces touch mode on a desktop', () => {
    expect(isTouchMode({ ...desktop, forced: true })).toBe(true)
  })
})

describe('isPortrait', () => {
  it('taller than wide is portrait; wide or square is landscape', () => {
    expect(isPortrait(390, 844)).toBe(true)
    expect(isPortrait(844, 390)).toBe(false)
    expect(isPortrait(600, 600)).toBe(false)
  })
})

describe('readTouchEnv', () => {
  it('outside a browser (tests, SSR) it reports a desktop so nothing switches to touch mode', () => {
    expect(isTouchMode(readTouchEnv())).toBe(false)
  })
})
