import { describe, it, expect, vi } from 'vitest'
import raw from './poses.json'
import { loadPoses, armsOf, armBodyOf, handsOf, armAdjustDefault, weaponPose, WEAPON_KEYS } from './poses'

describe('loadPoses', () => {
  it('poses.json is valid: all 8 guns present, long guns held with 2 hands, pistols/knife with 1 hand in the 3rd-person view', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = loadPoses(raw)
    expect(warn).not.toHaveBeenCalled()
    expect(Object.keys(p.weapons).sort()).toEqual([...WEAPON_KEYS].sort())
    for (const k of ['ak47', 'm16', 'sniper', 'shotgun', 'smg']) expect(p.weapons[k]!.third.hold).toBe('twoHand')
    for (const k of ['colt', 'rulo', 'knife']) expect(p.weapons[k]!.third.hold).toBe('oneHand')
    warn.mockRestore()
  })

  it('empty file / missing fields: falls back to defaults without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = loadPoses({ first: { fov: 70 } })
    expect(p.first.fov).toBe(70)
    expect(p.first.shoulderR).toHaveLength(3)
    expect(p.weapons.ak47!.third.hold).toBe('oneHand')
    expect(() => loadPoses(null)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('arm adjustments (armsOf)', () => {
  it('are created with zeros for both hands, the same object every call (no per-frame allocation)', () => {
    const w = weaponPose(0), keepHands = w.hands, keepFirst = w.first.arms, keepThird = w.third.arms   // the gun's tuned values must not matter here
    w.hands = undefined; w.first.arms = undefined; w.third.arms = undefined
    const a = armsOf(0, 'first')
    expect(a.R).toEqual(armAdjustDefault()); expect(a.L).toEqual(armAdjustDefault())
    expect(armsOf(0, 'first')).toBe(a)
    expect(armsOf(0, 'third')).not.toBe(a)
    w.hands = keepHands; w.first.arms = keepFirst; w.third.arms = keepThird
  })
  it('a partial block from the file is completed with zeros, keeping what it has', () => {
    const w = weaponPose(0)
    const keep = w.first.arms, keepHands = w.hands
    w.first.arms = { R: { upperTwistDeg: 12 } } as never
    w.hands = { R: { wristDeg: [1, 2, 3] } } as never
    const a = armsOf(0, 'first')
    expect(a.R.upperTwistDeg).toBe(12); expect(a.R.wristDeg).toEqual([1, 2, 3]); expect(a.R.manual).toEqual([]); expect(a.L).toEqual(armAdjustDefault())
    w.first.arms = keep; w.hands = keepHands
  })
  it('the hand tuning is shared by both views, the elbow and twists are per view', () => {
    const w = weaponPose(0), keepHands = w.hands, keepFirst = w.first.arms, keepThird = w.third.arms
    w.hands = undefined; w.first.arms = undefined; w.third.arms = undefined
    handsOf(0).R.fingers.index = [10, 20, 30]; handsOf(0).R.palmPos[0] = 0.05
    armBodyOf(0, 'first').R.upperTwistDeg = 7
    const f = armsOf(0, 'first').R, t = armsOf(0, 'third').R
    expect(f.fingers.index).toEqual([10, 20, 30]); expect(t.fingers.index).toEqual([10, 20, 30]); expect(t.palmPos[0]).toBe(0.05)
    expect(f.upperTwistDeg).toBe(7); expect(t.upperTwistDeg).toBe(0)
    handsOf(0).R.fingers = {}   // the editor may replace the stored objects: armsOf picks the new ones up
    expect(armsOf(0, 'third').R.fingers).toEqual({})
    w.hands = keepHands; w.first.arms = keepFirst; w.third.arms = keepThird
  })
  it('loadPoses keeps the file untouched when the live copy is edited', () => {
    const file = { weapons: { ak47: { hands: { R: { fingers: { index: [1, 2, 3] } } }, first: { arms: { R: { upperTwistDeg: 5 } } } } } }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = loadPoses(file)
    warn.mockRestore()
    p.weapons.ak47!.first.arms!.R.upperTwistDeg = 99
    ;(p.weapons.ak47!.hands!.R.fingers.index as number[])[0] = 77
    expect(file.weapons.ak47.first.arms.R.upperTwistDeg).toBe(5)
    expect(file.weapons.ak47.hands.R.fingers.index).toEqual([1, 2, 3])
  })
})
