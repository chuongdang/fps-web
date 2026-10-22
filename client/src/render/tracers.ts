import * as THREE from 'three'

const POOL = 24
const LIFE_MS = 90
const START_OFFSET = 0.6   // starts a little away from the eye, like the muzzle
const STREAK = 3           // streak length (m)

// Other players' tracers (ShotFx): a short streak that flies along the shot ray and vanishes, not a long continuous line.
// Fixed pool, nothing allocated per shot.
export function createTracers(scene: THREE.Scene) {
  const lines: THREE.Line[] = []
  const age: number[] = []
  const org = new Float32Array(POOL * 3)
  const dir = new Float32Array(POOL * 3)
  const dst = new Float32Array(POOL)
  for (let i = 0; i < POOL; i++) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true }))
    l.visible = false
    l.frustumCulled = false
    scene.add(l)
    lines.push(l)
    age.push(LIFE_MS)
  }
  let next = 0

  return {
    add(origin: readonly number[], d: readonly number[], dist: number): void {
      const i = next; next = (next + 1) % POOL
      for (let k = 0; k < 3; k++) { org[i * 3 + k] = origin[k]!; dir[i * 3 + k] = d[k]! }
      dst[i] = dist
      age[i] = 0
      lines[i]!.visible = true
    },
    update(dtMs: number): void {
      for (let i = 0; i < POOL; i++) {
        if (age[i]! >= LIFE_MS) continue
        age[i]! += dtMs
        const l = lines[i]!
        if (age[i]! >= LIFE_MS) { l.visible = false; continue }
        // The streak head travels from the muzzle to the hit point; the tail trails the head by STREAK metres (never behind the muzzle)
        const dist = dst[i]!
        const head = START_OFFSET + (dist - START_OFFSET) * (age[i]! / LIFE_MS)
        const tail = Math.max(Math.min(START_OFFSET, dist), head - STREAK)
        const attr = l.geometry.getAttribute('position') as THREE.BufferAttribute
        const a = attr.array as Float32Array
        for (let k = 0; k < 3; k++) {
          a[k] = org[i * 3 + k]! + dir[i * 3 + k]! * tail
          a[3 + k] = org[i * 3 + k]! + dir[i * 3 + k]! * Math.min(head, dist)
        }
        attr.needsUpdate = true
        ;(l.material as THREE.LineBasicMaterial).opacity = 1 - 0.5 * (age[i]! / LIFE_MS)
      }
    },
  }
}
