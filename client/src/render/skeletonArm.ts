import * as THREE from 'three'
import { solveTwoBone } from './blockArm'
import { poses, type FingerName, type Vec3 } from './poses'

// Arm using the model's real bones (plan 11, C.5): 2-joint IK rotating upper/fore, orients the hand to the gun,
// curls the fingers per poses.json:grip. All coordinates/quaternions of solve() are in world space. No allocation in solve().
export interface FingerBones { thumb: THREE.Bone[]; index: THREE.Bone[]; middle: THREE.Bone[]; ring: THREE.Bone[]; pinky: THREE.Bone[] }
export const FINGER_NAMES: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky']
const DEG = Math.PI / 180

const _sh = new THREE.Vector3(), _el0 = new THREE.Vector3(), _wr0 = new THREE.Vector3()
const _elN = new THREE.Vector3(), _wrN = new THREE.Vector3(), _wrist = new THREE.Vector3()
const _dirCur = new THREE.Vector3(), _dirNew = new THREE.Vector3(), _fing = new THREE.Vector3()
const _qd = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _tq = new THREE.Quaternion()
const _hq = new THREE.Quaternion(), _off = new THREE.Quaternion(), _eul = new THREE.Euler(), _grip = new THREE.Quaternion()
const _m = new THREE.Matrix4(), _axis = new THREE.Vector3()
const E1C = new THREE.Vector3(0, 0, -1)   // the gun's finger direction, pointing -Z

/** New world quaternion of the bone such that the vector `from` (world) rotates onto `to`, returned in the bone's local form (blended by weight). */
function rotateBoneTo(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number): void {
  _qd.setFromUnitVectors(from, to)
  bone.getWorldQuaternion(_wq).premultiply(_qd)
  bone.parent!.getWorldQuaternion(_pq)
  _tq.copy(_pq).invert().multiply(_wq)
  if (weight < 1) bone.quaternion.slerp(_tq, weight); else bone.quaternion.copy(_tq)
  bone.updateWorldMatrix(false, true)
}

export class SkeletonArm {
  lenA: number            // multiplied by the current world scale (updated on every solve)
  lenB: number
  palmLen: number
  private readonly lenA0: number   // length at scale 1
  private readonly lenB0: number
  private readonly palm0: number
  private readonly scale0: number
  reached = true
  // hand frame: X axis = finger direction, Z = palm normal, Y = Z x X
  private readonly basisInHandInv = new THREE.Quaternion()
  private readonly qCanon = new THREE.Quaternion()
  private readonly offsetDeg: () => Vec3
  private readonly restBones: THREE.Object3D[]
  private readonly restQuats: THREE.Quaternion[]
  private readonly restUpperPos = new THREE.Vector3()

  /** Must be built while the model is in T-pose (mixer not yet running): measures bone lengths + the resting hand frame. */
  constructor(
    readonly upper: THREE.Bone, readonly fore: THREE.Bone, readonly hand: THREE.Bone,
    readonly fingers: FingerBones, readonly side: 'L' | 'R',
  ) {
    upper.updateWorldMatrix(true, true)
    upper.getWorldPosition(_sh); fore.getWorldPosition(_el0); hand.getWorldPosition(_wr0)
    this.scale0 = upper.getWorldScale(_fing).x
    this.lenA = this.lenA0 = _sh.distanceTo(_el0) / this.scale0
    this.lenB = this.lenB0 = _el0.distanceTo(_wr0) / this.scale0
    const knuckle = fingers.middle[0]!.getWorldPosition(_elN)
    const f = _dirCur.subVectors(knuckle, _wr0)
    const handLen = f.length()
    this.palm0 = handLen / this.scale0
    this.palmLen = handLen * poses.character.palmCenterFrac
    f.normalize()
    // T-pose: palm faces down
    const n = _dirNew.set(0, -1, 0)
    n.addScaledVector(f, -n.dot(f)).normalize()
    const u = _fing.crossVectors(n, f)
    const qRest = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(f, u, n))
    const handQ = hand.getWorldQuaternion(new THREE.Quaternion())
    const basisInHand = handQ.invert().multiply(qRest)
    this.basisInHandInv.copy(basisInHand).invert()
    const nc = new THREE.Vector3(side === 'R' ? -1 : 1, 0, 0)
    const uc = new THREE.Vector3().crossVectors(nc, E1C)
    this.qCanon.setFromRotationMatrix(_m.makeBasis(E1C, uc, nc))
    this.offsetDeg = () => (side === 'R' ? poses.character.handRotOffsetDegR : poses.character.handRotOffsetDegL)
    // Rest pose (T-pose) of every bone that solve/applyGrip touches, used to reset when no mixer overwrites them each frame
    this.restBones = [upper, fore, hand, ...FINGER_NAMES.flatMap(n => fingers[n].slice(0, 3))]
    this.restQuats = this.restBones.map(b => b.quaternion.clone())
    this.restUpperPos.copy(upper.position)
  }

  /**
   * Puts the arm bones back to the rest pose. MUST be called every frame before solve/applyGrip when there is no AnimationMixer
   * (viewmodel arm): applyGrip multiplies extra angles onto the current quaternion, so without a reset the fingers keep curling further (endless rotation).
   * Not needed in 3rd person because the mixer overwrites the bones every frame.
   */
  resetPose(): void {
    for (let i = 0; i < this.restBones.length; i++) this.restBones[i]!.quaternion.copy(this.restQuats[i]!)
    this.upper.position.copy(this.restUpperPos)
    this.upper.updateWorldMatrix(false, true)
  }

  /**
   * Viewmodel: if the palm centre `target` (world) is farther from the shoulder than the reach (lenA+lenB)*ext + palm, slide the shoulder toward the target to fit,
   * instead of leaving the hand short of it. Call after resetPose() and before solve(); resetPose() puts the shoulder back.
   */
  slideToReach(target: THREE.Vector3, ext: number): void {
    this.upper.updateWorldMatrix(true, false)
    this.upper.getWorldPosition(_sh)
    const sc = this.upper.getWorldScale(_fing).x
    const reach = ((this.lenA0 + this.lenB0) * ext + this.palm0 * poses.character.palmCenterFrac) * sc
    const d = _sh.distanceTo(target)
    if (d <= reach) return
    _dirNew.subVectors(target, _sh).normalize()
    _sh.addScaledVector(_dirNew, d - reach)
    this.upper.position.copy(this.upper.parent!.worldToLocal(_sh))
    this.upper.updateWorldMatrix(false, true)
  }

  /** Bone-local quaternion of the "standard hand" (fingers -Z, thumb +Y): used to attach a one-handed gun to the hand bone. */
  gunFrameInHand(out: THREE.Quaternion): THREE.Quaternion { return out.copy(this.qCanon).multiply(this.basisInHandInv).invert() }
  /** Palm centre position in the hand bone's space (along the finger direction). */
  palmCenterInHand(out: THREE.Vector3): THREE.Vector3 {
    _tq.copy(this.basisInHandInv).invert()   // standard frame -> bone: the frame's X axis (finger direction) in bone space
    return out.set(1, 0, 0).applyQuaternion(_tq).multiplyScalar(this.palmLen)
  }

  /**
   * target = desired palm centre position (world); targetQuat = orientation of the anchor/gun; pole = the point the elbow bends toward.
   * weight 0..1 blends between the animation pose and IK. Call after the mixer/spine/gun have updated matrixWorld.
   */
  solve(target: THREE.Vector3, targetQuat: THREE.Quaternion, pole: THREE.Vector3, weight: number): { reached: boolean } {
    if (weight <= 0) return { reached: true }
    const sc = this.upper.getWorldScale(_fing).x
    this.lenA = this.lenA0 * sc; this.lenB = this.lenB0 * sc
    this.palmLen = this.palm0 * sc * poses.character.palmCenterFrac
    const o = this.offsetDeg()
    _off.setFromEuler(_eul.set(o[0] * DEG, o[1] * DEG, o[2] * DEG, 'XYZ'))
    const gunHandQ = _hq.copy(targetQuat).multiply(_off)               // standard hand frame in world space
    _fing.copy(E1C).applyQuaternion(gunHandQ)                          // finger direction in world space
    _wrist.copy(target).addScaledVector(_fing, -this.palmLen)          // wrist = palm centre moved back along the fingers
    // 1) upper: shoulder -> elbow
    this.upper.updateWorldMatrix(true, true)
    this.upper.getWorldPosition(_sh); this.fore.getWorldPosition(_el0)
    solveTwoBone(this.lenA, this.lenB, _sh, _wrist, pole, _elN, _wrN)
    _dirCur.subVectors(_el0, _sh).normalize()
    _dirNew.subVectors(_elN, _sh).normalize()
    rotateBoneTo(this.upper, _dirCur, _dirNew, weight)
    // 2) fore: elbow -> wrist
    this.fore.getWorldPosition(_el0); this.hand.getWorldPosition(_wr0)
    _dirCur.subVectors(_wr0, _el0).normalize()
    _dirNew.subVectors(_wrist, _el0).normalize()
    rotateBoneTo(this.fore, _dirCur, _dirNew, weight)
    // 3) hand: world orientation = standard frame x (standard frame -> hand bone)
    _wq.copy(gunHandQ).multiply(this.qCanon).multiply(this.basisInHandInv)
    this.fore.getWorldQuaternion(_pq)
    _tq.copy(_pq).invert().multiply(_wq)
    if (weight < 1) _tq.copy(this.hand.quaternion).slerp(_tq, weight)
    this.hand.quaternion.copy(_tq)
    this.hand.updateWorldMatrix(false, true)
    this.hand.getWorldPosition(_wr0)
    this.reached = _wr0.distanceTo(_wrist) < 0.03
    return { reached: this.reached }
  }

  /** Curls the fingers per grip (degrees, 3 joints per finger) scaled by weight, added on top of the bones' current pose. */
  applyGrip(weight: number): void {
    if (weight <= 0) return
    const g = poses.grip, set = this.side === 'R' ? g.R : g.L
    _axis.set(g.axis === 'x' ? 1 : 0, g.axis === 'y' ? 1 : 0, g.axis === 'z' ? 1 : 0)
    for (const name of FINGER_NAMES) {
      const bones = this.fingers[name], deg = set[name]
      for (let i = 0; i < bones.length && i < 3; i++) {
        _grip.setFromAxisAngle(_axis, deg[i]! * DEG * weight)
        bones[i]!.quaternion.multiply(_grip)
      }
    }
  }
}
