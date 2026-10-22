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
  it('box at x=-5 produces a mirrored box at x=5', () => {
    const file = makeFile({
      boxes: [{ pos: [-5, 0, 0], size: [2, 2, 2], texture: 'wall' }],
    })
    const map = loadMap(file)
    expect(map.boxes).toHaveLength(2)
    const original = map.boxes[0]
    const mirrored = map.boxes[1]
    expect(original?.pos[0]).toBe(-5)
    expect(mirrored?.pos[0]).toBe(5)
    // size unchanged
    expect(mirrored?.size).toEqual([2, 2, 2])
  })

  it('a noMirror box is not duplicated', () => {
    const file = makeFile({
      boxes: [{ pos: [0, 0, 0], size: [2, 2, 2], texture: 'center', noMirror: true }],
    })
    const map = loadMap(file)
    expect(map.boxes).toHaveLength(1)
  })

  it('a box crossing x=0 without noMirror → throws', () => {
    const file = makeFile({
      // pos.x=0, size.x=4 → extends from x=-2 to x=2 → crosses x=0
      boxes: [{ pos: [0, 0, 0], size: [4, 2, 2], texture: 'bad' }],
    })
    expect(() => loadMap(file)).toThrow()
  })

  it('a box touching x=0 without crossing it does not throw', () => {
    // pos.x=-1, size.x=2 → min=-2, max=0 → does not cross (maxX is not > 0)
    const file = makeFile({
      boxes: [{ pos: [-1, 0, 0], size: [2, 2, 2], texture: 'wall' }],
    })
    expect(() => loadMap(file)).not.toThrow()
  })
})

describe('loadMap – mirror ramp', () => {
  it('ramp from x=-10 produces a mirrored ramp from x=10', () => {
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

    // The two look directions must have opposite x signs (both point toward the middle area)
    const fwdA: [number, number, number] = [0, 0, 0]
    const fwdB: [number, number, number] = [0, 0, 0]
    forwardFromYaw(spawnA.yaw, fwdA)
    forwardFromYaw(spawnB.yaw, fwdB)
    expect(Math.sign(fwdA[0])).toBe(1)   // A looks toward +X (x=0)
    expect(Math.sign(fwdB[0])).toBe(-1)  // B looks toward -X (x=0)
  })
})

describe('loadMap – asymmetric map (mirrorX false)', () => {
  const zoneA = { min: [-10, -1, -5], max: [-2, 3, 5] } as const
  const zoneB = { min: [4, -1, -8], max: [12, 3, 8] } as const

  it('takes the spawns and buy zone of team B from the file', () => {
    const file = makeFile({
      mirrorX: false,
      spawnsA: [{ pos: [-5, 1, 0], yaw: -Math.PI / 2 }],
      spawnsB: [{ pos: [8, 1, 2], yaw: Math.PI / 2 }],
      buyZoneA: { min: [...zoneA.min], max: [...zoneA.max] },
      buyZoneB: { min: [...zoneB.min], max: [...zoneB.max] },
    })
    const map = loadMap(file)
    expect(map.spawns.A).toEqual(file.spawnsA)
    expect(map.spawns.B).toEqual(file.spawnsB)
    expect(map.buyZones.A).toEqual(file.buyZoneA)
    expect(map.buyZones.B).toEqual(file.buyZoneB)
  })

  it('nothing is mirrored: boxes and ramps are kept as they are', () => {
    const file = makeFile({
      mirrorX: false,
      boxes: [{ pos: [-5, 0, 0], size: [2, 2, 2], texture: 'wall' }],
      ramps: [{ from: [-10, 0, 0], to: [-8, 4, 0], width: 2 }],
    })
    const map = loadMap(file)
    expect(map.boxes).toHaveLength(1)
    expect(map.ramps).toHaveLength(1)
  })

  it('a file without spawnsB / buyZoneB still loads (team B has none, as before)', () => {
    const map = loadMap(makeFile({ mirrorX: false, spawnsA: [{ pos: [-5, 1, 0], yaw: 0 }] }))
    expect(map.spawns.B).toEqual([])
    expect(map.buyZones).toEqual({})
  })

  it('a mirrored map ignores spawnsB / buyZoneB and mirrors team A', () => {
    const map = loadMap(makeFile({
      spawnsA: [{ pos: [-5, 1, 0], yaw: 0 }],
      spawnsB: [{ pos: [99, 1, 0], yaw: 0 }],
      buyZoneA: { min: [...zoneA.min], max: [...zoneA.max] },
      buyZoneB: { min: [...zoneB.min], max: [...zoneB.max] },
    }))
    expect(map.spawns.B[0]!.pos[0]).toBe(5)
    expect(map.buyZones.B).toEqual({ min: [2, -1, -5], max: [10, 3, 5] })
  })
})

describe('loadMap – modelled map', () => {
  const trimesh = { vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 1, 2] }

  it('passes the model url and the collision triangles through on an asymmetric map', () => {
    const m = loadMap(makeFile({ mirrorX: false, model: '/maps/x.glb', trimesh }))
    expect(m.model).toBe('/maps/x.glb')
    expect(m.trimesh).toEqual(trimesh)
  })

  it('a map without a model has neither field', () => {
    const m = loadMap(makeFile({ mirrorX: false }))
    expect('model' in m).toBe(false)
    expect('trimesh' in m).toBe(false)
  })

  it('passes stepHeight through, and a map without one has none', () => {
    expect(loadMap(makeFile({ mirrorX: false, stepHeight: 0.9 })).stepHeight).toBe(0.9)
    expect('stepHeight' in loadMap(makeFile({ mirrorX: false }))).toBe(false)
  })

  it('refuses a model on a mirrored map (mirroring a mesh is not supported)', () => {
    expect(() => loadMap(makeFile({ mirrorX: true, trimesh }))).toThrow(/cannot be mirrored/)
  })
})
