import * as THREE from 'three'
import type { LoadedMap, MapRamp } from '@fps/shared'

function makeGridTexture(): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#7a8a7a'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#4a5a4a'
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

function makeMat(tex: THREE.Texture, ru: number, rv: number): THREE.MeshLambertMaterial {
  const t = tex.clone()
  t.needsUpdate = true
  t.repeat.set(ru, rv)
  return new THREE.MeshLambertMaterial({ map: t })
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

export function buildMapMesh(map: LoadedMap): THREE.Group {
  const group = new THREE.Group()
  const baseTex = makeGridTexture()

  for (const box of map.boxes) {
    const [sx, sy, sz] = box.size
    const geo = new THREE.BoxGeometry(sx, sy, sz)
    const mat = makeMat(baseTex, sx / TILE, sz / TILE)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(box.pos[0], box.pos[1], box.pos[2])
    mesh.receiveShadow = true
    mesh.castShadow = true
    group.add(mesh)
  }

  for (const ramp of map.ramps) {
    const len = rampLen(ramp)
    const thick = 0.3
    const geo = new THREE.BoxGeometry(len, thick, ramp.width)
    const mat = makeMat(baseTex, len / TILE, ramp.width / TILE)
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

  return group
}
