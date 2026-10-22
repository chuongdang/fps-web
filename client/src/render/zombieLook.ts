// Zombie look (plan 16, ZF.1): colour tint (keeps the original texture), slight size variation, glowing red eyes (additive sprites, unaffected by lighting).
// Without a dedicated zombie model, use the player's own model (Infection) or the Terrorists model (Defense) plus a tint.
import * as THREE from 'three'
import { ZOMBIE_LOOK, zombieVariation } from '@fps/shared'
import type { CharacterRig } from './characters/types'

let glowTex: THREE.CanvasTexture | null = null
function glow(): THREE.CanvasTexture {
  if (!glowTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.18, '#ffd0c0'); grd.addColorStop(0.4, ZOMBIE_LOOK.variation.eyeGlow); grd.addColorStop(1, 'rgba(255,40,20,0)')
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32)
    glowTex = new THREE.CanvasTexture(c)
  }
  return glowTex
}

export interface ZombieFx {
  eyes: [THREE.Sprite, THREE.Sprite]
  scale: number
  orig: Map<THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, number>
}

const _head = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()

function headNode(rig: CharacterRig): THREE.Object3D { return rig.skel?.headBone ?? rig.headPivot }

/** Turn a rig into a zombie: tint + size + eyes. `opts` as in zombieVariation (Defense: tint per type). */
export function makeZombieFx(scene: THREE.Scene, rig: CharacterRig, id: number, opts: Parameters<typeof zombieVariation>[1], sizeMul = 1, eyeScale = 1, modelScale = 1): ZombieFx {
  const v = zombieVariation(id, opts)
  const orig = new Map<THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, number>()
  const tint = new THREE.Color(v.tint)
  const white = new THREE.Color(0xffffff)
  for (const m of rig.mats) {
    const mm = m as THREE.MeshLambertMaterial
    if (!mm.color) continue
    orig.set(mm, mm.color.getHex())
    mm.color.copy(white).lerp(tint, v.tintStrength)
  }
  sizeMul *= modelScale   // a dedicated zombie model has a height other than 1.8m: bring it to the hitbox size
  rig.root.scale.setScalar(v.scale * sizeMul)
  const mk = (): THREE.Sprite => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }))
    s.scale.setScalar(0.22 * eyeScale * Math.sqrt(sizeMul))   // large halo so it is clearly visible from afar at night
    s.renderOrder = 9
    scene.add(s)
    return s
  }
  return { eyes: [mk(), mk()], scale: v.scale * sizeMul, orig }
}

/** Place the eyes on the head every frame (the head tilts with pitch, so use the bone's world position/direction) */
export function updateZombieFx(fx: ZombieFx, rig: CharacterRig, visible: boolean, far = false): void {
  const on = visible && !far   // beyond 40m the eyes are switched off (ZF.7)
  fx.eyes[0].visible = fx.eyes[1].visible = on
  if (!on) return
  const h = headNode(rig)
  h.getWorldPosition(_head)
  // The face follows the root yaw (the model is rotated by pi so the face points to the root's -Z)
  const yaw = rig.root.rotation.y
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw))
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw))
  const s = fx.scale
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1
    fx.eyes[i]!.position.set(
      _head.x + _fwd.x * 0.10 * s + _right.x * 0.035 * s * side,
      _head.y + 0.09 * s,
      _head.z + _fwd.z * 0.10 * s + _right.z * 0.035 * s * side)
  }
}

export function removeZombieFx(scene: THREE.Scene, fx: ZombieFx, rig: CharacterRig): void {
  for (const e of fx.eyes) { scene.remove(e); e.material.dispose() }
  for (const [m, hex] of fx.orig) m.color.setHex(hex)
  rig.root.scale.setScalar(1)
}
