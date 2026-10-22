import * as THREE from 'three'

export interface ArmStyle { upperLen: number; foreLen: number; thickness: number; handSize: number; sleeveToElbow?: boolean }

export interface TwoBoneResult { reached: boolean }

const _toT = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _perp = new THREE.Vector3()

/**
 * Analytic two-joint IK. Writes the elbow into `elbow` and the hand into `hand` (no allocation).
 * Out of reach: extends straight toward the target. The elbow always lies on the `pole` side.
 */
export function solveTwoBone(
  a: number, b: number,
  shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3,
  elbow: THREE.Vector3, hand: THREE.Vector3,
): boolean {
  _toT.subVectors(target, shoulder)
  const dist = _toT.length()
  if (dist < 1e-9) _dir.set(0, 0, -1); else _dir.copy(_toT).multiplyScalar(1 / dist)
  const reached = dist <= a + b
  const d = Math.min(Math.max(dist, Math.abs(a - b) + 1e-4), a + b - 1e-4)
  const x = (a * a - b * b + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(a * a - x * x, 0))
  _perp.subVectors(pole, shoulder)
  _perp.addScaledVector(_dir, -_perp.dot(_dir))
  if (_perp.lengthSq() < 1e-10) {   // pole on the shoulder-hand line: pick any perpendicular axis
    _perp.set(0, 1, 0)
    if (Math.abs(_dir.y) > 0.99) _perp.set(1, 0, 0)
    _perp.addScaledVector(_dir, -_perp.dot(_dir))
  }
  _perp.normalize()
  elbow.copy(shoulder).addScaledVector(_dir, x).addScaledVector(_perp, h)
  hand.copy(shoulder).addScaledVector(_dir, reached ? dist : d)
  return reached
}

const _m = new THREE.Matrix4()
const _o = new THREE.Vector3()
const _up = new THREE.Vector3()
const _elbow = new THREE.Vector3()
const _hand = new THREE.Vector3()

// Place a mesh (box long along local +Z) at `from`, with its Z axis pointing to `to`, up = `up`
function aim(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, up: THREE.Vector3): void {
  mesh.position.copy(from)
  _o.copy(from)
  _m.lookAt(to, _o, up)   // lookAt(eye, target): Z axis = eye − target = to − from
  mesh.quaternion.setFromRotationMatrix(_m)
}

// Shared unit box long along +Z (0..1); size is set by scale, so F9 tweaks show immediately
let unitBox: THREE.BoxGeometry | null = null
function getUnitBox(): THREE.BoxGeometry {
  if (!unitBox) { unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox.translate(0, 0, 0.5) }
  return unitBox
}

/** Blocky arm: upper arm + forearm + hand. `style` is a function so the latest values are read on every solve. */
export class BlockArm {
  readonly root = new THREE.Group()
  readonly meshes: THREE.Mesh[]
  readonly mats: THREE.MeshLambertMaterial[]
  readonly handMesh: THREE.Mesh
  private upper: THREE.Mesh
  private fore: THREE.Mesh
  private reachedLast = true
  private foreMat: THREE.MeshLambertMaterial
  private sleeveToElbow: boolean

  constructor(private style: () => ArmStyle, private sleeveColor: number, private skinColor: number) {   // colours can change later: setColors
    const mk = (color: number) => {
      const m = new THREE.Mesh(getUnitBox(), new THREE.MeshLambertMaterial({ color, transparent: true }))
      m.castShadow = false
      this.root.add(m)
      return m
    }
    this.upper = mk(sleeveColor)
    this.fore = mk(sleeveColor)
    this.handMesh = mk(skinColor)
    this.meshes = [this.upper, this.fore, this.handMesh]
    this.mats = this.meshes.map(m => m.material as THREE.MeshLambertMaterial)
    this.foreMat = this.mats[1]!
    this.sleeveToElbow = true
  }

  /** shoulder/target/pole in the space of the root's parent. */
  solve(shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3): { reached: boolean } {
    const s = this.style()
    const reached = solveTwoBone(s.upperLen, s.foreLen, shoulder, target, pole, _elbow, _hand)
    if (!!s.sleeveToElbow !== this.sleeveToElbow) {
      this.sleeveToElbow = !!s.sleeveToElbow
      this.foreMat.color.setHex(this.sleeveToElbow ? this.sleeveColor : this.skinColor)
    }
    _up.subVectors(pole, shoulder)   // up = pole direction: the arm does not twist around its own axis
    aim(this.upper, shoulder, _elbow, _up)
    aim(this.fore, _elbow, _hand, _up)
    this.upper.scale.set(s.thickness, s.thickness, s.upperLen)
    this.fore.scale.set(s.thickness * 0.92, s.thickness * 0.92, s.foreLen)
    // hand: a cube centred on the grip point (the unit box starts at 0, so shift back half a side along Z)
    this.handMesh.quaternion.copy(this.fore.quaternion)
    this.handMesh.scale.setScalar(s.handSize)
    this.handMesh.position.copy(_hand)
    _o.set(0, 0, -s.handSize / 2).applyQuaternion(this.handMesh.quaternion)
    this.handMesh.position.add(_o)
    this.elbowPos.copy(_elbow); this.handPos.copy(_hand)
    this.reachedLast = reached
    return { reached }
  }

  setColors(sleeve: number, skin: number): void {
    this.sleeveColor = sleeve; this.skinColor = skin
    this.mats[0]!.color.setHex(sleeve)
    this.mats[1]!.color.setHex(this.sleeveToElbow ? sleeve : skin)
    this.mats[2]!.color.setHex(skin)
  }

  setReachedColor(show: boolean): void {
    const e = show && !this.reachedLast ? 0xff0000 : 0
    for (const m of this.mats) m.emissive.setHex(e)
  }

  get reached(): boolean { return this.reachedLast }
  /** Elbow and hand from the most recent solve (for debugging) */
  readonly elbowPos = new THREE.Vector3()
  readonly handPos = new THREE.Vector3()

  setVisible(v: boolean): void { this.root.visible = v }

  dispose(): void {
    for (const m of this.mats) m.dispose()   // the box geometry is shared, so do not dispose it
  }
}
