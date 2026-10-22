import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { TeamId } from '@fps/shared'
import { poses, type Vec3 } from './poses'
import { forcedTeam, type SkinId } from './characterRig'
import { SkeletonArm, type FingerBones } from './skeletonArm'

// Viewmodel arms built from the character model's own two arms (plan 11, C.6): <team>_fparms.glb only has upper arm -> hand,
// but still has the full Mixamo bones, so SkeletonArm (IK + fingers) is reused exactly as in third person. All coordinates are in the viewmodel camera space.
const FILES: Record<SkinId, Record<TeamId, string>> = {
  classic: { A: '/models/characters/cop_fparms.glb', B: '/models/characters/robber_fparms.glb' },
  saber: { A: '/models/characters/saber_ct_fparms.glb', B: '/models/characters/saber_t_fparms.glb' },
}
const DEG = Math.PI / 180

interface Set { obj: THREE.Group; armR: SkeletonArm; armL: SkeletonArm; mats: THREE.Material[]; mid: THREE.Vector3 }

const _v = new THREE.Vector3(), _e = new THREE.Euler()
const _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _he = new THREE.Euler()
const _pole = new THREE.Vector3(), _sh = new THREE.Vector3()

export class FpArms {
  readonly root = new THREE.Group()
  sets = new Map<string, Set>()   // key `${skin}:${team}`
  private team: TeamId = forcedTeam() ?? 'A'
  private skin: SkinId = 'saber'
  private requested = new Set<SkinId>()
  private failed = false

  constructor() {
    this.root.visible = false
    if (import.meta.env?.DEV) (globalThis as { __fpArms?: FpArms }).__fpArms = this   // debug: for check scripts run from the browser
  }

  load(skin: SkinId): void {
    if (this.requested.has(skin)) return
    this.requested.add(skin)
    const loader = new GLTFLoader()
    for (const team of ['A', 'B'] as TeamId[]) {
      loader.loadAsync(FILES[skin][team]).then(gltf => this.add(skin, team, gltf.scene)).catch(err => {
        this.failed = true
        console.warn(`fpArms: failed to load ${FILES[skin][team]}, using blocky arms`, err)
      })
    }
  }

  private add(skin: SkinId, team: TeamId, scene: THREE.Object3D): void {
    const obj = new THREE.Group()
    const model = scene
    model.rotation.y = Math.PI   // the model faces +Z; the viewmodel camera faces −Z
    obj.add(model)
    const mats: THREE.Material[] = []
    model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false
      const old = o.material as THREE.MeshStandardMaterial
      o.material = new THREE.MeshLambertMaterial({ map: old.map, color: old.color })
      mats.push(o.material)
    })
    obj.visible = false
    // Bone measurements (lengths, hand frame, shoulder midpoint) must be taken while root is in its original state: the second team's model may finish loading
    // after place() has already rotated/scaled root for the first team -> wrong measurements -> bloated arms, elbows pointing up (load order varies with the browser cache)
    const keepP = this.root.position.clone(), keepQ = this.root.quaternion.clone(), keepS = this.root.scale.clone()
    this.root.position.set(0, 0, 0); this.root.quaternion.identity(); this.root.scale.set(1, 1, 1)
    this.root.add(obj)
    obj.updateMatrixWorld(true)
    const bone = (n: string) => model.getObjectByName(n) as THREE.Bone
    const fingers = (side: 'Left' | 'Right'): FingerBones => {
      const f = (n: string) => [1, 2, 3].map(i => bone(`mixamorig${side}Hand${n}${i}`))
      return { thumb: f('Thumb'), index: f('Index'), middle: f('Middle'), ring: f('Ring'), pinky: f('Pinky') }
    }
    const armR = new SkeletonArm(bone('mixamorigRightArm'), bone('mixamorigRightForeArm'), bone('mixamorigRightHand'), fingers('Right'), 'R')
    const armL = new SkeletonArm(bone('mixamorigLeftArm'), bone('mixamorigLeftForeArm'), bone('mixamorigLeftHand'), fingers('Left'), 'L')
    const mid = armR.upper.getWorldPosition(new THREE.Vector3()).add(armL.upper.getWorldPosition(_v)).multiplyScalar(0.5)
    this.sets.set(`${skin}:${team}`, { obj, armR, armL, mats, mid })
    this.root.position.copy(keepP); this.root.quaternion.copy(keepQ); this.root.scale.copy(keepS)
    this.root.updateMatrixWorld(true)
  }

  /** Usable once the current team's model has loaded; until then the viewmodel still draws blocky arms. */
  get ready(): boolean { return this.sets.has(this.key) }
  private get key(): string { return `${this.skin}:${this.team}` }
  get hasFailed(): boolean { return this.failed }

  /** Switch the arm skin (per the room's character set) and load it if missing */
  setSkin(skin: SkinId): void {
    if (skin === this.skin && this.requested.has(skin)) return
    this.skin = skin
    this.load(skin)
    for (const [k, s] of this.sets) s.obj.visible = k === this.key && this.root.visible
  }

  setTeam(team: TeamId): void {
    this.team = forcedTeam() ?? team
    for (const [k, s] of this.sets) s.obj.visible = k === this.key && this.root.visible
  }

  setVisible(v: boolean): void {
    this.root.visible = v
    const s = this.sets.get(this.key)
    for (const [k, set] of this.sets) set.obj.visible = v && k === this.key && !!s
  }

  /** Place both arms: the midpoint of the two shoulders sits at armsRootOffset, rotated by armsRootRotDeg, scaled by armsScale. */
  place(): void {
    const s = this.sets.get(this.key)
    if (!s) return
    const f = poses.first
    this.root.scale.setScalar(f.armsScale)
    this.root.quaternion.setFromEuler(_e.set(f.armsRootRotDeg[0] * DEG, f.armsRootRotDeg[1] * DEG, f.armsRootRotDeg[2] * DEG, 'XYZ'))
    // shoulder midpoint in root space (model rotated π about Y), then apply scale + rotation, and shift root back so it matches the offset
    _v.set(-s.mid.x, s.mid.y, -s.mid.z).multiplyScalar(f.armsScale).applyQuaternion(this.root.quaternion)
    this.root.position.set(f.armsRootOffset[0] - _v.x, f.armsRootOffset[1] - _v.y, f.armsRootOffset[2] - _v.z)
    this.root.updateMatrixWorld(true)
  }

  /**
   * Solve IK after the gun has been placed. gunQuat = gun orientation in camera space; targetL null = left arm is not solved
   * (one-handed gun): that arm stays in T-pose, so it is hidden.
   */
  solve(targetR: THREE.Vector3, targetL: THREE.Vector3 | null, gunQuat: THREE.Quaternion, rotDegR?: Vec3, rotDegL?: Vec3): void {
    const s = this.sets.get(this.key)
    if (!s) return
    const f = poses.first
    for (const [arm, target, pole, rot] of [[s.armR, targetR, f.armsPoleR, rotDegR], [s.armL, targetL, f.armsPoleL, rotDegL]] as const) {
      if (!target) continue
      // grenade: each hand can rotate independently relative to the grenade direction (poses: first.grenade.handRotDegR/L)
      const q = rot ? _hq.copy(gunQuat).multiply(_hq2.setFromEuler(_he.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'))) : gunQuat
      arm.resetPose()   // no mixer: reset manually so IK/fingers do not accumulate across frames
      arm.slideToReach(target, f.armsMaxExtension)
      arm.upper.getWorldPosition(_sh)
      _pole.set(pole[0], pole[1], pole[2]).add(_sh)
      arm.solve(target, q, _pole, 1)
      arm.applyGrip(1)
    }
  }

  /** Left hand (so the magazine follows it while reloading) */
  leftHand(): THREE.Object3D | null { return this.sets.get(this.key)?.armL.hand ?? null }

  /** Hide the left arm for one-handed guns (a T-pose bone stretched sideways looks very odd) */
  setLeftVisible(v: boolean): void {
    const s = this.sets.get(this.key)
    if (!s) return
    s.armL.upper.scale.setScalar(v ? 1 : 1e-4)   // shrink the bone -> the left arm mesh collapses to a point
  }
}
