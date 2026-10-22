import { describe, it, expect } from 'vitest'
import { LagHistory, type PastPlayer } from './lagComp'

const pl = (id: number, x: number, crouching = false, alive = true) => ({ id, state: { pos: [x, 0, 0], crouching }, alive })
const out = (): PastPlayer => ({ pos: [0, 0, 0], crouching: false, alive: true })

describe('LagHistory', () => {
  it('linearly interpolates the position between two entries', () => {
    const h = new LagHistory()
    h.record(1000, [pl(1, 0)])
    h.record(1016, [pl(1, 1.6)])
    expect(h.locate(1008)).toBe(true)
    const o = out()
    expect(h.get(1, o)).toBe(true)
    expect(o.pos[0]).toBeCloseTo(0.8)
  })

  it('crouching/alive are taken from the earlier entry', () => {
    const h = new LagHistory()
    h.record(0, [pl(1, 0, false, true)])
    h.record(16, [pl(1, 0, true, false)])
    h.locate(10)
    const o = out(); h.get(1, o)
    expect(o.crouching).toBe(false)
    expect(o.alive).toBe(true)
  })

  it('t newer than the newest entry / older than the oldest: uses the edge entry', () => {
    const h = new LagHistory()
    h.record(100, [pl(1, 5)]); h.record(116, [pl(1, 6)])
    const o = out()
    h.locate(999); h.get(1, o); expect(o.pos[0]).toBe(6)
    h.locate(-5);  h.get(1, o); expect(o.pos[0]).toBe(5)
  })

  it('ring buffer: writing more than capacity still finds the right entry, oldest ~ HITBOX_HISTORY_MS', () => {
    const h = new LagHistory()
    for (let i = 0; i < 500; i++) h.record(i * 16.667, [pl(1, i)])
    expect(h.newestTime).toBeCloseTo(499 * 16.667)
    expect(h.newestTime - h.oldestTime).toBeGreaterThanOrEqual(990)
    h.locate(470 * 16.667 + 8.3335); const o = out(); h.get(1, o)
    expect(o.pos[0]).toBeCloseTo(470.5)
  })

  it('a newly joined player (only in the later entry) can still be fetched; a missing player returns false', () => {
    const h = new LagHistory()
    h.record(0, [pl(1, 0)]); h.record(16, [pl(1, 0), pl(2, 7)])
    h.locate(8); const o = out()
    expect(h.get(2, o)).toBe(false)   // not in the earlier entry -> skip this shot
    expect(h.get(3, o)).toBe(false)
  })

  it('no history yet: locate returns false', () => {
    expect(new LagHistory().locate(5)).toBe(false)
  })
})
