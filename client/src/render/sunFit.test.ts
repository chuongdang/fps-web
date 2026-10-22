import { describe, it, expect } from 'vitest'
import { loadMap, type LoadedMap, type MapFile } from '@fps/shared'
import { MAPS, DEFAULT_MAP_ID } from '../../../assets/maps'
import { drawnBounds, sunFitFor, SUN_OFFSET } from './sunFit'

const empty = (over: Partial<LoadedMap>): LoadedMap => ({ name: 't', boxes: [], ramps: [], spawns: { A: [], B: [] }, buyZones: {}, ...over })

describe('sunFit', () => {
  it('a map that draws nothing gets a default fit', () => {
    expect(drawnBounds(empty({}))).toBeNull()
    expect(sunFitFor(empty({})).radius).toBeGreaterThan(0)
  })
  it('invisible walls are ignored', () => {
    const map = empty({ boxes: [
      { pos: [0, 0, 0], size: [2, 2, 2], texture: 'wall' },
      { pos: [100, 100, 100], size: [2, 2, 2], texture: 'wall', invisible: true },
    ] })
    expect(drawnBounds(map)).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] })
  })
  it('ramps count, including their width', () => {
    const map = empty({ ramps: [{ from: [0, 0, 0], to: [10, 2, 0], width: 4 }] })
    expect(drawnBounds(map)).toEqual({ min: [-2, -2, -2], max: [12, 4, 2] })
  })
  it('the triangles of a modelled map count', () => {
    const map = empty({ trimesh: { vertices: [-5, 0, -3, 7, 2, 0, 0, 9, 4], indices: [0, 1, 2] } })
    expect(drawnBounds(map)).toEqual({ min: [-5, 0, -3], max: [7, 9, 4] })
  })
  it.each(Object.keys(MAPS))('%s: every corner of every drawn box is inside the shadow camera sphere and the far plane', id => {
    const map = loadMap(MAPS[id]!)
    const fit = sunFitFor(map)
    for (const b of map.boxes) {
      if (b.invisible) continue
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const d = Math.hypot(b.pos[0] + sx * b.size[0] / 2 - fit.center[0], b.pos[1] + sy * b.size[1] / 2 - fit.center[1], b.pos[2] + sz * b.size[2] / 2 - fit.center[2])
        expect(d).toBeLessThanOrEqual(fit.radius)
      }
    }
    expect(fit.far).toBeGreaterThan(Math.hypot(...SUN_OFFSET) + fit.radius)
  })
  it('a bigger map gets a bigger shadow camera', () => {
    const small = loadMap({ name: 's', mirrorX: false, boxes: [{ pos: [0, 0, 0], size: [10, 1, 10], texture: 'wall' }], ramps: [], spawnsA: [] } as MapFile)
    const big = loadMap({ name: 'b', mirrorX: false, boxes: [{ pos: [0, 0, 0], size: [100, 1, 100], texture: 'wall' }], ramps: [], spawnsA: [] } as MapFile)
    expect(sunFitFor(big).radius).toBeGreaterThan(sunFitFor(small).radius)
    expect(MAPS[DEFAULT_MAP_ID]).toBeDefined()
  })
})
