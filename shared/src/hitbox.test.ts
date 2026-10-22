import { describe, it, expect } from 'vitest'
import { rayAabb, shootDir } from './hitbox'
import type { HitBox } from './hitbox'

const BOX: HitBox = {
  min: [-0.5, 0, -0.5],
  max: [0.5, 2, 0.5],
  part: 'body',
}

describe('rayAabb', () => {
  it('ray through the middle of the box → returns a positive distance', () => {
    const d = rayAabb([0, 1, 2], [0, 0, -1], BOX, 100)
    expect(d).toBeCloseTo(1.5)
  })

  it('ray grazing outside the box → null', () => {
    const d = rayAabb([1.0, 1, 2], [0, 0, -1], BOX, 100)
    expect(d).toBeNull()
  })

  it('origin inside the box → returns 0', () => {
    const d = rayAabb([0, 1, 0], [0, 0, -1], BOX, 100)
    expect(d).toBe(0)
  })

  it('ray pointing away does not hit → null', () => {
    const d = rayAabb([0, 1, 2], [0, 0, 1], BOX, 100)
    expect(d).toBeNull()
  })

  it('beyond maxDist → null', () => {
    const d = rayAabb([0, 1, 5], [0, 0, -1], BOX, 2)
    expect(d).toBeNull()
  })
})

describe('shootDir', () => {
  it('yaw=0 pitch=0 → looks toward −Z', () => {
    const [x, y, z] = shootDir(0, 0)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(-1)
  })

  it('yaw=π/2 pitch=0 → looks toward −X (turned left)', () => {
    const [x, y, z] = shootDir(Math.PI / 2, 0)
    expect(x).toBeCloseTo(-1)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(0)
  })

  it('pitch=π/4 → looks up 45°, |dir|=1', () => {
    const dir = shootDir(0, Math.PI / 4)
    const len = Math.hypot(...dir)
    expect(len).toBeCloseTo(1)
    expect(dir[1]).toBeCloseTo(Math.sin(Math.PI / 4))
  })
})
