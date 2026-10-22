import { describe, it, expect } from 'vitest'
import { WEAPONS, WEAPON_DROP, dropDistSq, dropsEnabled, inPickupReach, isDroppable, weaponByKey } from './index'

describe('weapon drop rules', () => {
  it('only real guns can be dropped', () => {
    for (const key of ['ak47', 'm16', 'colt', 'rulo', 'sniper', 'shotgun', 'smg']) expect(isDroppable(weaponByKey(key)!), key).toBe(true)
    for (const key of ['knife', 'm67', 'smoke', 'claw', 'claw_heavy']) expect(isDroppable(weaponByKey(key)!), key).toBe(false)
    expect(WEAPONS.filter(isDroppable).length).toBeGreaterThan(0)
  })

  it('zombie modes do not drop guns', () => {
    expect(dropsEnabled('tdm')).toBe(true)
    expect(dropsEnabled('elimination')).toBe(true)
    expect(dropsEnabled('infection')).toBe(false)
    expect(dropsEnabled('defense')).toBe(false)
  })

  it('reach: horizontal radius + a vertical window around the feet', () => {
    const feet: [number, number, number] = [10, 2, 10]
    expect(inPickupReach(feet, [10 + WEAPON_DROP.reachRadius - 0.01, 2, 10])).toBe(true)
    expect(inPickupReach(feet, [10 + WEAPON_DROP.reachRadius + 0.01, 2, 10])).toBe(false)
    expect(inPickupReach(feet, [10, 2 - WEAPON_DROP.reachBelow - 0.01, 10])).toBe(false)   // on the floor below
    expect(inPickupReach(feet, [10, 2 + WEAPON_DROP.reachAbove + 0.01, 10])).toBe(false)   // on the ledge above
    expect(dropDistSq(feet, [13, 50, 14])).toBe(25)
  })
})
