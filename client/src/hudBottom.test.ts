import { describe, it, expect } from 'vitest'
import { primarySlotToShow } from './hudBottom'

// keys by logical slot: 0 knife, 1 pistol, 2 mid-range, 3 rifle, 4 grenade
describe('primarySlotToShow (slot "1" of the weapon bar)', () => {
  it('rifle only → rifle; mid-range only → mid-range', () => {
    expect(primarySlotToShow(['knife', 'colt', null, 'm16', null], 0)).toBe(3)
    expect(primarySlotToShow(['knife', 'colt', 'smg', null, null], 0)).toBe(2)
  })
  it('both owned: the rifle by default; holding the mid-range weapon shows it', () => {
    const keys = ['knife', 'colt', 'smg', 'm16', null]
    expect(primarySlotToShow(keys, 1)).toBe(3)
    expect(primarySlotToShow(keys, 3)).toBe(3)
    expect(primarySlotToShow(keys, 2)).toBe(2)
  })
  it('no primary weapon → returns the mid-range slot (the displayed slot is empty)', () => {
    expect(primarySlotToShow(['knife', 'colt', null, null, null], 1)).toBe(2)
  })
})
