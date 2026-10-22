import { describe, it, expect } from 'vitest'
import { INTERP_DELAY_MS, type NetPlayer } from '@fps/shared'
import { Interpolator, interp } from './interpolation'

const np = (id: number, x: number, yaw = 0, pitch = 0, flags = 0): NetPlayer =>
  ({ id, pos: [x, 0, 0], vel: [0, 0, 0], yaw, pitch, flags, slideTimer: 0, slideCooldown: 0, adsT: 0, hp: 100, team: 'A', weapon: 0, killStreak: 0 })
const D = INTERP_DELAY_MS

describe('Interpolator', () => {
  it('interpolates linearly between two snapshots', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0)]); ip.push(1050, [np(2, 10)])
    const [p] = ip.sample(1025 + D)
    expect(p!.pos[0]).toBeCloseTo(5)
  })

  it('pitch is lerped, flags are taken from a', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0, 0, 0.2, 1)]); ip.push(1050, [np(2, 0, 0, 0.6, 3)])
    const [p] = ip.sample(1025 + D)
    expect(p!.pitch).toBeCloseTo(0.4)
    expect(p!.flags).toBe(1)
  })

  it('yaw takes the short way across ±π', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0, Math.PI - 0.1)]); ip.push(1050, [np(2, 0, -Math.PI + 0.1)])
    const [p] = ip.sample(1025 + D)
    // short way: across π, not back around through 0
    expect(Math.abs(Math.cos(p!.yaw) + 1)).toBeLessThan(1e-9)
    const [q] = ip.sample(1010 + D)
    expect(Math.abs(q!.yaw)).toBeGreaterThan(Math.PI - 0.1)
  })

  it('no later snapshot: hold the last one, no extrapolation; stale after 250ms', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0)]); ip.push(1050, [np(2, 10)])
    let [p] = ip.sample(1100 + D)   // 50ms late
    expect(p!.pos[0]).toBe(10); expect(p!.stale).toBe(false)
    ;[p] = ip.sample(1400 + D)      // 350ms late
    expect(p!.pos[0]).toBe(10); expect(p!.stale).toBe(true)
  })

  it('renderTime before the first snapshot: use the first snapshot', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 3)]); ip.push(1050, [np(2, 10)])
    expect(ip.sample(500 + D)[0]!.pos[0]).toBe(3)
  })

  it('picks the right pair when the buffer holds many snapshots', () => {
    const ip = new Interpolator()
    for (let k = 0; k < 10; k++) ip.push(1000 + k * 50, [np(2, k * 10)])
    expect(ip.sample(1175 + D)[0]!.pos[0]).toBeCloseTo(35)
  })

  it('keeps ~1 second of snapshots', () => {
    const ip = new Interpolator()
    for (let k = 0; k < 100; k++) ip.push(1000 + k * 50, [np(2, k)])
    // 100 snapshots = 5s; anything older than 1s must be dropped → the oldest valid renderTime is ≈ 1s before the last snapshot
    const lastT = 1000 + 99 * 50
    expect(ip.sample(lastT - 3000 + D)[0]!.pos[0]).toBeGreaterThan(75)
  })

  it('drops players missing from the snapshot and ignores self', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(1, 0), np(2, 0)], 1)
    expect(ip.sample(1000 + D).map(p => p.id)).toEqual([2])
    ip.push(1050, [np(1, 0)], 1)
    expect(ip.sample(1050 + D).length).toBe(0)
  })

  it('writes currentRenderTime = serverNow − INTERP_DELAY_MS', () => {
    const ip = new Interpolator()
    ip.sample(5000)
    expect(interp.currentRenderTime).toBe(5000 - D)
  })

  it('old or duplicate-serverTime snapshots are dropped', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0)]); ip.push(1000, [np(2, 99)]); ip.push(900, [np(2, 99)])
    expect(ip.sample(5000)[0]!.pos[0]).toBe(0)
  })
})

import { InterpDelay } from './interpolation'

describe('InterpDelay', () => {
  it('the first sample sets INTERP_DELAY_MS + one-way delay directly', () => {
    const d = new InterpDelay()
    expect(d.update(80)).toBe(D + 80)
  })

  it('unmeasured (0) uses INTERP_DELAY_MS, then takes the real value at the first sample', () => {
    const d = new InterpDelay()
    expect(d.update(0)).toBe(D)
    expect(d.update(60)).toBe(D + 60)
  })

  it('changes by at most 1ms/frame in both directions', () => {
    const d = new InterpDelay()
    d.update(50)
    expect(d.update(100)).toBe(D + 51)
    for (let i = 0; i < 100; i++) d.update(100)
    expect(d.value).toBe(D + 100)
    expect(d.update(20)).toBe(D + 99)
  })

  it('clamps an excessive one-way delay', () => {
    expect(new InterpDelay().update(5000)).toBe(D + 250)
  })

  it('sample uses the delay passed in', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0)]); ip.push(1050, [np(2, 10)])
    expect(ip.sample(1025 + 180, 180)[0]!.pos[0]).toBeCloseTo(5)
    expect(interp.delayMs).toBe(180)
  })
})
