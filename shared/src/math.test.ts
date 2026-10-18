import { describe, it, expect } from 'vitest'
import { forwardFromYaw, rightFromYaw, lerp, lerpAngle, mulberry32, hashSeed } from './math'

const EPSILON = 1e-10

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON
}

describe('forwardFromYaw', () => {
  it('yaw=0 nhìn về -Z', () => {
    const out: [number, number, number] = [0, 0, 0]
    forwardFromYaw(0, out)
    expect(close(out[0], 0)).toBe(true)
    expect(close(out[1], 0)).toBe(true)
    expect(close(out[2], -1)).toBe(true)
  })

  it('yaw=π/2 nhìn về -X', () => {
    const out: [number, number, number] = [0, 0, 0]
    forwardFromYaw(Math.PI / 2, out)
    expect(close(out[0], -1)).toBe(true)
    expect(close(out[1], 0)).toBe(true)
    expect(close(out[2], 0)).toBe(true)
  })
})

describe('rightFromYaw', () => {
  it('yaw=0 hướng về +X', () => {
    const out: [number, number, number] = [0, 0, 0]
    rightFromYaw(0, out)
    expect(close(out[0], 1)).toBe(true)
    expect(close(out[1], 0)).toBe(true)
    expect(close(out[2], 0)).toBe(true)
  })
})

describe('lerp', () => {
  it('t=0 trả về a', () => expect(lerp(3, 7, 0)).toBe(3))
  it('t=1 trả về b', () => expect(lerp(3, 7, 1)).toBe(7))
  it('t=0.5 trả về giữa', () => expect(lerp(3, 7, 0.5)).toBe(5))
})

describe('lerpAngle', () => {
  it('3.0 và -3.0 đi qua ±π, không qua 0', () => {
    const result = lerpAngle(3.0, -3.0, 0.5)
    // Kết quả phải gần π (~3.1416), không phải 0
    expect(Math.abs(result)).toBeGreaterThan(2.5)
    expect(Math.abs(Math.abs(result) - Math.PI)).toBeLessThan(0.01)
  })

  it('góc bình thường vẫn lerp đúng', () => {
    const result = lerpAngle(0, Math.PI / 2, 0.5)
    expect(close(result, Math.PI / 4)).toBe(true)
  })
})

describe('mulberry32', () => {
  it('cùng seed cho cùng dãy', () => {
    const rng1 = mulberry32(42)
    const seq1 = [rng1(), rng1(), rng1()]

    const rng2 = mulberry32(42)
    const seq2 = [rng2(), rng2(), rng2()]

    expect(seq1).toEqual(seq2)
  })

  it('kết quả trong [0, 1)', () => {
    const rng = mulberry32(0)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('seed khác nhau cho dãy khác', () => {
    const rng1 = mulberry32(1)
    const rng2 = mulberry32(2)
    expect(rng1()).not.toBe(rng2())
  })
})

describe('hashSeed', () => {
  it('kết quả 32-bit (integer)', () => {
    const h = hashSeed(1, 2, 3)
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF)
  })

  it('thứ tự tham số ảnh hưởng kết quả', () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1))
  })
})
