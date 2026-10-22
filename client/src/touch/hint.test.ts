import { describe, it, expect } from 'vitest'
import { stripKeyHint } from './hint'

describe('stripKeyHint', () => {
  it('removes a trailing "(KEY)"', () => {
    expect(stripKeyHint('Scoreboard (TAB)')).toBe('Scoreboard')
    expect(stripKeyHint('Switch team (~)')).toBe('Switch team')
    expect(stripKeyHint('Confirm (Enter)')).toBe('Confirm')
    expect(stripKeyHint('+ Medium bot ([)')).toBe('+ Medium bot')
  })
  it('removes a trailing " · B" style hint', () => {
    expect(stripKeyHint('Buy weapons at the buy zone · B')).toBe('Buy weapons at the buy zone')
    expect(stripKeyHint('Mua vũ khí tại khu mua hàng · B')).toBe('Mua vũ khí tại khu mua hàng')
  })
  it('leaves other text alone, including a middle dot between words', () => {
    expect(stripKeyHint('Elimination · Deathmatch · ROOM 1')).toBe('Elimination · Deathmatch · ROOM 1')
    expect(stripKeyHint('Copy link')).toBe('Copy link')
  })
})
