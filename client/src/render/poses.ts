import * as THREE from 'three'
import raw from './poses.json'
import { GRENADE_ID, isGrenadeId } from '@fps/shared'

// Hand/gun poses (plan 10). All numbers live in poses.json; this file only defines the types, validates and reads them.
export type Vec3 = [number, number, number]
export type Hold = 'twoHand' | 'oneHand' | 'pistolSupport' | 'grenade'
export type AnchorName = 'hand_r' | 'hand_l' | 'mag' | 'pin_pull'

export interface ArmStyleCfg { upperLen: number; foreLen: number; thickness: number; handSize: number; sleeveToElbow?: boolean }
// First-person grenade (plan 12, G.5). Coordinates in the viewmodel camera space (like first.gunPos); 'to' of the left-hand path:
// 'rest' = leftRest, 'pin_pull' = the pin ring anchor (grenade space), plus an offset in camera space.
export interface GrenadePullKey { t: number; to: 'rest' | 'pin_pull'; offset?: Vec3 }
export interface GrenadeFirst {
  idlePos: Vec3; idleRotDeg: Vec3
  pullLeftHandPath: GrenadePullKey[]
  leftRest: Vec3
  readyPos: { strong: Vec3; lob: Vec3 }; readyRotDeg: { strong: Vec3; lob: Vec3 }
  throwPos: { strong: Vec3; lob: Vec3 }
  windupMs: number; throwMs: number; recoverMs: number
  pinAttachT?: number          // t of the pin-pull path when the pin switches to the left hand (default 0.75)
  handRotDegR?: Vec3; handRotDegL?: Vec3   // extra hand rotation (degrees) relative to the grenade orientation
}
// Per-gun, per-hand adjustment of the skinned arm (SkeletonArm.solve / applyGrip), on top of the shared settings (character.handRot*, first.armsPole*, grip).
// Everything is 0 / empty by default. Edited in the F9 "Arms" tab; read through armsOf().
// It is stored in two parts: the hand <-> gun relation (palm, wrist, fingers: `WeaponPose.hands`) is the same grip in 1st and 3rd person, so it is
// stored once per gun and used by both views; the elbow and the twists depend on where the shoulder is, so they stay per view (`first.arms` / `third.arms`).
export interface ArmAdjust {
  elbow: Vec3                 // metres added to the elbow pole (same space as the shared pole: camera space in 1st person, character space in 3rd): swings the elbow
  upperTwistDeg: number       // roll of the upper arm about its own axis (the elbow stays: only the skin twists)
  foreTwistDeg: number        // roll of the forearm about its own axis (the hand keeps its orientation: the skin twists between elbow and wrist)
  palmPos: Vec3               // metres, gun space (x right, y up, z towards the stock): moves the palm target away from the hand anchor
  palmRotDeg: Vec3            // degrees [pitch, yaw, roll], gun space: turns the hand about the palm on top of character.handRotOffsetDeg
  wristDeg: Vec3              // degrees, hand-bone axes (x = flex, y = twist, z = side deviation), applied after the hand is oriented: the palm and fingers pivot at the wrist
  fingers: Partial<Record<FingerName, Vec3>>   // degrees per joint (knuckle out), added to the shared grip curl (or the whole curl of a manual finger)
  spread: Partial<Record<FingerName, number>>  // degrees, the knuckle swings sideways; positive fans out (a finger away from the thumb side, the thumb away from the fingers)
  manual: FingerName[]        // fingers that ignore the shared grip: only fingers[f] / spread[f] pose them
}
export interface ArmsCfg { R: ArmAdjust; L: ArmAdjust }
export type HandAdjust = Pick<ArmAdjust, 'palmPos' | 'palmRotDeg' | 'wristDeg' | 'fingers' | 'spread' | 'manual'>
export type ArmBodyAdjust = Pick<ArmAdjust, 'elbow' | 'upperTwistDeg' | 'foreTwistDeg'>
export interface HandsCfg { R: HandAdjust; L: HandAdjust }
export interface ArmBodyCfg { R: ArmBodyAdjust; L: ArmBodyAdjust }
export type ArmView = 'first' | 'third'
export interface WeaponPose {
  anchors: Partial<Record<AnchorName, Vec3>>
  hands?: HandsCfg   // palm / wrist / fingers on this gun, shared by the 1st and 3rd person views
  third: { hold: Hold; gunPos: Vec3; gunRotDeg: Vec3; adsGunPos?: Vec3; adsGunRotDeg?: Vec3; throwStartS?: number; releaseS?: number; throwRate?: number; arms?: ArmBodyCfg }   // last 3 fields: throw clip (seconds into the clip at start / at release, playback rate)
  first: { hold: Hold; gunPos?: Vec3; gunRotDeg: Vec3; scale: number; adsEyeDist?: number; adsRotDeg?: Vec3; grenade?: GrenadeFirst; arms?: ArmBodyCfg }   // adsEyeDist: the front sight is this many metres from the eye when aiming; adsRotDeg: extra rotation at full aim
}
export interface ReloadKey { t: number; to: 'hand_l' | 'mag'; offset?: Vec3 }
export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
export interface CharacterCfg {
  crouchDrop: number; crouchWalkDrop: number; aimPivotBone: string; spinePitchBones: string[]; spinePitchLimitDeg: number; headPitchShare: number
  aimPivotOffset: Vec3; poleR: Vec3; poleL: Vec3
  handRotOffsetDegR: Vec3; handRotOffsetDegL: Vec3
  palmCenterFrac: number          // palm centre = this fraction of the wrist-to-middle-knuckle span
  oneHandGunPos: Vec3; oneHandGunRotDeg: Vec3   // one-handed gun in the "standard hand" space (fingers point -Z, thumb +Y)
  anim: {
    blendTime: number; idleSpeed: number; walkRefSpeed: number; runStartSpeed: number; runBlendLen: number
    runRefSpeed: number; crouchRefSpeed: number; maxRate: number; jumpHoldS: number
  }
}
export interface GripCfg { R: Record<FingerName, Vec3>; L: Record<FingerName, Vec3>; axis: 'x' | 'y' | 'z' }
export interface Poses {
  style: { skinColor: string; sleeveColor: { A: string; B: string }; third: ArmStyleCfg; first: ArmStyleCfg }
  third: { shoulderR: Vec3; shoulderL: Vec3; aimPivot: Vec3; poleR: Vec3; poleL: Vec3 }
  first: { fov: number; shoulderR: Vec3; shoulderL: Vec3; poleR: Vec3; poleL: Vec3; armsRootOffset: Vec3; armsRootRotDeg: Vec3; armsScale: number; armsMaxExtension: number; armsPoleR: Vec3; armsPoleL: Vec3 }
  character: CharacterCfg
  grip: GripCfg
  grenade: { trajectory: boolean; trajectoryMaxS: number; dotEveryS: number }
  weapons: Record<string, WeaponPose>
  reloadLeftHand: {
    keys: ReloadKey[]; magDetachT: number; magAttachT: number
    gunTiltDeg: { roll: number; pitch: number; inT: number; outT: number }
  }
}

// Order = weapon ids in shared (WEAPONS)
export const WEAPON_KEYS = ['ak47', 'm16', 'colt', 'rulo', 'sniper', 'shotgun', 'knife', 'smg', 'm67'] as const

const DEFAULTS = {
  style: {
    skinColor: '#e0a77a', sleeveColor: { A: '#2f6fd6', B: '#2b2b2b' },
    third: { upperLen: 0.34, foreLen: 0.36, thickness: 0.11, handSize: 0.12 },
    first: { upperLen: 0.45, foreLen: 0.47, thickness: 0.075, handSize: 0.085, sleeveToElbow: true },
  },
  third: { shoulderR: [0.25, 1.4, 0], shoulderL: [-0.25, 1.4, 0], aimPivot: [0, 1.35, 0], poleR: [0.35, -0.55, 0.25], poleL: [-0.35, -0.55, 0.05] },
  first: { fov: 54, shoulderR: [0.22, -0.3, 0.12], shoulderL: [-0.2, -0.3, 0.1], poleR: [0.45, -0.5, 0.2], poleL: [-0.45, -0.5, 0.1], armsRootOffset: [0, -0.3, 0], armsRootRotDeg: [0, 0, 0], armsScale: 1, armsMaxExtension: 0.92, armsPoleR: [0.4, -0.5, 0.3], armsPoleL: [-0.4, -0.5, 0.3] },
  character: {
    crouchDrop: 0, crouchWalkDrop: 0.25, aimPivotBone: 'mixamorigSpine2', spinePitchBones: ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2'],
    spinePitchLimitDeg: 60, headPitchShare: 0.3, aimPivotOffset: [0, 0.08, 0], poleR: [0.35, -0.6, 0.3], poleL: [-0.35, -0.6, 0.1],
    handRotOffsetDegR: [0, 0, 0], handRotOffsetDegL: [0, 0, 0], palmCenterFrac: 0.6,
    oneHandGunPos: [0, 0, 0], oneHandGunRotDeg: [0, 0, 0],
    anim: { blendTime: 0.15, idleSpeed: 0.3, walkRefSpeed: 1.6, runStartSpeed: 5, runBlendLen: 2, runRefSpeed: 5, crouchRefSpeed: 1, maxRate: 2, jumpHoldS: 0.35 },
  },
  grip: {
    R: { thumb: [10, 20, 15], index: [15, 20, 10], middle: [55, 70, 40], ring: [60, 75, 45], pinky: [65, 75, 45] },
    L: { thumb: [15, 25, 20], index: [45, 55, 35], middle: [55, 65, 40], ring: [60, 70, 45], pinky: [65, 70, 45] },
    axis: 'x',
  },
  grenade: { trajectory: true, trajectoryMaxS: 2, dotEveryS: 0.06 },   // predicted flight path while holding ready
  reloadLeftHand: { keys: [], magDetachT: 0.12, magAttachT: 0.55, gunTiltDeg: { roll: 0, pitch: 0, inT: 0.1, outT: 0.85 } },
}
const WEAPON_DEFAULT: WeaponPose = {
  anchors: {},
  third: { hold: 'oneHand', gunPos: [0.12, -0.05, -0.25], gunRotDeg: [0, 0, 0] },
  first: { hold: 'oneHand', gunRotDeg: [0, 0, 0], scale: 1 },
}

const warned = new Set<string>()
function warnOnce(msg: string): void {
  if (warned.has(msg)) return
  warned.add(msg)
  console.warn(`poses.json: ${msg}`)
}

// Merge `src` onto a copy of `def`: missing field -> default (+ one-time warning); `_doc` is ignored; arrays are taken whole
function merge(def: unknown, src: unknown, path: string): unknown {
  if (Array.isArray(def)) {
    if (Array.isArray(src) && (def.length === 0 || src.length === def.length)) return src.slice()
    if (src !== undefined) warnOnce(`${path} has the wrong shape, using default`)
    else warnOnce(`missing ${path}, using default`)
    return def.slice()
  }
  if (def && typeof def === 'object') {
    const out: Record<string, unknown> = {}
    const s = (src && typeof src === 'object' ? src : {}) as Record<string, unknown>
    if (src === undefined) warnOnce(`missing ${path}, using default`)
    for (const k of Object.keys(def)) out[k] = merge((def as Record<string, unknown>)[k], s[k], `${path}.${k}`)
    // Extra keys beyond the defaults (e.g. sleeveToElbow, offset) are kept as they are
    for (const k of Object.keys(s)) if (k !== '_doc' && !(k in out)) out[k] = s[k]
    return out
  }
  if (src === undefined) { warnOnce(`missing ${path}, using default`); return def }
  return typeof src === typeof def ? src : def
}

export function loadPoses(json: unknown): Poses {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const p = merge(DEFAULTS, j, 'poses') as Poses & { weapons?: unknown }
  const w = (j.weapons && typeof j.weapons === 'object' ? j.weapons : {}) as Record<string, unknown>
  const weapons: Record<string, WeaponPose> = {}
  for (const key of WEAPON_KEYS) {
    const src = w[key]
    if (src === undefined) warnOnce(`missing weapons.${key}, holding one-handed`)
    // One-handed guns do not use the 3rd-person gunPos/gunRotDeg: no missing-field warning
    const one = (src as { third?: { hold?: string } } | undefined)?.third?.hold === 'oneHand'
    const srcFilled = one ? { ...(src as object), third: { gunPos: WEAPON_DEFAULT.third.gunPos, gunRotDeg: WEAPON_DEFAULT.third.gunRotDeg, ...(src as { third: object }).third } } : src
    const wp = merge(WEAPON_DEFAULT, srcFilled, `weapons.${key}`) as WeaponPose
    const sw = (src && typeof src === 'object' ? src as Record<string, any> : {})
    wp.anchors = { ...(sw.anchors ?? {}) }
    if (sw.first?.gunPos) wp.first.gunPos = sw.first.gunPos
    // own copies of the arm adjustments: the editor edits them in place, "Reset to file" must still see the file
    if (sw.hands) wp.hands = structuredClone(sw.hands) as HandsCfg
    if (sw.first?.arms) wp.first.arms = structuredClone(sw.first.arms) as ArmBodyCfg
    if (sw.third?.arms) wp.third.arms = structuredClone(sw.third.arms) as ArmBodyCfg
    weapons[key] = wp
  }
  p.weapons = weapons
  return p
}

// The live copy: edited in place (F9 edits it directly, hot-reload overwrites it) then listeners are notified
let fileJson: unknown = raw
export const poses: Poses = loadPoses(raw)
const listeners = new Set<() => void>()
// Debug (vite dev): scripts run from the browser edit the running `poses` copy (a dynamic import may yield a different module instance)
if (import.meta.env?.DEV) Object.assign(globalThis, { __poses: poses, __notifyPoses: () => notifyPosesChanged() })
export function onPosesChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }
export function notifyPosesChanged(): void { for (const fn of listeners) fn() }
// Called after the whole `poses` content was swapped (file hot-reload, "Reset to file"): the F9 panel holds the old objects and must be drawn again
const replacedListeners = new Set<() => void>()
export function onPosesReplaced(fn: () => void): () => void { replacedListeners.add(fn); return () => { replacedListeners.delete(fn) } }
export function replacePoses(json: unknown): void {
  fileJson = json
  const next = loadPoses(json)
  for (const k of Object.keys(next) as (keyof Poses)[]) (poses as any)[k] = next[k]
  notifyPosesChanged()
  for (const fn of replacedListeners) fn()
}
/** Every grenade type (HE, smoke) shares the M67 model + pose */
export function canonWeaponId(id: number): number { return isGrenadeId(id) ? GRENADE_ID : id }
export function weaponPose(id: number): WeaponPose { return poses.weapons[WEAPON_KEYS[canonWeaponId(id)] ?? 'ak47']! }
export const armBodyDefault = (): ArmBodyAdjust => ({ elbow: [0, 0, 0], upperTwistDeg: 0, foreTwistDeg: 0 })
export const handAdjustDefault = (): HandAdjust => ({ palmPos: [0, 0, 0], palmRotDeg: [0, 0, 0], wristDeg: [0, 0, 0], fingers: {}, spread: {}, manual: [] })
export const armAdjustDefault = (): ArmAdjust => ({ ...armBodyDefault(), ...handAdjustDefault() })
const complete = new WeakSet<object>()   // already completed with defaults: armsOf runs every frame and must not allocate
function completed<T extends { R: object; L: object }>(cfg: T, def: () => object): T {
  if (complete.has(cfg)) return cfg
  for (const side of ['R', 'L'] as const) {
    const d = def(), cur = ((cfg as Record<string, object>)[side] ??= d) as Record<string, unknown>
    for (const k of Object.keys(d)) if (cur[k] === undefined) cur[k] = (d as Record<string, unknown>)[k]
  }
  complete.add(cfg)
  return cfg
}
/** The gun's hand tuning (palm, wrist, fingers), shared by both views; created / completed with zeros in place (the editor edits it and "Copy this gun" exports it). */
export function handsOf(id: number): HandsCfg {
  const w = weaponPose(id)
  return completed(w.hands ??= { R: handAdjustDefault(), L: handAdjustDefault() }, handAdjustDefault)
}
/** The gun's elbow / twist tuning for one view, created / completed with zeros in place. */
export function armBodyOf(id: number, view: ArmView): ArmBodyCfg {
  const w = weaponPose(id)[view]
  return completed(w.arms ??= { R: armBodyDefault(), L: armBodyDefault() }, armBodyDefault)
}
const effective = new WeakMap<object, ArmsCfg>()
/** What SkeletonArm reads: the per-view elbow / twists and the shared hand tuning of this gun, as one ArmAdjust per hand. The same object every call
 * (re-pointed at the current stored values, since the editor may replace them), so nothing is allocated per frame. */
export function armsOf(id: number, view: ArmView): ArmsCfg {
  const body = armBodyOf(id, view), hands = handsOf(id)
  const key = weaponPose(id)[view]
  let e = effective.get(key)
  if (!e) { e = { R: armAdjustDefault(), L: armAdjustDefault() }; effective.set(key, e) }
  for (const side of ['R', 'L'] as const) {
    const o = e[side], b = body[side], h = hands[side]
    o.elbow = b.elbow; o.upperTwistDeg = b.upperTwistDeg; o.foreTwistDeg = b.foreTwistDeg
    o.palmPos = h.palmPos; o.palmRotDeg = h.palmRotDeg; o.wristDeg = h.wristDeg; o.fingers = h.fingers; o.spread = h.spread; o.manual = h.manual
  }
  return e
}

if (import.meta.hot) {
  import.meta.hot.accept('./poses.json', mod => { if (mod) replacePoses((mod as unknown as { default: unknown }).default) })
}

// ── Anchors ───────────────────────────────────────────────────────────────────
// Prefer the anchor in poses.json; otherwise the Empty with the same name in the glb (if any); finally the origin (0,0,0).
const glbAnchors = new Map<number, Map<AnchorName, THREE.Vector3>>()
const ANCHOR_NAMES: AnchorName[] = ['hand_r', 'hand_l', 'mag', 'pin_pull']

/** Call once when the gun model has loaded (after adjustModel). Coordinates are in the model's parent space. */
export function scanModelAnchors(id: number, model: THREE.Object3D): void {
  model.updateMatrixWorld(true)
  const m = new Map<AnchorName, THREE.Vector3>()
  for (const n of ANCHOR_NAMES) {
    const o = model.getObjectByName(n)
    if (o) m.set(n, o.getWorldPosition(new THREE.Vector3()))
  }
  glbAnchors.set(id, m)
}

export function getAnchor(id: number, name: AnchorName, out: THREE.Vector3): THREE.Vector3 {
  const j = weaponPose(id).anchors[name]
  if (j) return out.set(j[0], j[1], j[2])
  const g = glbAnchors.get(canonWeaponId(id))?.get(name)
  if (g) return out.copy(g)
  return out.set(0, 0, 0)
}

export function hasAnchor(id: number, name: AnchorName): boolean {
  return !!weaponPose(id).anchors[name] || !!glbAnchors.get(canonWeaponId(id))?.has(name)
}

export function colorOf(hex: string): number { return parseInt(hex.replace('#', ''), 16) }

/** All current poses as JSON exactly like the file (to paste back into poses.json) */
export function exportPoses(): unknown {
  const doc = (fileJson as { _doc?: string } | null)?._doc
  return { ...(doc ? { _doc: doc } : {}), ...poses }
}
export function exportWeapon(id: number): unknown { return weaponPose(id) }
export function resetPosesToFile(): void { replacePoses(fileJson) }
