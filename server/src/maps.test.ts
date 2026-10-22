import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'fs'
import { loadMap } from '@fps/shared'
import { MAPS, DEFAULT_MAP_ID } from '../../assets/maps'

const dir = new URL('../../assets/maps/', import.meta.url)
const ids = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))

describe('map registry', () => {
  it('lists every assets/maps/*.json (a forgotten map would not be selectable)', () => {
    expect(Object.keys(MAPS).sort()).toEqual(ids.sort())
  })
  it('has the default map', () => {
    expect(MAPS[DEFAULT_MAP_ID]).toBeDefined()
  })
  it.each(ids)('%s loads and has spawns for both teams', id => {
    const map = loadMap(MAPS[id]!)
    expect(map.spawns.A.length).toBeGreaterThan(0)
    expect(map.spawns.B.length).toBeGreaterThan(0)
  })
  it.each(ids)('%s has a lobby preview image', id => {
    expect(existsSync(new URL(`../../client/public/maps/${id}.png`, import.meta.url))).toBe(true)
  })
  it.each(ids)('%s: a modelled map has its glb in client/public and collision triangles that index valid vertices', id => {
    const file = MAPS[id]!
    if (!file.model) return
    expect(existsSync(new URL(`../../client/public${file.model}`, import.meta.url))).toBe(true)
    const { vertices, indices } = file.trimesh!
    expect(indices.length % 3).toBe(0)
    expect(Math.max(...indices)).toBeLessThan(vertices.length / 3)
  })
})
