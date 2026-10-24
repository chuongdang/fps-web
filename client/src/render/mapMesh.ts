import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { resolveBoxLook, type LoadedMap, type MapRamp } from '@fps/shared'

function makeGridTexture(): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'   // neutral: the real colour is multiplied in by material.color
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#999999'
  ctx.lineWidth = 2
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

const TILE = 1.0  // metres per texture tile

const RAMP_COLOR = 0x7a8a7a   // ramp colour (kept like the old grey-green checker tiles)
const CRATE_MODEL = '/models/crate.glb'
const MODEL_ANISOTROPY = 8

function makeMat(tex: THREE.Texture, ru: number, rv: number, color: THREE.ColorRepresentation = 0xffffff): THREE.MeshLambertMaterial {
  const t = tex.clone()
  t.needsUpdate = true
  t.repeat.set(ru, rv)
  return new THREE.MeshLambertMaterial({ map: t, color })
}

// Material images (client/public/textures/<name>.jpg): loaded once per name; until loaded, the material updates itself when the image arrives
const imageLoader = new THREE.TextureLoader()
const images = new Map<string, THREE.Texture>()
function getImage(name: string): THREE.Texture {
  let t = images.get(name)
  if (!t) {
    t = imageLoader.load(`/textures/${name}.jpg`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    images.set(name, t)
  }
  return t
}

// Quaternion rotating local X-axis to align with unit direction (dx, dy, dz)
function dirToQuatX(dx: number, dy: number, dz: number): THREE.Quaternion {
  const sinTheta = Math.sqrt(dy * dy + dz * dz)
  const cosTheta = dx
  if (sinTheta < 1e-9) {
    return cosTheta > 0
      ? new THREE.Quaternion()
      : new THREE.Quaternion(0, 1, 0, 0)
  }
  const half = Math.atan2(sinTheta, cosTheta) / 2
  const f = Math.sin(half) / sinTheta
  return new THREE.Quaternion(0, -dz * f, dy * f, Math.cos(half))
}

function rampLen(r: MapRamp): number {
  const dx = r.to[0] - r.from[0]
  const dy = r.to[1] - r.from[1]
  const dz = r.to[2] - r.from[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** `onChange` runs whenever a late-loading part (crate model, map glb) joins the group, so the caller can refresh the static shadow map */
export function buildMapMesh(map: LoadedMap, onChange?: () => void): THREE.Group {
  const group = new THREE.Group()
  const baseTex = makeGridTexture()

  const crateSlots: THREE.Mesh[] = []   // placeholder boxes for the crates, replaced by the model once loaded (collision/bullets always use the map boxes)
  for (const box of map.boxes) {
    if (box.invisible) continue
    const [sx, sy, sz] = box.size
    const look = resolveBoxLook(box)
    const geo = new THREE.BoxGeometry(sx, sy, sz)
    // One material per face so the image repeats to that face's size (order: +x -x +y -y +z -z)
    const src = look.file ? getImage(look.file) : baseTex
    const tile = look.file ? look.tileM : TILE
    const faces: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]
    const mats = faces.map(([w, h]) => makeMat(src, w / tile, h / tile, look.color ?? 0xffffff))
    const mesh = new THREE.Mesh(geo, mats)
    mesh.position.set(box.pos[0], box.pos[1], box.pos[2])
    mesh.receiveShadow = true
    mesh.castShadow = true
    group.add(mesh)
    if (look.crate) crateSlots.push(mesh)
  }
  if (crateSlots.length) {
    new GLTFLoader().loadAsync(CRATE_MODEL).then(gltf => {
      gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true } })
      for (const slot of crateSlots) {
        const crate = gltf.scene.clone(true)   // the model is a 1x1x1 block centred at the origin: scale it to the box size
        crate.position.copy(slot.position)
        const p = (slot.geometry as THREE.BoxGeometry).parameters
        crate.scale.set(p.width, p.height, p.depth)
        group.add(crate)
        group.remove(slot)
        slot.geometry.dispose()
      }
      onChange?.()
    }).catch(err => console.warn(`mapMesh: cannot load ${CRATE_MODEL}, keeping the placeholder box`, err))
  }

  for (const ramp of map.ramps) {
    const len = rampLen(ramp)
    const thick = 0.3
    const geo = new THREE.BoxGeometry(len, thick, ramp.width)
    // A ramp with a "texture" is drawn like a box (image repeats to the ramp size), otherwise the old grey-green checker tiles
    const look = ramp.texture
      ? resolveBoxLook({ pos: ramp.from, size: [len, 0.3, ramp.width], texture: ramp.texture, variant: ramp.variant, color: ramp.color })
      : null
    const mat = look?.file
      ? makeMat(getImage(look.file), len / look.tileM, ramp.width / look.tileM, look.color ?? 0xffffff)
      : makeMat(baseTex, len / TILE, ramp.width / TILE, look?.color ?? RAMP_COLOR)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(
      (ramp.from[0] + ramp.to[0]) / 2,
      (ramp.from[1] + ramp.to[1]) / 2,
      (ramp.from[2] + ramp.to[2]) / 2,
    )
    const dx = ramp.to[0] - ramp.from[0]
    const dy = ramp.to[1] - ramp.from[1]
    const dz = ramp.to[2] - ramp.from[2]
    mesh.quaternion.copy(dirToQuatX(dx / len, dy / len, dz / len))
    mesh.receiveShadow = true
    mesh.castShadow = true
    group.add(mesh)
  }

  if (map.model) addModel(group, map.model, onChange)

  return group
}

/** A modelled map (plan/tools-model-import.md): the glb is already in game coordinates, so it is added as is. It arrives later than the boxes, once loaded. */
function addModel(group: THREE.Group, url: string, onChange?: () => void): void {
  new GLTFLoader().loadAsync(url).then(gltf => {
    if (group.userData.disposed) { disposeMapMesh(gltf.scene as unknown as THREE.Group); return }   // the room's map replaced this one while it was loading
    gltf.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      // The game lights everything with Lambert materials (one look for all maps); keep only the picture of the model's PBR material
      const src = o.material as THREE.MeshStandardMaterial
      if (src.map) src.map.anisotropy = MODEL_ANISOTROPY   // sharp floors at grazing angles (three clamps it to what the GPU supports)
      o.material = new THREE.MeshLambertMaterial({ map: src.map, side: src.side })
      src.dispose()
      o.castShadow = true
      o.receiveShadow = true
    })
    group.add(gltf.scene)
    onChange?.()
  }).catch(err => console.warn(`mapMesh: cannot load ${url}`, err))
}

/** Free the GPU memory of a mesh made by buildMapMesh (when the room's map replaces the lobby backdrop) */
export function disposeMapMesh(group: THREE.Group): void {
  group.userData.disposed = true
  group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.dispose()
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      (m as THREE.MeshLambertMaterial).map?.dispose()
      m.dispose()
    }
  })
}
