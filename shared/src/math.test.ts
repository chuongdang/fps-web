import { describe, it, expect } from 'vitest'
import { forwardFromYaw, rightFromYaw, lerp, lerpAngle, mulberry32, hashSeed } from './math'

const EPSILON = 1e-10

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON
}

describe('forwardFromYaw', () => {
  it('yaw=0 looks toward -Z', () => {
    const out: [number, number, number] = [0, 0, 0]
    forwardFromYaw(0, out)
    expect(close(out[0], 0)).toBe(true)
    expect(close(out[1], 0)).toBe(true)
    expect(close(out[2], -1)).toBe(true)
  })

  it('yaw=π/2 looks toward -X', () => {
    const out: [number, number, number] = [0, 0, 0]
    forwardFromYaw(Math.PI / 2, out)
    expect(close(out[0], -1)).toBe(true)
    expect(close(out[1], 0)).toBe(true)
    expect(close(out[2], 0)).toBe(true)
  })
})

describe('rightFromYaw', () => {
  it('yaw=0 points toward +X', () => {
    const out: [number, number, number] = [0, 0, 0]
    rightFromYaw(0, out)
    expect(close(out[0], 1)).toBe(true)
    expect(close(out[1], 0)).toBe(true)
    expect(close(out[2], 0)).toBe(true)
  })
})

describe('lerp', () => {
  it('t=0 returns a', () => expect(lerp(3, 7, 0)).toBe(3))
  it('t=1 returns b', () => expect(lerp(3, 7, 1)).toBe(7))
  it('t=0.5 returns the midpoint', () => expect(lerp(3, 7, 0.5)).toBe(5))
})

describe('lerpAngle', () => {
  it('3.0 and -3.0 go through ±π, not through 0', () => {
    const result = lerpAngle(3.0, -3.0, 0.5)
    // The result must be close to π (~3.1416), not 0
    expect(Math.abs(result)).toBeGreaterThan(2.5)
    expect(Math.abs(Math.abs(result) - Math.PI)).toBeLessThan(0.01)
  })

  it('normal angles still lerp correctly', () => {
    const result = lerpAngle(0, Math.PI / 2, 0.5)
    expect(close(result, Math.PI / 4)).toBe(true)
  })
})

describe('mulberry32', () => {
  it('same seed gives the same sequence', () => {
    const rng1 = mulberry32(42)
    const seq1 = [rng1(), rng1(), rng1()]

    const rng2 = mulberry32(42)
    const seq2 = [rng2(), rng2(), rng2()]

    expect(seq1).toEqual(seq2)
  })

  it('result is within [0, 1)', () => {
    const rng = mulberry32(0)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('different seeds give different sequences', () => {
    const rng1 = mulberry32(1)
    const rng2 = mulberry32(2)
    expect(rng1()).not.toBe(rng2())
  })
})

describe('hashSeed', () => {
  it('32-bit result (integer)', () => {
    const h = hashSeed(1, 2, 3)
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF)
  })

  it('argument order affects the result', () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1))
  })
})
