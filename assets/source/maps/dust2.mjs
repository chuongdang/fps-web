// Generator for assets/maps/dust2.json  -  run:  node assets/source/maps/dust2.mjs
//
// The map is the Sketchfab model "de_dust2 - CS map" by vrchris (CC-BY-4.0, see assets/source/maps/dust2-model/license.txt and assets/CREDITS.json).
//   1. Model -> game glb (metres, Y up, centred, floor at y = 0), once, with Blender:
//        node scripts/blender.mjs build-scene assets/source/maps/dust2-model/scene.gltf client/public/maps/dust2.glb --scale=1.875 --turn-deg=90 --center --ground
//      (1 Counter-Strike unit = 0.025 m, so a 72-unit player is our 1.8 m player: 0.025 * 75 = 1.875; the turn puts the T side at +x and the CT side at -x)
//   2. This script reads that glb for the collision triangles and writes the map file with the spawns and buy zones below.
// Edit the numbers below, run the script, commit the json. See plan/tools-model-import.md for the general recipe.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readGlbTriangles } from '../../../scripts/glb-collision.mjs'

const GLB = new URL('../../../client/public/maps/dust2.glb', import.meta.url)
const OUT = new URL('../../maps/dust2.json', import.meta.url)

// Team A (Cops) = the CT side at -x, team B (Terrorists) = the T side at +x. The map has several floors, so each spawn is [x, z, floorHint]: the
// script puts the spawn on the surface closest to floorHint (metres). Both teams face the middle of the map.
// The model's stairs have 0.4-0.8 m risers: the player walks up a ledge this high without jumping (the controller's auto-step). A 0.9 m limit also
// lets players step onto low crates, but the 1.4 m ledges of the model still need a jump or a ramp.
const STEP_HEIGHT = 0.9
const SPAWN_LIFT = 0.2   // spawn this far above the floor, the player settles on it
const SPAWNS_A = [-33, -30].flatMap(x => [1.5, 4.5, 7.5, 10.5].map(z => [x, z, 2]))        // west end of mid, on the CT side
const SPAWNS_B = [42, 46].flatMap(x => [22, 25, 28, 31].map(z => [x, z, 8]))               // the high T plateau
const YAW_A = -Math.PI / 2   // looks toward +x
const YAW_B = Math.PI / 2    // looks toward -x
const BUY_ZONE_A = { min: [-37, 0, -1], max: [-24, 6, 13] }
const BUY_ZONE_B = { min: [38, 6, 18], max: [52, 12, 46] }

// Height of the model's surface under (x, z) that is closest to `hint`
function floorY(mesh, x, z, hint) {
  const v = mesh.vertices, ix = mesh.indices
  let best = null
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3
    const d = (v[b + 2] - v[c + 2]) * (v[a] - v[c]) + (v[c] - v[b]) * (v[a + 2] - v[c + 2])
    if (Math.abs(d) < 1e-9) continue   // a vertical triangle: no floor
    const u = ((v[b + 2] - v[c + 2]) * (x - v[c]) + (v[c] - v[b]) * (z - v[c + 2])) / d
    const w = ((v[c + 2] - v[a + 2]) * (x - v[c]) + (v[a] - v[c]) * (z - v[c + 2])) / d
    if (u < 0 || w < 0 || u + w > 1) continue
    const y = u * v[a + 1] + w * v[b + 1] + (1 - u - w) * v[c + 1]
    if (best === null || Math.abs(y - hint) < Math.abs(best - hint)) best = y
  }
  if (best === null) throw new Error(`no floor under (${x}, ${z})`)
  return best
}

const mesh = readGlbTriangles(fileURLToPath(GLB), { precision: 3 })
const spawns = (list, yaw) => list.map(([x, z, hint]) => ({ pos: [x, +(floorY(mesh, x, z, hint) + SPAWN_LIFT).toFixed(2), z], yaw }))
const file = {
  name: 'Dust2',
  mirrorX: false,
  model: '/maps/dust2.glb',
  stepHeight: STEP_HEIGHT,
  boxes: [],
  ramps: [],
  buyZoneA: BUY_ZONE_A,
  buyZoneB: BUY_ZONE_B,
  spawnsA: spawns(SPAWNS_A, YAW_A),
  spawnsB: spawns(SPAWNS_B, YAW_B),
  trimesh: { vertices: mesh.vertices, indices: mesh.indices },
}
writeFileSync(OUT, JSON.stringify(file))
console.log(`dust2.json: ${mesh.vertices.length / 3} vertices, ${mesh.indices.length / 3} triangles, x ${mesh.min[0]}..${mesh.max[0]}, y ${mesh.min[1]}..${mesh.max[1]}, z ${mesh.min[2]}..${mesh.max[2]}`)
