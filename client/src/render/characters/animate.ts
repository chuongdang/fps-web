import type { CharacterRig } from './types'

// Procedural animation (6.2): no animation files needed. Driven by the interpolated position between frames (=> interpolated velocity),
// not by input. It only touches the standard skeleton so it works for every character set. No allocation.
export interface AnimState {
  phase: number     // step phase (rad), grows with distance travelled
  speed: number     // smoothed horizontal speed (m/s)
  lastX: number
  lastZ: number
  hasLast: boolean
  air: number       // 0..1, blend toward the jump / slide / crouch pose (smoothed)
  slide: number
  crouch: number
}

export function makeAnimState(): AnimState {
  return { phase: 0, speed: 0, lastX: 0, lastZ: 0, hasLast: false, air: 0, slide: 0, crouch: 0 }
}

export interface AnimInput {
  x: number; z: number      // foot position (interpolated)
  dt: number                // seconds since the previous frame
  grounded: boolean
  crouching: boolean
  sliding: boolean
  pitch: number
  crouchDrop: number        // metres the hips drop at full crouch (only the legs shrink, torso/head keep their proportions)
}

const RUN_SPEED = 8.5          // running speed: maximum amplitude
const TELEPORT_M = 3           // a jump farther than this in one frame = respawn/teleport, not counted as running
const POSE_EASE = 15           // 1/s: blend speed of the jump/slide/crouch pose
export const HEAD_PITCH = 0.7         // share of the pitch taken by head/gun; the rest (1-0.7) comes from tilting the torso
const SLIDE_LEAN = 0.55        // lean back while sliding (rad, +X = tips backward)
const CROUCH_LEAN = -0.2       // lean forward while crouching
const AIR_LEG_L = 0.7          // jump: tuck the legs (one leg more than the other)
const AIR_LEG_R = 0.3

const HIP_Y = 0.8              // hip height when standing (matches kit.ts)

const approach = (cur: number, target: number, k: number) => cur + (target - cur) * k

export function updateAnim(rig: CharacterRig, st: AnimState, inp: AnimInput): void {
  const { dt } = inp
  let moved = 0
  if (st.hasLast && dt > 0) {
    moved = Math.hypot(inp.x - st.lastX, inp.z - st.lastZ)
    if (moved > TELEPORT_M) moved = 0
  }
  st.lastX = inp.x; st.lastZ = inp.z; st.hasLast = true
  const target = dt > 0 ? moved / dt : 0
  st.speed = approach(st.speed, target, Math.min(1, dt * 12))
  const running = inp.grounded && !inp.sliding
  if (running) st.phase += moved * rig.anim.strideRadPerM
  const amp = running ? Math.min(1, st.speed / RUN_SPEED) : 0
  const k = Math.min(1, dt * POSE_EASE)
  const sw = Math.sin(st.phase) * amp

  // Pose transitions (jump/slide/crouch) are smoothed with a weight; the running swing is not smoothed
  // (the step frequency far exceeds the smoothing speed, so smoothing would eat the amplitude)
  st.air = approach(st.air, !inp.grounded && !inp.sliding ? 1 : 0, k)
  st.slide = approach(st.slide, inp.sliding ? 1 : 0, k)
  st.crouch = approach(st.crouch, inp.crouching ? 1 : 0, k)

  // Legs + left arm swing in opposition; the right arm holds the gun
  let legL = sw * rig.anim.legSwing
  let legR = -sw * rig.anim.legSwing
  let armL = rig.armRestL - sw * rig.anim.armSwing
  legL += (AIR_LEG_L - legL) * st.air; legR += (AIR_LEG_R - legR) * st.air; armL += (rig.armRestL + 0.3 - armL) * st.air
  legL += (1.0 - legL) * st.slide; legR += (1.0 - legR) * st.slide; armL += (rig.armRestL + 0.3 - armL) * st.slide
  const lean = CROUCH_LEAN * st.crouch + SLIDE_LEAN * st.slide

  rig.legL.rotation.x = legL
  rig.legR.rotation.x = legR
  rig.armL.rotation.x = armL
  rig.upper.rotation.x = lean + inp.pitch * (1 - HEAD_PITCH)
  // Head and right arm (dragging the gun along) look/aim with the pitch (+pitch = look up = rotate +X around the pivot)
  rig.headPivot.rotation.x = inp.pitch * HEAD_PITCH
  rig.armR.rotation.x = rig.armRestR + inp.pitch * HEAD_PITCH
  // Slight bob while running (twice per step cycle)
  // Crouch: lower the hips, shorten the legs (scale the legs only), keep torso and head unchanged
  const hip = HIP_Y - inp.crouchDrop * st.crouch
  rig.legL.position.y = hip; rig.legR.position.y = hip
  rig.legL.scale.y = rig.legR.scale.y = hip / HIP_Y
  rig.upper.position.y = hip + Math.abs(sw) * rig.anim.bobAmp
}
