import * as THREE from 'three'
import type { TeamId } from '@fps/shared'
import { DEFAULT_ANIM, type AnimTuning, type CharacterRig } from './types'

export interface Palette {
  torso: number
  arms: number
  legs: number
  skin: number
}

export interface Kit {
  rig: CharacterRig
  // Add a box to `parent` (default: root); registers itself in parts/mats
  box(parent: THREE.Object3D, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh
}

/**
 * Builds the standard skeleton matching the hitbox. A character set only picks colours and attaches extra details (cap, pack, antenna...)
 * to rig.upper / rig.headPivot / rig.root via kit.box; it must not resize the torso/head/legs.
 */
export function createKit(team: TeamId, pal: Palette, anim: Partial<AnimTuning> = {}): Kit {
  const root = new THREE.Group()
  const parts: THREE.Mesh[] = []
  const mats: THREE.MeshLambertMaterial[] = []
  const box: Kit['box'] = (parent, w, h, d, color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, transparent: true }))
    mats.push(m.material as THREE.MeshLambertMaterial)
    m.position.set(x, y, z)
    m.castShadow = false   // characters cast no real shadow: a fake blob shadow is used (render/blobShadow.ts)
    parent.add(m)
    parts.push(m)
    return m
  }
  const pivot = (parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group => {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    parent.add(g)
    return g
  }

  // Legs: pivot at the hip (y 0.8), box hangs down
  const legL = pivot(root, -0.1, 0.8)
  const legR = pivot(root, 0.1, 0.8)
  box(legL, 0.22, 0.8, 0.26, pal.legs, 0, -0.4, 0)
  box(legR, 0.22, 0.8, 0.26, pal.legs, 0, -0.4, 0)

  // Upper body: pivot at the hip
  const upper = pivot(root, 0, 0.8)
  box(upper, 0.4, 0.65, 0.26, pal.torso, 0, 0.325, 0)
  const headPivot = pivot(upper, 0, 0.65)   // neck at y 1.45
  const headMesh = box(headPivot, 0.35, 0.35, 0.3, pal.skin, 0, 0.175, 0)   // 1.45–1.8

  // Arms: pivot at the shoulder (y 1.4), held forward as if holding a gun
  const armRestR = 1.35, armRestL = 1.15
  const arm = (x: number, rotX: number, rotZ: number) => {
    const p = pivot(upper, x, 0.6)
    p.rotation.set(rotX, 0, rotZ)
    box(p, 0.1, 0.6, 0.14, pal.arms, 0, -0.3, 0)
    box(p, 0.1, 0.1, 0.14, pal.skin, 0, -0.62, 0)   // hand
    return p
  }
  const armR = arm(0.25, armRestR, 0)
  const armL = arm(-0.25, armRestL, -0.35)

  // The gun is attached to the right hand (child of armR so it follows the arm). Counter-rotate armRestR so the gun still points -Z when the arm is at rest
  const gunAnchor = pivot(armR, 0, -0.62)
  gunAnchor.rotation.x = -armRestR

  const rig: CharacterRig = {
    root, legL, legR, upper, headPivot, armL, armR, gunAnchor, headMesh, parts, mats, team,
    armRestR, armRestL, anim: { ...DEFAULT_ANIM, ...anim },
  }
  return { rig, box }
}

export function disposeRig(r: CharacterRig): void {
  for (const p of r.parts) p.geometry.dispose()
  for (const m of r.mats) m.dispose()
}
