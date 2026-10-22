import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { TeamId } from '@fps/shared'
import { DEFAULT_ANIM, type CharacterRig } from './characters/types'
import { poses } from './poses'
import { SkeletonArm, FINGER_NAMES, type FingerBones } from './skeletonArm'
import { CLIP_NAMES, SLOTS, clipRate, locoTargets, makeSlotWeights, slotClip, type Slot } from './locomotion'
import { Z_CLIPS, Z_DEATH, ZOMBIE_ATTACK, ZOMBIE_JUMP_HOLD, ZOMBIE_RUN_BLEND, ZOMBIE_RUN_START, fitRate, zombieClipRate, zombieSlotClip, type ZombieAttackKind } from './zombieAnim'

// Skeletal characters (plan 11, C.4): cop.glb / robber.glb share the Mixamo animation set.
// Clips are chosen from the interpolated velocity, the upper body aims by pitch (rotating the spine bones), and the gun lives in `aimPivot`.
// The model faces +Z (glTF standard), so it is rotated by π to make yaw = 0 face −Z as per the project convention.
// Each skeletal character set = one "skin" (same skeleton + animations, different model/texture); a set not listed here uses the blocky character.
export type SkinId = 'classic' | 'saber'
const FILES: Record<SkinId, Record<TeamId, string>> = {
  classic: { A: '/models/characters/cop.glb', B: '/models/characters/robber.glb' },
  saber: { A: '/models/characters/saber_ct.glb', B: '/models/characters/saber_t.glb' },
}
const SKIN_OF_SET: Record<string, SkinId> = { copRobber: 'classic', saberDesert: 'saber' }
export function skinOfSet(setId: string): SkinId | null { return SKIN_OF_SET[setId] ?? null }
const DEG = Math.PI / 180
const TELEPORT_M = 3
// Terrorist (team B) human models have dark camo textures that blend into cops; the material colour multiplies the texture, so >1 brightens it
const TEAM_BRIGHTNESS: Record<TeamId, number> = { A: 1, B: 1.8 }
// Grenade throw (G.6)
export const THROW_CLIPS = ['grenade_throw', 'grenade_toss'] as const
const THROW_FADE_IN_S = 0.08, THROW_FADE_OUT_S = 0.15
const PULL_S = 0.3                   // the left hand touches the pin ring for this many seconds, then lets go
const PULL_RAMP_S = 0.1
const LOWER_BODY = /^mixamorig(Hips|(Left|Right)(UpLeg|Leg|Foot|ToeBase|Toe_End))\./
const IK_FADE_S = 0.15       // IK fade out/in on death/respawn
const CORPSE_HOLD_S = 3      // the corpse lies still for this many seconds, then fades out
const CORPSE_FADE_S = 0.7
const DEATH_SWAP_S = 0.5     // a Kill message (with the headshot flag) arriving within this window after the death snapshot can still change the death type

interface Loaded { scene: THREE.Object3D; clips: Map<string, THREE.AnimationClip>; upper: Map<string, THREE.AnimationClip> }
const loaded = new Map<string, Loaded>()   // key `${skin}:${team}`
const loading = new Set<string>()
let failed = false

/** `?blocky=1` keeps the old blocky character for comparison when debugging */
export function skeletalEnabled(): boolean {
  if (failed) return false
  try { return !new URLSearchParams(location.search).has('blocky') } catch { return true }
}

// Debug: ?charTeam=B builds the Terrorists model for everyone (offline there is only team A) to view/tune the sleeves and fingers of the other model
export function forcedTeam(): TeamId | null {
  try { const t = new URLSearchParams(location.search).get('charTeam'); return t === 'A' || t === 'B' ? t : null } catch { return null }
}

export function requestCharacters(skin: SkinId): void {
  const loader = new GLTFLoader()
  for (const team of ['A', 'B'] as TeamId[]) {
    const key = `${skin}:${team}`, file = FILES[skin][team]
    if (loading.has(key) || loaded.has(key)) continue
    loading.add(key)
    loader.loadAsync(file).then(gltf => {
      const clips = new Map<string, THREE.AnimationClip>()
      for (const c of gltf.animations) clips.set(c.name, c)
      for (const n of CLIP_NAMES) if (!clips.has(n)) console.warn(`characterRig: ${file} is missing clip ${n}`)
      // Throw clips apply to the upper body only (from Spine up, including both arms) so the legs keep running
      const upper = new Map<string, THREE.AnimationClip>()
      for (const n of THROW_CLIPS) { const c = clips.get(n); if (c) upper.set(n, upperBodyClip(c)) }
      loaded.set(key, { scene: gltf.scene, clips, upper })
    }).catch(err => { failed = true; console.warn(`characterRig: failed to load ${file}, using the blocky character`, err) })
  }
}

// ── Zombie models (plan 16, ZF.1): each zombies/*.glb file ships 12 z_* clips. The z_* clips are shared by every model and also by
// infected players (same 65-bone Mixamo skeleton, tracks address bones by name), so they only need to be taken from whichever file finishes loading first.
const loadedZ = new Map<string, Loaded>()   // key = file path
const loadingZ = new Set<string>()
let zombieClips: THREE.AnimationClip[] | null = null
const zombieUpper = new Map<string, THREE.AnimationClip>()   // claw-attack clips, upper body only

export function requestZombieModels(files: string[]): void {
  const loader = new GLTFLoader()
  for (const file of files) {
    if (loadingZ.has(file) || loadedZ.has(file)) continue
    loadingZ.add(file)
    loader.loadAsync(file).then(gltf => {
      const clips = new Map<string, THREE.AnimationClip>()
      for (const c of gltf.animations) clips.set(c.name, c)
      loadedZ.set(file, { scene: gltf.scene, clips, upper: new Map() })
      if (!zombieClips) {
        zombieClips = gltf.animations.filter(c => c.name.startsWith('z_'))
        for (const k of ['light', 'heavy'] as const) { const c = clips.get(ZOMBIE_ATTACK[k].clip); if (c) zombieUpper.set(k, upperBodyClip(c)) }
      }
    }).catch(err => console.warn(`characterRig: failed to load ${file}`, err))
  }
}
export function zombieModelReady(file: string): boolean { return loadedZ.has(file) }
export function zombieClipsReady(): boolean { return zombieClips !== null }

// Debug (vite dev only): window.__skelChars for IK check scripts run from the browser
const debugList: SkelCharacter[] = []
if (import.meta.env?.DEV) (globalThis as { __skelChars?: SkelCharacter[] }).__skelChars = debugList

/** Keep the upper-body tracks: drop Hips (root motion) and both legs */
function upperBodyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter(t => !LOWER_BODY.test(t.name))
  return new THREE.AnimationClip(`${clip.name}_upper`, clip.duration, tracks)
}

let _zcfg: { src: typeof poses.character.anim; cfg: typeof poses.character.anim } | null = null
/** Zombie loco config: switches to z_run earlier than humans (cached, no allocation per frame) */
function zombieLocoCfg(cfg: typeof poses.character.anim): typeof poses.character.anim {
  if (!_zcfg || _zcfg.src !== cfg) _zcfg = { src: cfg, cfg: { ...cfg, runStartSpeed: ZOMBIE_RUN_START, runBlendLen: ZOMBIE_RUN_BLEND } }
  return _zcfg.cfg
}

export function skeletalReady(skin: SkinId, team: TeamId): boolean { return loaded.has(`${skin}:${team}`) }

const _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion()
const _axis = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler()

// Rotate a bone about a world axis (independent of the odd local axes of Mixamo bones)
function rotateAboutWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  _dq.setFromAxisAngle(axis, angle)
  bone.getWorldQuaternion(_wq).premultiply(_dq)
  bone.parent!.getWorldQuaternion(_pq)
  bone.quaternion.copy(_pq.invert().multiply(_wq))
  bone.updateWorldMatrix(false, true)
}

export interface SkelFrame {
  dt: number; x: number; z: number; yaw: number
  grounded: boolean; crouching: boolean; sliding: boolean
  pitch: number
  pistol: boolean   // one-handed gun / knife: uses the pistol_* set
  dead?: boolean    // corpse: only plays the death clip, does not aim by pitch
}

export class SkelCharacter {
  readonly root = new THREE.Group()
  readonly model: THREE.Object3D
  readonly mats: THREE.Material[] = []
  readonly aimPivot = new THREE.Group()   // child of root, at the chest, rotates with pitch (game frame: muzzle −Z)
  readonly holder = new THREE.Group()     // two-handed guns sit here
  readonly gunAnchor = new THREE.Group()  // one-handed gun: child of the right hand bone
  readonly armR: SkeletonArm
  readonly armL: SkeletonArm
  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private readonly target = new Map<string, number>()
  private readonly weight = new Map<string, number>()
  private readonly slotW = makeSlotWeights()
  private readonly spine: THREE.Object3D[]
  private readonly head: THREE.Object3D
  /** Head bone (the zombie eyes follow it) */
  get headBone(): THREE.Object3D { return this.head }
  private readonly chest: THREE.Object3D
  private readonly rightHand: THREE.Bone
  lastTargetR = new THREE.Vector3(); lastTargetL = new THREE.Vector3()
  private lastX = 0; private lastZ = 0; private hasLast = false
  private lastTime = 0
  private speed = 0
  private jumpWasOn = false; private slideWasOn = false
  private skinned: THREE.SkinnedMesh[] = []
  private opaque = true
  ikWeight = 1
  // Grenade throw (seen by others)
  private throwing: { act: THREE.AnimationAction; t: number; dur: number; releaseAt: number } | null = null
  private throwActions = new Map<string, THREE.AnimationAction>()
  pullT = 0                       // > 0: seconds left of the left hand touching the pin ring
  private dead = false
  private deathClip = 'death_1'
  private deathT = 0
  // Zombie: uses z_* clips (see requestZombieModels). Claw/scream are overlay clips (upper body / whole body) like the throw motion.
  private zombie = false
  private zov: { act: THREE.AnimationAction; t: number; dur: number } | null = null
  private zovActions = new Map<string, THREE.AnimationAction>()

  /** `zombieFile`: build from a dedicated zombie model (zombies/*.glb) instead of the team's human model */
  constructor(skin: SkinId, team: TeamId, zombieFile?: string) {
    const modelTeam = forcedTeam() ?? team
    const src = (zombieFile ? loadedZ.get(zombieFile) : loaded.get(`${skin}:${modelTeam}`))!
    const brightness = zombieFile ? 1 : TEAM_BRIGHTNESS[modelTeam]
    this.model = cloneSkinned(src.scene)
    this.model.rotation.y = Math.PI
    this.root.add(this.model)
    this.model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.frustumCulled = false   // the T-pose bbox is wrong while animating
      o.castShadow = false; o.receiveShadow = false
      // Lambert like the rest of the game's blocks (cheaper than Standard, same hemi + sun lighting)
      const old = o.material as THREE.MeshStandardMaterial
      o.material = new THREE.MeshLambertMaterial({ map: old.map, color: old.color.clone().multiplyScalar(brightness) })
      this.mats.push(o.material)
      if (o instanceof THREE.SkinnedMesh) this.skinned.push(o)
    })
    this.root.updateMatrixWorld(true)
    const bone = (n: string) => this.model.getObjectByName(n) as THREE.Bone
    const fingers = (side: 'Left' | 'Right'): FingerBones => {
      const f = (n: string) => [1, 2, 3].map(i => bone(`mixamorig${side}Hand${n}${i}`))
      return { thumb: f('Thumb'), index: f('Index'), middle: f('Middle'), ring: f('Ring'), pinky: f('Pinky') }
    }
    this.armR = new SkeletonArm(bone('mixamorigRightArm'), bone('mixamorigRightForeArm'), bone('mixamorigRightHand'), fingers('Right'), 'R')
    this.armL = new SkeletonArm(bone('mixamorigLeftArm'), bone('mixamorigLeftForeArm'), bone('mixamorigLeftHand'), fingers('Left'), 'L')
    this.rightHand = bone('mixamorigRightHand')
    this.rightHand.add(this.gunAnchor)
    this.spine = poses.character.spinePitchBones.map(n => bone(n))
    this.head = bone('mixamorigHead')
    this.chest = bone(poses.character.aimPivotBone)
    this.aimPivot.add(this.holder)
    this.root.add(this.aimPivot)

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const n of CLIP_NAMES) {
      const clip = src.clips.get(n)
      if (!clip) continue
      const a = this.mixer.clipAction(clip)
      if (n === 'jump' || n === 'slide' || n.startsWith('death_')) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      a.play(); a.setEffectiveWeight(0)
      this.actions.set(n, a); this.weight.set(n, 0); this.target.set(n, 0)
    }
    for (const [n, clip] of src.upper) {
      const a = this.mixer.clipAction(clip)
      a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false
      this.throwActions.set(n, a)
    }
    this.refreshGunAnchor()
    debugList.push(this)
    if (zombieFile) this.setZombie(true)
  }

  // ── Zombie ───────────────────────────────────────────────────────────────────
  get isZombie(): boolean { return this.zombie }
  /** Enable/disable the zombie clip set. Returns false if the z_* clips are not available yet (still loading): call again next frame. */
  setZombie(on: boolean): boolean {
    if (on === this.zombie) return true
    if (!on) {
      this.zombie = false
      this.zov?.act.stop(); this.zov = null
      for (const [n, a] of this.actions) if (n.startsWith('z_')) { a.stop(); this.weight.set(n, 0); this.target.set(n, 0) }
      for (const a of this.zovActions.values()) a.stop()
      return true
    }
    if (!zombieClips) return false
    for (const clip of zombieClips) {
      const had = this.actions.get(clip.name)
      if (had) {   // already existed from a previous zombie turn: setZombie(false) called stop(), so it must be played again, otherwise the skeleton stays in T-pose
        had.play(); had.paused = false; had.setEffectiveWeight(0)
        continue
      }
      const isOnce = clip.name === 'z_jump' || clip.name.startsWith('z_death_')
      const looped = (Z_CLIPS as readonly string[]).includes(clip.name) && clip.name !== 'z_jump'
      if (!isOnce && !looped) {   // z_attack_*, z_scream, z_hit, z_transform: played on events (see playZombie)
        if (clip.name === 'z_scream') {
          const a = this.mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false
          this.zovActions.set('scream', a)
        }
        continue
      }
      const a = this.mixer.clipAction(clip)
      if (isOnce) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      a.play(); a.setEffectiveWeight(0)
      this.actions.set(clip.name, a); this.weight.set(clip.name, 0); this.target.set(clip.name, 0)
    }
    for (const [k, clip] of zombieUpper) {
      if (this.zovActions.has(k)) continue
      const a = this.mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false
      this.zovActions.set(k, a)
    }
    this.zombie = true
    this.cancelThrow()
    for (const n of this.target.keys()) { if (!n.startsWith('z_')) { this.target.set(n, 0); this.weight.set(n, 0); this.actions.get(n)?.setEffectiveWeight(0) } }
    this.weight.set('z_idle', 1); this.actions.get('z_idle')?.setEffectiveWeight(1)
    return true
  }

  /** Claw (upper body) or scream (whole body, `sec` seconds: transformation) */
  playZombie(kind: ZombieAttackKind | 'scream', sec = 0): void {
    if (!this.zombie || this.dead) return
    const act = this.zovActions.get(kind)
    if (!act) return
    this.zov?.act.stop()
    const dur0 = act.getClip().duration
    const w = kind === 'scream' ? { from: 0, to: 1, sec } : ZOMBIE_ATTACK[kind]
    const rate = fitRate(dur0, w.from, w.to, w.sec)
    act.reset(); act.setEffectiveWeight(0); act.play()
    act.time = w.from * dur0; act.timeScale = rate
    this.zov = { act, t: 0, dur: w.sec }
  }

  // ── Animation ────────────────────────────────────────────────────────────────
  /** mixer -> spine/head pitch -> update matrices. Call before placeGun/solve. */
  animate(f: SkelFrame): void {
    const cfg = poses.character.anim
    this.ikWeight = this.dead ? Math.max(0, this.ikWeight - f.dt / IK_FADE_S) : Math.min(1, this.ikWeight + f.dt / IK_FADE_S)
    if (this.dead) { this.animateDead(f.dt); return }
    let vx = 0, vz = 0
    if (this.hasLast && f.dt > 0) {
      vx = f.x - this.lastX; vz = f.z - this.lastZ
      if (Math.hypot(vx, vz) > TELEPORT_M) { vx = 0; vz = 0 }
      vx /= f.dt; vz /= f.dt
    }
    this.lastX = f.x; this.lastZ = f.z; this.hasLast = true
    const spd = Math.hypot(vx, vz)
    this.speed += (spd - this.speed) * Math.min(1, f.dt * 12)
    const k = this.speed > 1e-4 && spd > 1e-4 ? this.speed / spd : 0   // direction from the instantaneous velocity, magnitude smoothed
    locoTargets({ vx: vx * k, vz: vz * k, yaw: f.yaw, grounded: f.grounded, crouching: f.crouching, sliding: f.sliding }, this.zombie ? zombieLocoCfg(cfg) : cfg, this.slotW)

    for (const n of this.target.keys()) this.target.set(n, 0)
    for (const s of SLOTS) {
      const w = this.slotW[s]
      if (w <= 0) continue
      const n = this.zombie ? zombieSlotClip(s) : slotClip(s, f.pistol)
      this.target.set(n, (this.target.get(n) ?? 0) + w)
    }
    const jumpOn = this.slotW.jump > 0.5, slideOn = this.slotW.slide > 0.5
    const jumpName = this.zombie ? 'z_jump' : 'jump'
    if (jumpOn && !this.jumpWasOn) this.restart(jumpName)
    if (slideOn && !this.slideWasOn && !this.zombie) this.restart('slide')
    this.jumpWasOn = jumpOn; this.slideWasOn = slideOn
    const jump = this.actions.get(jumpName)
    const holdS = this.zombie && jump ? jump.getClip().duration * ZOMBIE_JUMP_HOLD : cfg.jumpHoldS
    if (jump && jumpOn && jump.time > holdS) jump.time = holdS   // airborne: hold the middle frame
    const blend = 1 - Math.exp(-f.dt / (cfg.blendTime / 3))
    for (const [n, a] of this.actions) {
      const w = this.weight.get(n)! + (this.target.get(n)! - this.weight.get(n)!) * blend
      this.weight.set(n, w)
      a.setEffectiveWeight(w)
    }
    for (const s of SLOTS) {
      if (this.slotW[s] <= 0) continue
      const zn = zombieSlotClip(s)
      const a = this.actions.get(this.zombie ? zn : slotClip(s, f.pistol))
      if (a) a.timeScale = this.zombie ? zombieClipRate(zn, this.speed) : clipRate(s, this.speed, cfg)
    }
    // Crouch: lower the whole model by an extra crouchDrop when the crouch animation is still taller than the hitbox
    if (this.throwing) {
      const th = this.throwing
      th.t += f.dt
      if (th.t >= th.dur) { th.act.stop(); this.throwing = null }
      else {
        // the upper-body clip only has tracks for upper bones: three blends it as a weighted average with the run clip (total weight 1),
        // so to "override" by a fraction e the weight = e / (1 − e)
        const e = Math.min(0.98, Math.min(1, th.t / THROW_FADE_IN_S), Math.min(1, (th.dur - th.t) / THROW_FADE_OUT_S))
        th.act.setEffectiveWeight(e / (1 - e))
      }
    }
    if (this.zov) {
      const z = this.zov
      z.t += f.dt
      if (z.t >= z.dur) { z.act.stop(); this.zov = null }
      else {   // same override as the throw clip: weight e / (1 − e)
        const e = Math.min(0.98, Math.min(1, z.t / 0.08), Math.min(1, (z.dur - z.t) / 0.12))
        z.act.setEffectiveWeight(e / (1 - e))
      }
    }
    if (this.pullT > 0) this.pullT = Math.max(0, this.pullT - f.dt)
    this.model.position.y = this.zombie ? 0 : -(poses.character.crouchDrop * (this.weight.get('rifle_crouch_idle') ?? 0) + poses.character.crouchWalkDrop * (this.weight.get('rifle_crouch_walk') ?? 0))
    this.mixer.update(f.dt)
    this.root.updateMatrixWorld(true)

    // Aim by pitch: rotate about the character's "right" axis (root +X). The spine splits it evenly, the head takes an extra share.
    const c = poses.character
    const lim = c.spinePitchLimitDeg * DEG
    _axis.set(1, 0, 0).transformDirection(this.root.matrixWorld)
    const spineTotal = Math.max(-lim, Math.min(lim, f.pitch * (1 - c.headPitchShare)))
    for (const b of this.spine) rotateAboutWorld(b, _axis, spineTotal / this.spine.length)
    rotateAboutWorld(this.head, _axis, f.pitch * c.headPitchShare)
    this.root.updateMatrixWorld(true)
    this.pitch = f.pitch
  }
  private pitch = 0

  // ── Death / respawn ───────────────────────────────────────────────────────────
  /** Just died: play the fall clip (death_2 on headshot), IK fades to 0 over IK_FADE_S, the corpse fades out after CORPSE_HOLD_S. */
  die(headshot: boolean): void {
    this.dead = true
    this.deathT = 0
    this.zov?.act.stop(); this.zov = null
    this.deathClip = this.deathName(headshot)
    for (const n of ['death_1', 'death_2', ...Z_DEATH]) this.actions.get(n)?.stop()
    const a = this.actions.get(this.deathClip)
    if (a) { a.reset(); a.play(); a.setEffectiveWeight(this.weight.get(this.deathClip) ?? 0) }
  }

  // ── Grenade throw (others) ────────────────────────────────────────────────
  /** Start pulling the pin: the left hand touches the pin ring for PULL_S seconds (IK applied by players.ts) */
  startPull(): void { this.pullT = PULL_S }
  /** Left-hand IK weight while touching the pin: 0 -> 1 -> 0 */
  get pullWeight(): number {
    if (this.pullT <= 0) return 0
    const t = PULL_S - this.pullT
    return Math.min(1, t / PULL_RAMP_S, this.pullT / PULL_RAMP_S)
  }
  /** Play the throw clip (upper body). A low throw uses grenade_toss if available, otherwise falls back to grenade_throw. */
  playThrow(mode: 'strong' | 'lob'): void {
    const name = mode === 'lob' && this.throwActions.has('grenade_toss') ? 'grenade_toss' : 'grenade_throw'
    const act = this.throwActions.get(name)
    if (!act) return
    if (this.throwing) this.throwing.act.stop()
    const tm = this.throwTiming(act)
    act.reset(); act.setEffectiveWeight(0); act.play()
    act.time = tm.startS; act.timeScale = tm.rate   // skip the long wind-up at the start of the Mixamo clip, play slightly faster
    this.throwing = { act, t: 0, dur: tm.dur, releaseAt: tm.releaseAt }
    this.pullT = 0
  }
  /** Cancel the running throw motion (back to the holding pose) */
  cancelThrow(): void { if (this.throwing) { this.throwing.act.stop(); this.throwing = null } this.pullT = 0 }
  /** Throwing and the release moment has passed: the grenade in the right hand is hidden */
  get throwReleased(): boolean { return !!this.throwing && this.throwing.t >= this.throwing.releaseAt }
  get throwActive(): boolean { return !!this.throwing }
  /** Delay (ms) from receiving the throw message until the grenade leaves the hand in the animation, so the real grenade appears in sync */
  releaseDelayMs(mode: 'strong' | 'lob'): number {
    const name = mode === 'lob' && this.throwActions.has('grenade_toss') ? 'grenade_toss' : 'grenade_throw'
    const a = this.throwActions.get(name)
    return a ? this.throwTiming(a).releaseAt * 1000 : 0
  }
  /** Duration (real seconds) of the throw clip: from throwStartS to the end of the clip, hand releases at releaseS, played at throwRate */
  private throwTiming(act: THREE.AnimationAction): { startS: number; rate: number; dur: number; releaseAt: number } {
    const t = poses.weapons.m67?.third, clip = act.getClip().duration
    const startS = Math.min(t?.throwStartS ?? 0, clip * 0.9), rate = t?.throwRate ?? 1
    const releaseS = Math.min(Math.max(t?.releaseS ?? clip * 0.5, startS), clip)
    return { startS, rate, dur: (clip - startS) / rate, releaseAt: (releaseS - startS) / rate }
  }

  /** A Kill message reporting a headshot arrives slightly after the death snapshot: switch to the correct death type (keeping progress). */
  setDeathVariant(headshot: boolean): void {
    const want = this.deathName(headshot)
    if (!this.dead || this.deathT > DEATH_SWAP_S || want === this.deathClip) return
    const old = this.actions.get(this.deathClip), a = this.actions.get(want)
    if (!a) return
    old?.stop(); this.weight.set(this.deathClip, 0)
    this.deathClip = want
    a.reset(); a.play(); a.time = this.deathT; a.setEffectiveWeight(this.weight.get(want) ?? 0)
  }

  private deathName(headshot: boolean): string {
    return this.zombie ? Z_DEATH[headshot ? 1 : 0] : headshot ? 'death_2' : 'death_1'
  }

  get isDead(): boolean { return this.dead }
  /** Whether the corpse is still drawn (false once fully faded) */
  get corpseVisible(): boolean { return !this.dead || this.deathT < CORPSE_HOLD_S + CORPSE_FADE_S }

  /** Respawn: reset the mixer to idle, IK returns to 1 over IK_FADE_S */
  revive(): void {
    this.dead = false
    for (const n of ['death_1', 'death_2', ...Z_DEATH]) { const a = this.actions.get(n); a?.stop(); this.weight.set(n, 0); this.target.set(n, 0) }
    for (const [n, a] of this.actions) { if (n.includes('death_')) continue; a.play(); a.paused = false; a.setEffectiveWeight(0); this.weight.set(n, 0) }
    const idle = this.zombie ? 'z_idle' : 'rifle_idle'
    this.weight.set(idle, 1); this.actions.get(idle)?.setEffectiveWeight(1)
    this.hasLast = false; this.speed = 0; this.jumpWasOn = false; this.slideWasOn = false
    this.model.position.y = 0
    this.ikWeight = 0
    this.setOpacity(1)
    this.root.visible = true
  }

  private animateDead(dt: number): void {
    this.deathT += dt
    for (const n of this.target.keys()) this.target.set(n, n === this.deathClip ? 1 : 0)
    const blend = 1 - Math.exp(-dt / (poses.character.anim.blendTime / 3))
    for (const [n, a] of this.actions) {
      const w = this.weight.get(n)! + (this.target.get(n)! - this.weight.get(n)!) * blend
      this.weight.set(n, w)
      a.setEffectiveWeight(w)
    }
    this.model.position.y = 0
    this.mixer.update(dt)
    this.root.updateMatrixWorld(true)
    const fade = Math.min(1, Math.max(0, (this.deathT - CORPSE_HOLD_S) / CORPSE_FADE_S))
    this.setOpacity(1 - fade)
    this.root.visible = fade < 1
  }

  private restart(name: string): void {
    const a = this.actions.get(name)
    if (!a) return
    a.reset(); a.play(); a.setEffectiveWeight(this.weight.get(name) ?? 0)
  }

  setOpacity(op: number): void {
    const solid = op >= 1
    for (const m of this.mats) { m.opacity = op; if (m.transparent === solid) { m.transparent = !solid; m.needsUpdate = true } }
    this.opaque = solid
  }

  // ── Gun ─────────────────────────────────────────────────────────────────────
  /** Place aimPivot at the chest, rotated by pitch (root frame). Call after animate(). */
  placeAim(): void {
    this.chest.getWorldPosition(_v)
    this.root.worldToLocal(_v)
    const o = poses.character.aimPivotOffset
    this.aimPivot.position.set(_v.x + o[0], _v.y + o[1], _v.z + o[2])
    this.aimPivot.rotation.set(this.pitch, 0, 0)
    this.aimPivot.updateMatrix()
  }

  /** One-handed gun: attached to the right hand bone, fingers pointing along the gun's −Z, placed at the palm centre */
  refreshGunAnchor(): void {
    this.armR.gunFrameInHand(_q)
    this.armR.palmCenterInHand(this.gunAnchor.position)
    const c = poses.character
    _e.set(c.oneHandGunRotDeg[0] * DEG, c.oneHandGunRotDeg[1] * DEG, c.oneHandGunRotDeg[2] * DEG, 'XYZ')
    this.gunAnchor.quaternion.copy(_q).multiply(_dq.setFromEuler(_e))
    _v.set(c.oneHandGunPos[0], c.oneHandGunPos[1], c.oneHandGunPos[2]).applyQuaternion(_q)
    this.gunAnchor.position.add(_v)
  }

  dispose(): void {
    const i = debugList.indexOf(this); if (i >= 0) debugList.splice(i, 1)
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.model)
    for (const m of this.mats) m.dispose()   // textures are shared with the original, so do not dispose them
    for (const s of this.skinned) s.skeleton.dispose()
  }
}

/** CharacterRig shell for skeletal characters: players.ts shares the root/mats/gunAnchor flow, and the blocky part is an empty Group. */
export function makeSkeletalRig(skin: SkinId, team: TeamId, zombieFile?: string): CharacterRig {
  const sk = new SkelCharacter(skin, team, zombieFile)
  const g = () => new THREE.Group()
  return {
    root: sk.root, legL: g(), legR: g(), upper: g(), headPivot: g(), armL: g(), armR: g(),
    gunAnchor: sk.gunAnchor, headMesh: new THREE.Mesh(), parts: [], mats: sk.mats, team,
    armRestR: 0, armRestL: 0, anim: DEFAULT_ANIM, skel: sk,
  }
}

export { FINGER_NAMES }
export type { Slot }
