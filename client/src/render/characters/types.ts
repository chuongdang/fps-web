import type * as THREE from 'three'
import type { SkelCharacter } from '../characterRig'
import type { CharacterSetId, TeamId } from '@fps/shared'

/**
 * The standard skeleton every character set must build. Animation (animate.ts) and the death effect (deathFx.ts)
 * work only on this skeleton, so they know nothing about the look of any particular set.
 *
 * Coordinates: origin at the feet, facing -Z (yaw 0), back toward +Z. Sizes must match the hitbox (shared/hitbox.ts):
 * legs 0-0.8, torso 0.8-1.45, head 1.45-1.8 (0.35 wide, 0.3 deep); kit.ts guarantees this.
 */
export interface CharacterRig {
  root: THREE.Group
  legL: THREE.Group      // pivot at the hip, rotates around X to swing
  legR: THREE.Group
  upper: THREE.Group     // pivot at the hip: torso + head + arms + gun (leans when sliding / follows pitch)
  headPivot: THREE.Group // pivot at the neck
  armL: THREE.Group      // pivot at the shoulder
  armR: THREE.Group
  gunAnchor: THREE.Group // child of armR, placed at the hand, points -Z (when pitch = 0)
  headMesh: THREE.Mesh   // used to test the hitbox fit
  parts: THREE.Mesh[]    // every box (the death effect breaks apart from these)
  mats: THREE.Material[]
  skel?: SkelCharacter   // skinned character (render/characterRig.ts): the boxes above are just empty shells to satisfy the interface
  team: TeamId
  armRestR: number       // resting X angle of the arm (holding a gun)
  armRestL: number
  anim: AnimTuning
}

// Per-set animation factors (heavy / light characters)
export interface AnimTuning {
  strideRadPerM: number  // step phase per distance travelled (rad/m)
  legSwing: number       // leg amplitude at full running speed (rad)
  armSwing: number       // left arm amplitude
  bobAmp: number         // body bob (m)
}

export const DEFAULT_ANIM: AnimTuning = { strideRadPerM: 3.6, legSwing: 0.75, armSwing: 0.35, bobAmp: 0.03 }

export interface CharacterSet {
  id: CharacterSetId
  label: string
  build(team: TeamId): CharacterRig
}
