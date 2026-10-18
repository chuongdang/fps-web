import { describe, it, expect } from 'vitest'
import { loadMap } from './loadMap'
import type { MapFile } from './types'
import { forwardFromYaw } from '../math'

function makeFile(overrides: Partial<MapFile> = {}): MapFile {
  return {
    name: 'test',
    mirrorX: true,
    boxes: [],
    ramps: [],
    spawnsA: [],
    ...overrides,
  }
}

describe('loadMap – mirror box', () => {
  it('box tại x=-5 sinh ra box mirror tại x=5', () => {
    const file = makeFile({
      boxes: [{ pos: [-5, 0, 0], size: [2, 2, 2], texture: 'wall' }],
    })
    const map = loadMap(file)
    expect(map.boxes).toHaveLength(2)
    const original = map.boxes[0]
    const mirrored = map.boxes[1]
    expect(original?.pos[0]).toBe(-5)
    expect(mirrored?.pos[0]).toBe(5)
    // size không thay đổi
    expect(mirrored?.size).toEqual([2, 2, 2])
  })

  it('box noMirror không bị nhân đôi', () => {
    const file = makeFile({
      boxes: [{ pos: [0, 0, 0], size: [2, 2, 2], texture: 'center', noMirror: true }],
    })
    const map = loadMap(file)
    expect(map.boxes).toHaveLength(1)
  })

  it('box cắt qua x=0 không có noMirror → throw', () => {
    const file = makeFile({
      // pos.x=0, size.x=4 → extends từ x=-2 đến x=2 → cross x=0
      boxes: [{ pos: [0, 0, 0], size: [4, 2, 2], texture: 'bad' }],
    })
    expect(() => loadMap(file)).toThrow()
  })

  it('box tiếp giáp x=0 nhưng không vượt qua thì không throw', () => {
    // pos.x=-1, size.x=2 → min=-2, max=0 → không vượt (maxX không > 0)
    const file = makeFile({
      boxes: [{ pos: [-1, 0, 0], size: [2, 2, 2], texture: 'wall' }],
    })
    expect(() => loadMap(file)).not.toThrow()
  })
})

describe('loadMap – mirror ramp', () => {
  it('ramp từ x=-10 sinh ra ramp mirror từ x=10', () => {
    const file = makeFile({
      ramps: [{ from: [-10, 0, 0], to: [-8, 4, 0], width: 2 }],
    })
    const map = loadMap(file)
    expect(map.ramps).toHaveLength(2)
    expect(map.ramps[1]?.from[0]).toBe(10)
    expect(map.ramps[1]?.to[0]).toBe(8)
  })
})

describe('loadMap – mirror spawn', () => {
  it('spawn A x=-25 yaw=-π/2 → spawn B x=25 yaw=π/2', () => {
    const yawA = -Math.PI / 2
    const file = makeFile({
      spawnsA: [{ pos: [-25, 0, 0], yaw: yawA }],
    })
    const map = loadMap(file)

    const spawnA = map.spawns.A[0]!
    const spawnB = map.spawns.B[0]!

    expect(spawnA.pos[0]).toBe(-25)
    expect(spawnB.pos[0]).toBe(25)
    expect(spawnB.yaw).toBeCloseTo(Math.PI / 2)

    // Hai hướng nhìn phải ngược dấu x (cả hai chỉ về phía khu giữa)
    const fwdA: [number, number, number] = [0, 0, 0]
    const fwdB: [number, number, number] = [0, 0, 0]
    forwardFromYaw(spawnA.yaw, fwdA)
    forwardFromYaw(spawnB.yaw, fwdB)
    expect(Math.sign(fwdA[0])).toBe(1)   // A nhìn về +X (x=0)
    expect(Math.sign(fwdB[0])).toBe(-1)  // B nhìn về -X (x=0)
  })
})
