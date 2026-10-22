import { describe, it, expect } from 'vitest'
import {
  dbToGain, pickNoRepeat, lowAmmoActive, lowAmmoPitchFactor, reloadInsertTimes,
  distanceCutoff, ComboTracker, HitDeduper, StepTracker,
} from './audioMath'

describe('audioMath', () => {
  it('dbToGain', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2)
    expect(dbToGain(20)).toBeCloseTo(10, 6)
  })

  it('pickNoRepeat does not repeat the file just used when there are ≥ 2 files', () => {
    const items = ['a', 'b', 'c']
    for (let i = 0; i < 200; i++) expect(pickNoRepeat(items, 'b', Math.random)).not.toBe('b')
    expect(pickNoRepeat(['x'], 'x', Math.random)).toBe('x')
    expect(pickNoRepeat([], undefined, Math.random)).toBeUndefined()
  })

  it('low-ammo warning: AK with 30 rounds warns on the last 8, revolver warns from the 5th round', () => {
    const flagged = (mag: number) => {
      let n = 0
      for (let left = mag - 1; left >= 0; left--) if (lowAmmoActive(left, mag)) n++
      return n
    }
    expect(flagged(30)).toBe(8)
    expect(lowAmmoActive(2, 6)).toBe(false)   // 4th round
    expect(lowAmmoActive(1, 6)).toBe(true)    // 5th round
    expect(lowAmmoActive(0, 6)).toBe(true)
  })

  it('warning pitch rises gradually to 1.6 on the last round', () => {
    expect(lowAmmoPitchFactor(7, 30)).toBeLessThan(lowAmmoPitchFactor(3, 30))
    expect(lowAmmoPitchFactor(0, 30)).toBeCloseTo(1.6, 9)
  })

  it('revolver loads exactly n rounds, spread evenly across from..to', () => {
    expect(reloadInsertTimes(0, 0.35, 0.8)).toEqual([])
    expect(reloadInsertTimes(1, 0.35, 0.8)).toEqual([0.575])
    const t = reloadInsertTimes(6, 0.35, 0.8)
    expect(t.length).toBe(6)
    expect(t[0]).toBeCloseTo(0.35, 9)
    expect(t[5]).toBeCloseTo(0.8, 9)
  })

  it('distance lowpass: clear when close, muffled when far, clamped at 1500Hz', () => {
    expect(distanceCutoff(0)).toBe(18000)
    expect(distanceCutoff(15)).toBeCloseTo(9000, 6)
    expect(distanceCutoff(500)).toBe(1500)
  })

  it('pitch combo: +3% per hit, max +15%, resets after 400ms', () => {
    const c = new ComboTracker()
    expect(c.hit(0)).toBe(1)
    expect(c.hit(100)).toBeCloseTo(1.03, 9)
    expect(c.hit(200)).toBeCloseTo(1.06, 9)
    for (let i = 0; i < 20; i++) c.hit(300 + i * 50)
    expect(c.hit(1400)).toBeCloseTo(1.15, 9)
    expect(c.hit(1900)).toBe(1)   // pause > 400ms
  })

  it('30ms dedupe: only replays if heavier', () => {
    const d = new HitDeduper()
    expect(d.accept(0, 1)).toBe(true)
    expect(d.accept(10, 1)).toBe(false)
    expect(d.accept(15, 3)).toBe(true)    // kill overrides hit
    expect(d.accept(20, 2)).toBe(false)
    expect(d.accept(100, 1)).toBe(true)   // outside 30ms
  })
})

describe('StepTracker', () => {
  const dt = 1 / 60
  const run = (t: StepTracker, n: number, o: { g?: boolean; vy?: number; v?: number; slide?: boolean } = {}) => {
    const ev: (string | null)[] = []
    for (let i = 0; i < n; i++) ev.push(t.update(o.g ?? true, o.vy ?? 0, o.v ?? 8.5, o.slide ?? false, dt, 2.4, 4, 1))
    return ev.filter(Boolean)
  }
  const armed = () => { const t = new StepTracker(); t.update(true, 0, 0, false, dt, 2.4, 4, 1); return t }

  it('running at 8.5 m/s for 1s: 3 steps (one per 2.4m)', () => {
    expect(run(armed(), 60)).toEqual(['step', 'step', 'step'])
  })
  it('no steps when standing still, sliding or airborne', () => {
    expect(run(armed(), 60, { v: 0.5 })).toEqual([])
    expect(run(armed(), 60, { slide: true })).toEqual([])
    expect(run(armed(), 60, { g: false, vy: 2 })).toEqual([])
  })
  it('landing only when falling > 4 m/s; the first ground contact (spawn) is ignored', () => {
    const t = new StepTracker()
    run(t, 5, { g: false, vy: -9 })
    expect(run(t, 1, { v: 0 })).toEqual([])            // fall from spawn: silent
    run(t, 5, { g: false, vy: -9 })
    expect(run(t, 1, { v: 0 })).toEqual(['land'])
    run(t, 5, { g: false, vy: -3 })
    expect(run(t, 1, { v: 0 })).toEqual([])            // light fall
  })
})
