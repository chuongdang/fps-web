// Reads the triangles of a .glb (every mesh, node transforms applied) and welds duplicate vertices, for a map's collision mesh.
// Library:  import { readGlbTriangles } from './glb-collision.mjs'   ->  { vertices: number[] (x,y,z...), indices: number[], min, max }
// CLI:      node scripts/glb-collision.mjs <in.glb> [out.json] [--precision=3]    (prints a summary; writes { vertices, indices } if out.json is given)
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMPONENT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] }
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a .glb file')
  let json = null, bin = null
  for (let o = 12; o < buf.length;) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (type === 0x004e4942) bin = data
    o += 8 + len
  }
  return { json, bin }
}

function readAccessor(json, bin, index) {
  const a = json.accessors[index], v = json.bufferViews[a.bufferView]
  const [Type, size] = COMPONENT[a.componentType], width = WIDTH[a.type]
  const stride = v.byteStride ?? size * width
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const out = new Float64Array(a.count * width)
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < width; k++) {
      const at = bin.byteOffset + start + i * stride + k * size
      out[i * width + k] = new Type(bin.buffer.slice(at, at + size))[0]
    }
  }
  return out
}

function nodeMatrix(n) {   // column-major 4x4
  if (n.matrix) return n.matrix.slice()
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0]
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]
}
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o }

export function readGlbTriangles(path, { precision = 3 } = {}) {
  const { json, bin } = parseGlb(readFileSync(path))
  const vertices = [], indices = [], weld = new Map()
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  const k = 10 ** precision
  const vertexId = (x, y, z) => {
    const key = `${Math.round(x * k)},${Math.round(y * k)},${Math.round(z * k)}`
    let id = weld.get(key)
    if (id === undefined) {
      id = vertices.length / 3; weld.set(key, id)
      const p = [Math.round(x * k) / k, Math.round(y * k) / k, Math.round(z * k) / k]
      vertices.push(...p)
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]) }
    }
    return id
  }
  const visit = (ni, parent) => {
    const n = json.nodes[ni], m = mul(parent, nodeMatrix(n))
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue   // triangles only
        const pos = readAccessor(json, bin, prim.attributes.POSITION)
        const idx = prim.indices !== undefined ? readAccessor(json, bin, prim.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i)
        const ids = []
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2]
          ids.push(vertexId(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]))
        }
        for (let i = 0; i < idx.length; i += 3) {
          const a = ids[idx[i]], b = ids[idx[i + 1]], c = ids[idx[i + 2]]
          if (a !== b && b !== c && a !== c) indices.push(a, b, c)   // welding can collapse a sliver triangle: drop it
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m)
  }
  const scene = json.scenes[json.scene ?? 0]
  for (const r of scene.nodes) visit(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  return { vertices, indices, min, max }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), pos = args.filter(a => !a.startsWith('--'))
  const precision = Number((args.find(a => a.startsWith('--precision=')) ?? '--precision=3').split('=')[1])
  if (!pos[0]) { console.error('usage: node scripts/glb-collision.mjs <in.glb> [out.json] [--precision=3]'); process.exit(1) }
  const r = readGlbTriangles(pos[0], { precision })
  console.log(`${r.vertices.length / 3} vertices, ${r.indices.length / 3} triangles, min ${r.min}, max ${r.max}`)
  if (pos[1]) writeFileSync(pos[1], JSON.stringify({ vertices: r.vertices, indices: r.indices }))
}
