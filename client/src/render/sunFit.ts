// Fits the sun's shadow camera to a map: the shadow map has a fixed size, so a small map gets sharper shadows than a big one.
// Pure numbers (no Three import) so it can be tested.
import type { LoadedMap, Vec3 } from '@fps/shared'

/** Where the sun sits relative to the middle of the map (this also sets the light direction) */
export const SUN_OFFSET: Vec3 = [20, 40, 20]
const MARGIN_M = 2

export interface SunFit {
  center: Vec3   // the sun looks at this point
  radius: number // half-size of the square orthographic shadow camera (a sphere around the map)
  far: number    // far plane of the shadow camera
}

/** Bounding box of everything that is drawn (invisible walls are skipped: they never cast shadows). Null if the map draws nothing. */
export function drawnBounds(map: LoadedMap): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const grow = (p: Vec3, r: Vec3): void => {
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, p[i]! - r[i]!); max[i] = Math.max(max[i]!, p[i]! + r[i]!) }
  }
  for (const b of map.boxes) if (!b.invisible) grow(b.pos, [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2])
  for (const r of map.ramps) { const w = r.width / 2; grow(r.from, [w, w, w]); grow(r.to, [w, w, w]) }
  if (map.trimesh) {
    const v = map.trimesh.vertices
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, v[i + k]!); max[k] = Math.max(max[k]!, v[i + k]!) }
  }
  return Number.isFinite(min[0]!) ? { min, max } : null
}

export function sunFitFor(map: LoadedMap): SunFit {
  const bounds = drawnBounds(map)
  if (!bounds) return { center: [0, 0, 0], radius: 20, far: 120 }
  const center: Vec3 = [0, 1, 2].map(i => (bounds.min[i]! + bounds.max[i]!) / 2) as Vec3
  const radius = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / 2 + MARGIN_M
  return { center, radius, far: Math.hypot(...SUN_OFFSET) + radius + MARGIN_M }
}
