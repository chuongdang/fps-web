import { describe, it, expect } from 'vitest'
import { rayAabb, shootDir } from './hitbox'
import type { HitBox } from './hitbox'

const BOX: HitBox = {
  min: [-0.5, 0, -0.5],
  max: [0.5, 2, 0.5],
  part: 'body',
}

describe('rayAabb', () => {
  it('tia xuyên giữa box → trả khoảng cách dương', () => {
    const d = rayAabb([0, 1, 2], [0, 0, -1], BOX, 100)
    expect(d).toBeCloseTo(1.5)
  })

  it('tia sượt ngoài box → null', () => {
    const d = rayAabb([1.0, 1, 2], [0, 0, -1], BOX, 100)
    expect(d).toBeNull()
  })

  it('origin trong box → trả 0', () => {
    const d = rayAabb([0, 1, 0], [0, 0, -1], BOX, 100)
    expect(d).toBe(0)
  })

  it('tia hướng ngược không trúng → null', () => {
    const d = rayAabb([0, 1, 2], [0, 0, 1], BOX, 100)
    expect(d).toBeNull()
  })

  it('vượt maxDist → null', () => {
    const d = rayAabb([0, 1, 5], [0, 0, -1], BOX, 2)
    expect(d).toBeNull()
  })
})

describe('shootDir', () => {
  it('yaw=0 pitch=0 → nhìn về −Z', () => {
    const [x, y, z] = shootDir(0, 0)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(-1)
  })

  it('yaw=π/2 pitch=0 → nhìn về −X (quay trái)', () => {
    const [x, y, z] = shootDir(Math.PI / 2, 0)
    expect(x).toBeCloseTo(-1)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(0)
  })

  it('pitch=π/4 → hướng lên 45°, |dir|=1', () => {
    const dir = shootDir(0, Math.PI / 4)
    const len = Math.hypot(...dir)
    expect(len).toBeCloseTo(1)
    expect(dir[1]).toBeCloseTo(Math.sin(Math.PI / 4))
  })
})
