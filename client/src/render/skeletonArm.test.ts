import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { SkeletonArm, type FingerBones } from './skeletonArm'
import { armAdjustDefault, type ArmAdjust } from './poses'

// Fake arm skeleton: shoulder at the origin, arm stretched along +X (T-pose), hand with 5 fingers of 3 joints each
function makeArm(side: 'L' | 'R') {
  const dir = side === 'R' ? 1 : -1
  const root = new THREE.Group()
  const mk = (parent: THREE.Object3D, x: number) => { const b = new THREE.Bone(); b.position.set(x * dir, 0, 0); parent.add(b); return b }
  const upper = mk(root, 0), fore = mk(upper, 0.3), hand = mk(fore, 0.28)
  const chain = (z: number) => { let p: THREE.Object3D = hand; const out: THREE.Bone[] = []
    for (let i = 0; i < 3; i++) { const b = new THREE.Bone(); b.position.set((i === 0 ? 0.09 : 0.03) * dir, 0, z); p.add(b); out.push(b); p = b }
    return out }
  const fingers: FingerBones = { thumb: chain(0.03), index: chain(0.02), middle: chain(0), ring: chain(-0.02), pinky: chain(-0.04) }
  root.updateMatrixWorld(true)
  return { root, arm: new SkeletonArm(upper, fore, hand, fingers, side), upper, fore, hand }
}

describe('SkeletonArm', () => {
  it('measures bone lengths at build time', () => {
    const { arm } = makeArm('R')
    expect(arm.lenA).toBeCloseTo(0.3); expect(arm.lenB).toBeCloseTo(0.28)
  })
  for (const side of ['R', 'L'] as const) {
    it(`${side} arm reaches an in-range point: palm centre matches target`, () => {
      const { root, arm, hand } = makeArm(side)
      const target = new THREE.Vector3(side === 'R' ? 0.25 : -0.25, -0.2, -0.3)
      const pole = new THREE.Vector3(side === 'R' ? 0.35 : -0.35, -0.6, 0.3)
      const r = arm.solve(target, new THREE.Quaternion(), pole, 1)
      root.updateMatrixWorld(true)
      expect(r.reached).toBe(true)
      // wrist = target moved back by palmLen along the finger direction (-Z)
      const wrist = hand.getWorldPosition(new THREE.Vector3())
      expect(wrist.x).toBeCloseTo(target.x, 2); expect(wrist.y).toBeCloseTo(target.y, 2); expect(wrist.z).toBeCloseTo(target.z + arm.palmLen, 2)
    })
    it(`${side} arm: elbow is on the pole side (not bent backwards)`, () => {
      const { root, arm, fore } = makeArm(side)
      const target = new THREE.Vector3(side === 'R' ? 0.1 : -0.1, 0, -0.4)
      arm.solve(target, new THREE.Quaternion(), new THREE.Vector3(side === 'R' ? 0.4 : -0.4, -0.6, 0.3), 1)
      root.updateMatrixWorld(true)
      const elbow = fore.getWorldPosition(new THREE.Vector3())
      expect(elbow.y).toBeLessThan(0)   // pole is below
    })
  }
  it('out of reach: stretches straight toward the target, reached=false', () => {
    const { arm } = makeArm('R')
    expect(arm.solve(new THREE.Vector3(3, 0, -3), new THREE.Quaternion(), new THREE.Vector3(0, -1, 0), 1).reached).toBe(false)
  })
  it('weight 0: changes nothing', () => {
    const { arm, upper } = makeArm('R')
    const q = upper.quaternion.clone()
    arm.solve(new THREE.Vector3(0.2, 0, -0.3), new THREE.Quaternion(), new THREE.Vector3(0.3, -0.6, 0.3), 0)
    expect(upper.quaternion.angleTo(q)).toBe(0)
  })
  it('weight 0.5: rotates half as much as weight 1', () => {
    const a = makeArm('R'), b = makeArm('R')
    const t = new THREE.Vector3(0.2, -0.1, -0.35), pole = new THREE.Vector3(0.35, -0.6, 0.3)
    a.arm.solve(t, new THREE.Quaternion(), pole, 1)
    b.arm.solve(t, new THREE.Quaternion(), pole, 0.5)
    expect(b.upper.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(a.upper.quaternion.angleTo(new THREE.Quaternion()) / 2, 2)
  })
  it('without a mixer: reset + solve + grip repeated over many frames gives identical results (no accumulation)', () => {
    const { root, arm, upper, fore, hand } = makeArm('R')
    const t = new THREE.Vector3(0.2, -0.1, -0.35), pole = new THREE.Vector3(0.35, -0.6, 0.3), gq = new THREE.Quaternion()
    const snap = () => [upper, fore, hand, arm.fingers.middle[0]!, arm.fingers.index[2]!].map(b => b.quaternion.clone())
    const frame = () => { arm.resetPose(); arm.solve(t, gq, pole, 1); arm.applyGrip(1); root.updateMatrixWorld(true) }
    frame(); const first = snap()
    for (let i = 0; i < 50; i++) frame()
    snap().forEach((q, i) => expect(q.angleTo(first[i]!)).toBeLessThan(1e-6))
  })

  // ── per-gun adjustments (poses ArmAdjust) ──
  const T = new THREE.Vector3(0.2, -0.1, -0.35), POLE = new THREE.Vector3(0.35, -0.6, 0.3)
  const world = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3())
  const frame = (m: ReturnType<typeof makeArm>, adj?: ArmAdjust, target = T) => { m.arm.resetPose(); m.arm.solve(target, new THREE.Quaternion(), POLE, 1, adj); m.arm.applyGrip(1, adj); m.root.updateMatrixWorld(true) }
  it('adjustments: all zero = exactly the unadjusted result', () => {
    const a = makeArm('R'), b = makeArm('R')
    frame(a); frame(b, armAdjustDefault())
    for (const k of ['upper', 'fore', 'hand'] as const) expect(a[k].quaternion.angleTo(b[k].quaternion)).toBeLessThan(1e-6)
    expect(a.arm.fingers.index[1]!.quaternion.angleTo(b.arm.fingers.index[1]!.quaternion)).toBeLessThan(1e-6)
  })
  it('palmPos moves the palm (and so the wrist) by that offset', () => {
    const a = makeArm('R'), b = makeArm('R')
    frame(a); frame(b, { ...armAdjustDefault(), palmPos: [0.02, 0.03, -0.01] })
    const d = world(b.hand).sub(world(a.hand))
    expect(d.x).toBeCloseTo(0.02, 3); expect(d.y).toBeCloseTo(0.03, 3); expect(d.z).toBeCloseTo(-0.01, 3)
  })
  it('upper-arm and forearm twist: the elbow and the wrist stay, only the bones roll', () => {
    const a = makeArm('R'), b = makeArm('R')
    frame(a); frame(b, { ...armAdjustDefault(), upperTwistDeg: 30, foreTwistDeg: -20 })
    expect(world(b.fore).distanceTo(world(a.fore))).toBeLessThan(1e-6)
    expect(world(b.hand).distanceTo(world(a.hand))).toBeLessThan(1e-6)
    expect(THREE.MathUtils.radToDeg(b.upper.quaternion.angleTo(a.upper.quaternion))).toBeCloseTo(30, 0)
    // the forearm's local roll = its own twist + the change the upper arm's twist brought: just check it differs, the hand is re-oriented to the gun
    expect(b.fore.quaternion.angleTo(a.fore.quaternion)).toBeGreaterThan(0.1)
    expect(b.hand.getWorldQuaternion(new THREE.Quaternion()).angleTo(a.hand.getWorldQuaternion(new THREE.Quaternion()))).toBeLessThan(1e-6)
  })
  it('wrist: the wrist stays, the fingertips swing about it', () => {
    const a = makeArm('R'), b = makeArm('R')
    frame(a); frame(b, { ...armAdjustDefault(), wristDeg: [0, 0, 40] })   // this fake hand's fingers run along its local x, so a swing is about z (x would only twist)
    expect(world(b.hand).distanceTo(world(a.hand))).toBeLessThan(1e-6)
    expect(world(b.arm.fingers.middle[2]!).distanceTo(world(a.arm.fingers.middle[2]!))).toBeGreaterThan(0.02)
  })
  it('fingers: extra curl adds to the shared grip, a manual finger drops the shared grip, spread turns the knuckle', () => {
    const base = makeArm('R'), extra = makeArm('R'), manual = makeArm('R'), spread = makeArm('R')
    const a = armAdjustDefault()
    frame(base)
    frame(extra, { ...a, fingers: { index: [10, 0, 0] } })
    frame(manual, { ...a, manual: ['index'] })
    frame(spread, { ...a, spread: { index: 15 } })
    const q = (m: ReturnType<typeof makeArm>, i: number) => m.arm.fingers.index[i]!.quaternion
    expect(THREE.MathUtils.radToDeg(q(extra, 0).angleTo(q(base, 0)))).toBeCloseTo(10, 0)
    expect(q(extra, 1).angleTo(q(base, 1))).toBeLessThan(1e-9)
    expect(q(manual, 0).angleTo(new THREE.Quaternion())).toBeLessThan(1e-9)           // no shared curl left: the rest pose
    expect(q(base, 0).angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1)
    expect(base.arm.fingers.middle[0]!.quaternion.angleTo(manual.arm.fingers.middle[0]!.quaternion)).toBeLessThan(1e-9)   // other fingers untouched
    expect(q(spread, 0).angleTo(q(base, 0))).toBeGreaterThan(0.1)
  })
  it('adjustments do not accumulate over frames', () => {
    const m = makeArm('R'), adj: ArmAdjust = { ...armAdjustDefault(), upperTwistDeg: 25, wristDeg: [10, 5, 3], palmPos: [0.01, 0, 0], fingers: { ring: [5, 5, 5] }, spread: { pinky: 8 } }
    frame(m, adj)
    const snap = () => [m.upper, m.fore, m.hand, m.arm.fingers.ring[1]!, m.arm.fingers.pinky[0]!].map(b => b.quaternion.clone())
    const first = snap()
    for (let i = 0; i < 40; i++) frame(m, adj)
    snap().forEach((q, i) => expect(q.angleTo(first[i]!)).toBeLessThan(1e-6))
  })
})
