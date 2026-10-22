import { describe, it, expect } from 'vitest'
import { hurtEdgeWeights } from './hudNet'

const w = (dx: number, dz: number, yaw: number) => {
  const o: [number, number, number, number] = [0, 0, 0, 0]
  hurtEdgeWeights(dx, dz, yaw, o)
  return o
}

describe('hurtEdgeWeights', () => {
  it('yaw 0 faces −Z: shot from the front (−Z) -> top edge', () => {
    const o = w(0, -10, 0)
    expect(o[0]).toBeCloseTo(1); expect(o[1]).toBeCloseTo(0); expect(o[2]).toBe(0); expect(o[3]).toBe(0)
  })
  it('from behind (+Z) -> bottom edge', () => {
    expect(w(0, 10, 0)[2]).toBeCloseTo(1)
  })
  it('from the right (+X at yaw 0) -> right edge; from the left -> left edge', () => {
    expect(w(10, 0, 0)[1]).toBeCloseTo(1)
    expect(w(-10, 0, 0)[3]).toBeCloseTo(1)
  })
  it('yaw rotation: turning left 90° (yaw π/2) faces −X; an enemy at −X -> top edge', () => {
    expect(w(-10, 0, Math.PI / 2)[0]).toBeCloseTo(1)
  })
  it('a 45° diagonal splits evenly between two edges', () => {
    const o = w(10, -10, 0)
    expect(o[0]).toBeCloseTo(Math.SQRT1_2); expect(o[1]).toBeCloseTo(Math.SQRT1_2)
  })
})
