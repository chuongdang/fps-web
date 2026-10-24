import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { defaultMovement, DEFENSE, ECONOMY, INFECTION, NetFlag, TEAMS, WEAPONS, ZOMBIE_LOOK, ZOMBIE_TYPES, zombieVariation, type TeamId } from '@fps/shared'
import { makeBlobShadow } from './blobShadow'
import { MUZZLE_FALLBACK, makeFlashTexture, adjustModel } from './viewmodel'
import { BlockArm } from './blockArm'
import { poses, weaponPose, armsOf, getAnchor, scanModelAnchors, colorOf, type Vec3, type WeaponPose } from './poses'
import { getCharacterSet, disposeRig, type CharacterRig } from './characters'
import { makeSkeletalRig, requestCharacters, requestZombieModels, skeletalEnabled, skeletalReady, skinOfSet, zombieModelReady } from './characterRig'
import { GRENADE_ID, SMOKE_ID, isGrenadeId } from '@fps/shared'
import { tintSmoke } from './nadeTint'
import { makeAnimState, updateAnim, HEAD_PITCH, type AnimState } from './characters/animate'
import { createDeathFx } from './characters/deathFx'
import { makeZombieFx, removeZombieFx, updateZombieFx, type ZombieFx } from './zombieLook'

// The minimum needed to draw; both NetPlayer and InterpPlayer satisfy it
interface RenderPlayer { id: number; pos: [number, number, number]; yaw: number; pitch?: number; flags: number; weapon?: number; killStreak?: number; adsT?: number; ztype?: string; zscale?: number }

export interface TeamInfo {
  teamOf(id: number): TeamId | undefined
  nameOf(id: number): string | undefined
  myTeam(): TeamId | undefined
  characterSet?(): string   // the room's character set (default if missing)
  /** Team used to pick the model (zombie: an infected player keeps their own model even after switching to the zombie side) */
  modelTeam?(id: number, flags: number): TeamId | undefined
  /** Viewer eye position (to switch off distant zombie eyes) */
  viewer?(): [number, number, number]
  /** Infection / Defense rooms: preload the zombie models */
  zombieMode?(): boolean
}

const FLASH_MS = 60
const WANTED_STREAK = ECONOMY.bountyStreak   // from this killStreak on: a wanted mark over the head
const WEAPON_FILES = ['/models/ak47.glb', '/models/m16.glb', '/models/colt.glb', '/models/rouleau.glb', '/models/sniper.glb', '/models/shotgun.glb', '/models/knife_1.glb', '/models/submachine.glb', '/models/grenades/m67.glb']

// Guns held by other players: loaded once per type, cloned per player (geometry/material shared)
const gunModels = new Map<number, THREE.Object3D>()
let gunsRequested = false
function requestGuns(): void {
  if (gunsRequested) return
  gunsRequested = true
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  WEAPON_FILES.forEach((file, id) => {
    loader.loadAsync(file).then(gltf => {
      gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false } })
      adjustModel(id, gltf.scene)
      scanModelAnchors(id, gltf.scene)
      gunModels.set(id, gltf.scene)
    }).catch(err => console.warn(`players: cannot load ${file}`, err))
  })
}

// Teammate name tag: a canvas sprite created once per player
function makeNameSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 64
  const g = c.getContext('2d')!
  g.font = 'bold 34px monospace'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 128, 32)
  g.fillStyle = color; g.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(c)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sp.scale.set(1.6, 0.4, 1)
  sp.renderOrder = 10
  return sp
}

// Wanted mark: a yellow star with a red outline, one shared texture
let wantedTex: THREE.CanvasTexture | null = null
function makeWantedSprite(): THREE.Sprite {
  if (!wantedTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 29 : 12, a = -Math.PI / 2 + i * Math.PI / 5
      g.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r)
    }
    g.closePath()
    g.fillStyle = '#ffd23c'; g.fill()
    g.lineWidth = 4; g.strokeStyle = '#d02020'; g.stroke()
    wantedTex = new THREE.CanvasTexture(c)
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: wantedTex, depthTest: false, transparent: true }))
  sp.scale.set(0.5, 0.5, 1)
  sp.renderOrder = 11
  return sp
}

// Each player = one rig built from the room's character set (render/characters) + gun + muzzle flash + animation.
// Two-handed gun (poses.json third.hold = twoHand): the gun is attached to `holder` (child of `aimPivot`, rotates with pitch),
// two BlockArms follow two anchor points on the gun via IK. One-handed gun: as before (gun in the rig's right hand).
interface Actor {
  rig: CharacterRig
  anim: AnimState
  gun: THREE.Object3D | null
  gunId: number
  flash: THREE.Sprite
  flashUntil: number
  wasDead: boolean
  aimPivot: THREE.Group
  holder: THREE.Group
  armR: BlockArm | null   // null for skinned characters (IK lives in rig.skel)
  armL: BlockArm | null
  twoHand: boolean | null   // null = mode not chosen yet
  drop: GunDrop | null      // gun dropped from the corpse's hand (skinned character)
  pulling: boolean          // pulling the pin (other players): once the left-hand motion ends the pin leaves the grenade
  pinOff: boolean           // pin already pulled: hide the `pin` node on the grenade in hand
  thrown: boolean           // just threw: after the throw animation ends, a new grenade (if any) reappears in the hand
  zfx: ZombieFx | null      // currently a zombie: tint + red eyes
  deadAt: number            // zombie died: performance.now() timestamp (the corpse sinks into the ground after CORPSE_MS)
  zfile: string             // built from a dedicated zombie model (glb file); '' = human model
}

// Gun dropped by a dead player: falls straight down + spins, lies on the floor, fades with the corpse
const DROP_GRAVITY = 9.8
const DROP_SETTLE_S = 0.2
const DROP_HOLD_S = 3
const DROP_FADE_S = 0.7
const KILL_MEMORY_MS = 3000   // a Kill message arriving this long before the death snapshot is still used to choose the death style
interface GunDrop {
  obj: THREE.Object3D; mats: THREE.Material[]
  vy: number; wx: number; wz: number; floorY: number
  landed: boolean; settleT: number; age: number
  from: THREE.Quaternion; to: THREE.Quaternion
}

// Defense zombies: tint per type (colour tells the type), size per type; Infection: fixed grey-green tint, the mother is slightly bigger
function zombieOpts(ztype?: string): { fromHuman?: boolean; tintOverride?: string | null; modelOverride?: string | null } {
  const def = ztype ? ZOMBIE_TYPES[ztype] : undefined
  if (def) return { tintOverride: def.tintOverride, modelOverride: def.modelOverride }
  return ztype === 'mother' ? { fromHuman: true, modelOverride: ZOMBIE_LOOK.motherModel ?? null } : { fromHuman: true }   // mother: dedicated model (bighand)
}
function zombieSize(ztype?: string, zscale?: number): number {
  if (zscale) return zscale
  return ztype === 'mother' ? 1.12 : 1
}

const HIP_Y = 0.8   // matches kit.ts: `upper` has its origin at the hip
const _m = new THREE.Matrix4()
const _eul = new THREE.Euler()
const _anchor = new THREE.Vector3()
const _shoulder = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _handTarget = new THREE.Vector3()
const DEG = Math.PI / 180

function makeActor(rig: CharacterRig, dead: boolean): Actor {
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeFlashTexture(), transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  }))
  flash.scale.set(0.3, 0.3, 1)
  flash.renderOrder = 10
  flash.visible = false
  rig.gunAnchor.add(flash)
  rig.root.add(makeBlobShadow())
  if (rig.skel) {
    return { rig, anim: makeAnimState(), gun: null, gunId: -1, flash, flashUntil: 0, wasDead: dead, aimPivot: rig.skel.aimPivot, holder: rig.skel.holder, armR: null, armL: null, twoHand: null, drop: null, pulling: false, pinOff: false, thrown: false, zfx: null, deadAt: 0, zfile: '' }
  }
  const aimPivot = new THREE.Group()
  const holder = new THREE.Group()
  aimPivot.add(holder)
  rig.upper.add(aimPivot)
  const sleeve = colorOf(poses.style.sleeveColor[rig.team])
  const skin = colorOf(poses.style.skinColor)
  const armR = new BlockArm(() => poses.style.third, sleeve, skin)
  const armL = new BlockArm(() => poses.style.third, sleeve, skin)
  armR.setVisible(false); armL.setVisible(false)
  rig.upper.add(armR.root, armL.root)
  for (const arm of [armR, armL]) rig.mats.push(...arm.mats)
  return { rig, anim: makeAnimState(), gun: null, gunId: -1, flash, flashUntil: 0, wasDead: dead, aimPivot, holder, armR, armL, twoHand: null, drop: null, pulling: false, pinOff: false, thrown: false, zfx: null, deadAt: 0, zfile: '' }
}

function disposeActor(a: Actor, scene?: THREE.Scene): void {
  if (a.zfx && scene) { removeZombieFx(scene, a.zfx, a.rig); a.zfx = null }
  if (a.drop) { a.drop.obj.removeFromParent(); for (const m of a.drop.mats) m.dispose(); a.drop = null }
  if (a.rig.skel) a.rig.skel.dispose(); else disposeRig(a.rig)
  a.armR?.dispose(); a.armL?.dispose()
  a.flash.material.map?.dispose()
  a.flash.material.dispose()
}

// Switch between the old block arm (one-handed gun) and the two BlockArms (two-handed gun) within the frame the gun changes
function setHold(a: Actor, two: boolean): void {
  if (a.twoHand === two) return
  a.twoHand = two
  const { rig } = a
  if (rig.skel) {
    const parent = two ? a.holder : rig.gunAnchor
    if (a.gun) parent.add(a.gun)
    parent.add(a.flash)
    return
  }
  rig.armR.visible = rig.armL.visible = !two
  const swap = (from: THREE.Mesh[], to: THREE.Mesh[]) => {
    for (const m of from) { const i = rig.parts.indexOf(m); if (i >= 0) rig.parts.splice(i, 1) }
    for (const m of to) if (!rig.parts.includes(m)) rig.parts.push(m)
  }
  const old: THREE.Mesh[] = []
  for (const g of [rig.armL, rig.armR]) g.traverse(o => { if (o instanceof THREE.Mesh) old.push(o) })
  const blocks = [...a.armR!.meshes, ...a.armL!.meshes]
  if (two) swap(old, blocks); else swap(blocks, old)
  if (!two) { a.armR!.setVisible(false); a.armL!.setVisible(false) }
  const parent = two ? a.holder : rig.gunAnchor
  if (a.gun) parent.add(a.gun)
  parent.add(a.flash)
}

// Gun in the holder: normal pose, or (while that player aims) gradually slides to adsGunPos/adsGunRotDeg: raised, close to the cheek.
// if poses.json has no adsGunPos, ADS_THIRD_SHIFT is added to the normal pose
const ADS_THIRD_SHIFT: Vec3 = [-0.06, 0.1, 0.03]
function placeHolder(a: Actor, weapon: number, wp: WeaponPose['third'], adsT: number): void {
  const k = WEAPONS[weapon]?.ads ? smoothstep01((adsT - 0.3) / 0.4) : 0
  const gp = wp.adsGunPos ?? null, gr = wp.adsGunRotDeg ?? wp.gunRotDeg
  const px = gp ? gp[0] : wp.gunPos[0] + ADS_THIRD_SHIFT[0], py = gp ? gp[1] : wp.gunPos[1] + ADS_THIRD_SHIFT[1], pz = gp ? gp[2] : wp.gunPos[2] + ADS_THIRD_SHIFT[2]
  a.holder.position.set(wp.gunPos[0] + (px - wp.gunPos[0]) * k, wp.gunPos[1] + (py - wp.gunPos[1]) * k, wp.gunPos[2] + (pz - wp.gunPos[2]) * k)
  a.holder.rotation.copy(_eul.set(
    (wp.gunRotDeg[0] + (gr[0] - wp.gunRotDeg[0]) * k) * DEG, (wp.gunRotDeg[1] + (gr[1] - wp.gunRotDeg[1]) * k) * DEG, (wp.gunRotDeg[2] + (gr[2] - wp.gunRotDeg[2]) * k) * DEG, 'XYZ'))
}
function smoothstep01(x: number): number { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t) }

// Place the gun in the holder per poses.json, then solve IK for both hands onto the two anchor points. All coordinates are in `rig.upper` space.
function solveArms(a: Actor, weapon: number, pitch: number, adsT: number): void {
  const t = poses.third, wp = weaponPose(weapon).third
  a.aimPivot.position.set(t.aimPivot[0], t.aimPivot[1] - HIP_Y, t.aimPivot[2])
  a.aimPivot.rotation.x = pitch * HEAD_PITCH
  placeHolder(a, weapon, wp, adsT)
  a.aimPivot.updateMatrix(); a.holder.updateMatrix()
  _m.multiplyMatrices(a.aimPivot.matrix, a.holder.matrix)
  const arm = (side: 'R' | 'L') => {
    const sh = side === 'R' ? t.shoulderR : t.shoulderL, pl = side === 'R' ? t.poleR : t.poleL
    _shoulder.set(sh[0], sh[1] - HIP_Y, sh[2])
    _pole.set(sh[0] + pl[0], sh[1] - HIP_Y + pl[1], sh[2] + pl[2])
    getAnchor(weapon, side === 'R' ? 'hand_r' : 'hand_l', _anchor)
    _handTarget.copy(_anchor).applyMatrix4(_m)
    ;(side === 'R' ? a.armR! : a.armL!).solve(_shoulder, _handTarget, _pole)
  }
  arm('R'); arm('L')
}

const _gq = new THREE.Quaternion()
const _rq = new THREE.Quaternion()
const _sh = new THREE.Vector3()
// Skinned character: place the gun in the holder, IK both real hands onto the two anchor points, curl the fingers. All coordinates are in world space.
function solveSkelArms(a: Actor, weapon: number, adsT: number): void {
  const sk = a.rig.skel!, wp = weaponPose(weapon).third, c = poses.character
  placeHolder(a, weapon, wp, adsT)
  a.holder.updateWorldMatrix(true, false)
  a.holder.getWorldQuaternion(_gq)
  sk.root.getWorldQuaternion(_rq)
  for (const side of ['R', 'L'] as const) {
    const arm = side === 'R' ? sk.armR : sk.armL
    getAnchor(weapon, side === 'R' ? 'hand_r' : 'hand_l', _anchor)
    _handTarget.copy(_anchor).applyMatrix4(a.holder.matrixWorld)
    arm.upper.getWorldPosition(_sh)
    const pl = side === 'R' ? c.poleR : c.poleL, adj = armsOf(weapon, 'third')[side]
    _pole.set(pl[0] + adj.elbow[0], pl[1] + adj.elbow[1], pl[2] + adj.elbow[2]).applyQuaternion(_rq).add(_sh)
    ;(side === 'R' ? sk.lastTargetR : sk.lastTargetL).copy(_handTarget)
    arm.solve(_handTarget, _gq, _pole, sk.ikWeight, adj)
    arm.applyGrip(sk.ikWeight, adj)
  }
}

// Holding a grenade (other players): the left hand touches the pin ring when pulling the pin, the pin then leaves the grenade, and the grenade in hand stays hidden until the throw is done.
function nadeHand(a: Actor): void {
  const sk = a.rig.skel!, gun = a.gun!
  if (a.pulling && sk.pullT <= 0) { a.pinOff = true; a.pulling = false }
  if (a.thrown && !sk.throwActive) { a.thrown = false; a.pinOff = false }   // throw done: a new grenade (if any) is in the hand, the pin is back in place
  gun.visible = !sk.throwReleased
  const pin = gun.getObjectByName('pin')
  if (pin) pin.visible = !a.pinOff
  const w = sk.pullWeight
  if (w <= 0) return
  gun.updateWorldMatrix(true, true)
  getAnchor(GRENADE_ID, 'pin_pull', _anchor)
  _handTarget.copy(_anchor).applyMatrix4(gun.matrixWorld)
  gun.getWorldQuaternion(_gq)
  sk.root.getWorldQuaternion(_rq)
  sk.armL.upper.getWorldPosition(_sh)
  const pl = poses.character.poleL
  _pole.set(pl[0], pl[1], pl[2]).applyQuaternion(_rq).add(_sh)
  sk.armL.solve(_handTarget, _gq, _pole, w)
  sk.armL.applyGrip(w)
}

// pos is the foot position. Standing/crouching heights come from MovementConfig (only the legs shrink when crouching, the top of the head matches the hitbox).
export function createPlayersRenderer(scene: THREE.Scene, info?: TeamInfo) {
  const { standHeight, crouchHeight } = defaultMovement
  const actors = new Map<number, Actor>()
  const lastSeen = new Map<number, number>()   // id -> last frame number it was seen (avoids allocating a Set every frame)
  const labels = new Map<number, THREE.Sprite>()
  const wanted = new Map<number, THREE.Sprite>()   // wanted mark over players with a kill streak >= WANTED_STREAK (visible to enemies too)
  const deathFx = createDeathFx(scene)
  let frame = 0
  let lastNow = performance.now()
  let setId = ''
  requestGuns()
  const requestSkin = (id: string): void => { const sk = skinOfSet(getCharacterSet(id).id); if (sk) requestCharacters(sk) }
  requestSkin(setId)   // room's set not known yet -> default set

  // Dedicated model file for each zombie (deterministic per id); cached per ztype to avoid recomputing every frame
  const zfileCache = new Map<number, { ztype: string | undefined; file: string; scale: number }>()
  let zombiesRequested = false
  function zombieModelOf(p: RenderPlayer): { file: string; scale: number } | null {
    if (!(p.flags & NetFlag.Zombie)) return null
    let c = zfileCache.get(p.id)
    if (!c || c.ztype !== p.ztype) {
      const m = zombieVariation(p.id, zombieOpts(p.ztype)).model
      c = { ztype: p.ztype, file: m?.file ?? '', scale: m?.scale ?? 1 }
      zfileCache.set(p.id, c)
    }
    return c.file ? c : null
  }

  function dropActor(id: number, a: Actor): void {
    zfileCache.delete(id)
    dropWanted(id)
    scene.remove(a.rig.root)
    disposeActor(a, scene)
    actors.delete(id)
    lastSeen.delete(id)
  }

  // Rebuild when the team changes (TeamAssigned arrives after the first snapshot) or the character set changes
  function ensure(p: RenderPlayer): Actor | null {
    const team = info?.modelTeam?.(p.id, p.flags) ?? info?.teamOf(p.id) ?? 'A'
    const skin = skinOfSet(getCharacterSet(setId).id)   // skinned set (Cops & Terrorists) -> the matching skin
    // Dedicated zombie model (Defense, mother zombie): until loaded, a normal zombie is not drawn, while an infected player still stands with the human model
    const zm = skeletalEnabled() ? zombieModelOf(p) : null
    const zReady = !!zm && zombieModelReady(zm.file)
    if (zm && !zReady) requestZombieModels([zm.file])
    const zfile = zReady ? zm!.file : ''
    const humanSkel = skeletalEnabled() && !!skin && skeletalReady(skin, team)
    const wantSkel = humanSkel || zReady
    let a = actors.get(p.id)
    if (!a && zm && !zReady && ZOMBIE_TYPES[p.ztype ?? '']) return null   // Defense zombie: wait for the model
    if (a && (a.rig.team !== team || !!a.rig.skel !== wantSkel || a.zfile !== zfile)) { dropActor(p.id, a); a = undefined }
    if (!a) {
      a = makeActor(wantSkel ? makeSkeletalRig(skin ?? 'copsTerrorists', team, zfile || undefined) : getCharacterSet(setId).build(team), (p.flags & NetFlag.Dead) !== 0)
      a.zfile = zfile
      scene.add(a.rig.root)
      actors.set(p.id, a)
    }
    return a
  }

  // Names only for teammates, enemies get no tag
  function dressLabel(id: number, a: Actor, h: number): void {
    const team = info?.teamOf(id)
    let label = labels.get(id)
    const mate = team !== undefined && team === info?.myTeam()
    if (mate && !label) {
      const name = info?.nameOf(id)
      if (name) {
        label = makeNameSprite(name, TEAMS[team!].uiColor)
        scene.add(label)
        labels.set(id, label)
      }
    }
    if (label) {
      label.visible = mate && a.rig.root.visible
      label.position.set(a.rig.root.position.x, a.rig.root.position.y + h + 0.5, a.rig.root.position.z)
    }
  }

  function dropWanted(id: number): void {
    const w = wanted.get(id)
    if (!w) return
    scene.remove(w); w.material.dispose(); wanted.delete(id)
  }

  function dressWanted(p: RenderPlayer, a: Actor, h: number): void {
    const on = (p.killStreak ?? 0) >= WANTED_STREAK && a.rig.root.visible
    let w = wanted.get(p.id)
    if (!on) { if (w) dropWanted(p.id); return }
    if (!w) { w = makeWantedSprite(); scene.add(w); wanted.set(p.id, w) }
    // A little above the teammate name tag so they do not overlap
    w.position.set(a.rig.root.position.x, a.rig.root.position.y + h + 0.95, a.rig.root.position.z)
  }

  function dressGun(a: Actor, weapon: number): void {
    if (a.gunId === weapon && a.gun) return
    const src = gunModels.get(isGrenadeId(weapon) ? GRENADE_ID : weapon)
    if (!src) return   // not loaded yet: retry next frame
    const parent = a.twoHand ? a.holder : a.rig.gunAnchor
    if (a.gun) a.gun.removeFromParent()
    a.gun = src.clone(true)
    a.gunId = weapon
    a.pinOff = false; a.pulling = false; a.thrown = false
    if (weapon === SMOKE_ID) tintSmoke(a.gun)   // smoke: the M67 model tinted grey
    // Grenade and one-handed gun on a skinned character: the grip (anchor hand_r) coincides with the gunAnchor origin (the palm centre),
    // otherwise the gun hangs by its model origin, e.g. the knife handle floats above the fist
    const byGrip = isGrenadeId(weapon) || (!!a.rig.skel && weaponPose(weapon).third.hold === 'oneHand')
    if (byGrip) {
      getAnchor(weapon, 'hand_r', _anchor)
      // anchors live in the model's parent space, so keep the model root's own offset (MODEL_ADJUST, e.g. the knife) and subtract the anchor from it
      a.gun.position.sub(_anchor)
    }
    parent.add(a.gun)
    // Muzzle coordinates pre-measured in gunGroup space (the 'muzzle' node is inside the scaled GunRoot so it cannot be used directly)
    a.flash.position.copy(MUZZLE_FALLBACK[weapon] ?? MUZZLE_FALLBACK[0]!)
    if (byGrip) a.flash.position.add(a.gun.position)
  }

  function hideGun(a: Actor): void {
    if (a.gun) a.gun.visible = false
    a.flash.visible = false
  }

  const killMemory = new Map<number, { headshot: boolean; t: number }>()
  const _e = new THREE.Euler(), _fwd = new THREE.Vector3(), _roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)

  // Gun leaving the hand: keeps its world coordinates, falls + spins. Materials are cloned so it fades on its own (geometry is shared so it is not disposed)
  function dropGun(a: Actor): void {
    if (!a.gun || a.drop) return
    const g = a.gun
    g.updateWorldMatrix(true, false)
    scene.attach(g)
    const mats: THREE.Material[] = []
    g.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.material = (o.material as THREE.Material).clone()
      ;(o.material as THREE.Material).transparent = true
      mats.push(o.material as THREE.Material)
    })
    _fwd.set(0, 0, -1).applyQuaternion(g.quaternion)
    const yaw = Math.atan2(-_fwd.x, -_fwd.z)
    const to = new THREE.Quaternion().setFromEuler(_e.set(0, yaw, 0)).multiply(_roll)
    a.drop = {
      obj: g, mats, vy: 0, wx: (Math.random() - 0.5) * 6, wz: (Math.random() - 0.5) * 6,
      floorY: a.rig.root.position.y + 0.06, landed: false, settleT: 0, age: 0, from: new THREE.Quaternion(), to,
    }
    a.gun = null; a.gunId = -1
    a.flash.visible = false
  }

  function clearDrop(a: Actor): void {
    const d = a.drop
    if (!d) return
    d.obj.removeFromParent()
    for (const m of d.mats) m.dispose()
    a.drop = null
  }

  function updateDrop(a: Actor, dt: number): void {
    const d = a.drop
    if (!d) return
    d.age += dt
    if (!d.landed) {
      d.vy -= DROP_GRAVITY * dt
      d.obj.position.y += d.vy * dt
      d.obj.rotateX(d.wx * dt); d.obj.rotateZ(d.wz * dt)
      if (d.obj.position.y <= d.floorY) { d.obj.position.y = d.floorY; d.landed = true; d.from.copy(d.obj.quaternion) }
    } else if (d.settleT < DROP_SETTLE_S) {
      d.settleT += dt
      d.obj.quaternion.slerpQuaternions(d.from, d.to, Math.min(1, d.settleT / DROP_SETTLE_S))
    }
    const fade = Math.min(1, Math.max(0, (d.age - DROP_HOLD_S) / DROP_FADE_S))
    if (fade > 0) for (const m of d.mats) m.opacity = 1 - fade
    d.obj.visible = fade < 1
  }

  function takeKill(id: number): boolean {
    const k = killMemory.get(id)
    killMemory.delete(id)
    return !!k && performance.now() - k.t < KILL_MEMORY_MS && k.headshot
  }

  function place(p: RenderPlayer, a: Actor, nowMs: number, dt: number) {
    const rig = a.rig
    const crouching = (p.flags & NetFlag.Crouching) !== 0
    const h = crouching ? crouchHeight : standHeight
    rig.root.position.set(p.pos[0], p.pos[1], p.pos[2])
    rig.root.rotation.y = p.yaw
    const dead = (p.flags & NetFlag.Dead) !== 0
    const weapon = p.weapon ?? 0
    const sliding = (p.flags & NetFlag.Sliding) !== 0, grounded = (p.flags & NetFlag.Grounded) !== 0
    if (rig.skel) {
      // Skinned character. Required order: mixer -> spine by pitch -> gun -> hand IK -> fingers
      const sk = rig.skel
      if (dead && !sk.isDead) { sk.die(takeKill(p.id)); dropGun(a) }
      else if (!dead && sk.isDead) { sk.revive(); clearDrop(a) }
      a.wasDead = dead
      const zombie = (p.flags & NetFlag.Zombie) !== 0
      sk.setZombie(zombie)   // z_* clips: until loaded keep the human animation, retry next frame
      if (zombie && !a.zfx) {
        a.zfx = makeZombieFx(scene, rig, p.id, zombieOpts(p.ztype), zombieSize(p.ztype, p.zscale), 1, a.zfile ? zfileCache.get(p.id)?.scale ?? 1 : 1)
        a.deadAt = 0; hideGun(a)
        // Player just infected (invulnerable + standing still while transforming): scream
        if ((p.flags & NetFlag.Invuln) && !ZOMBIE_TYPES[p.ztype ?? '']) sk.playZombie('scream', INFECTION.transformMs / 1000)
      } else if (!zombie && a.zfx) { removeZombieFx(scene, a.zfx, rig); a.zfx = null }
      const frame = { dt, x: p.pos[0], z: p.pos[2], yaw: p.yaw, grounded, crouching, sliding, pitch: p.pitch ?? 0, pistol: zombie, dead }
      if (zombie && !dead) {   // zombies hold no gun: arms hang per the animation
        sk.animate(frame)
        sk.placeAim()
        sk.setOpacity((p.flags & NetFlag.Invuln) ? 0.55 + 0.3 * Math.sin(nowMs / 70) : 1)
        hideGun(a)
      } else if (!dead) {
        if (a.gun) a.gun.visible = true   // just recovered from zombie back to human
        dressGun(a, weapon)
        const two = weaponPose(weapon).third.hold === 'twoHand' && !!a.gun
        setHold(a, two)
        frame.pistol = !two
        sk.animate(frame)
        sk.placeAim()
        if (two) solveSkelArms(a, weapon, p.adsT ?? 0)
        else sk.refreshGunAnchor()
        if (isGrenadeId(weapon) && a.gun) nadeHand(a)
        sk.setOpacity((p.flags & NetFlag.Invuln) ? 0.55 + 0.3 * Math.sin(nowMs / 70) : 1)
      } else {
        sk.animate(frame)
        if (sk.ikWeight > 0 && a.twoHand) { sk.placeAim(); solveSkelArms(a, weapon, 0) }   // IK fades out toward the animation pose
      }
      rig.root.visible = sk.corpseVisible
      if (a.zfx && dead) {   // the zombie corpse lies for 4s then sinks into the ground (no fade, saves shader cost)
        if (a.deadAt === 0) a.deadAt = nowMs
        const sink = Math.min(1, Math.max(0, (nowMs - a.deadAt - DEFENSE.corpseMs) / DEFENSE.corpseSinkMs))
        rig.root.position.y = p.pos[1] - sink * 2.2
      } else a.deadAt = 0
      if (a.zfx) { const v = info?.viewer?.(); updateZombieFx(a.zfx, rig, rig.root.visible && !dead, !!v && Math.hypot(v[0] - p.pos[0], v[2] - p.pos[2]) > 40) }
      dressWanted(p, a, h)
      a.flash.visible = nowMs < a.flashUntil
      dressLabel(p.id, a, h)
      return
    }
    if (dead && !a.wasDead) deathFx.burst(rig)   // just died: the boxes break apart
    a.wasDead = dead
    rig.root.visible = !dead
    if (!dead) {
      updateAnim(rig, a.anim, {
        x: p.pos[0], z: p.pos[2], dt,
        grounded, crouching, sliding,
        pitch: p.pitch ?? 0, crouchDrop: standHeight - crouchHeight,
      })
    } else a.anim.hasLast = false   // respawned far from where it died: not counted as running
    // Invulnerable: faint flashing
    const op = (p.flags & NetFlag.Invuln) ? 0.55 + 0.3 * Math.sin(nowMs / 70) : 1
    if (rig.mats[0]!.opacity !== op || op !== 1) for (const m of rig.mats) m.opacity = op
    dressGun(a, weapon)
    const two = weaponPose(weapon).third.hold === 'twoHand' && !!a.gun
    setHold(a, two)
    if (two && !dead) {
      solveArms(a, weapon, p.pitch ?? 0, p.adsT ?? 0)
      a.armR!.setVisible(true); a.armL!.setVisible(true)
    }
    dressWanted(p, a, h)
    a.flash.visible = nowMs < a.flashUntil
    dressLabel(p.id, a, h)
  }

  return {
    /** Loaded gun template (shared geometry/materials, clone it): for guns lying on the floor. null until loaded. */
    gunModel(id: number): THREE.Object3D | null { return gunModels.get(id) ?? null },
    // Draw exactly the players in the snapshot; anyone no longer listed is removed.
    // Do not draw yourself: the camera is inside the body and a few frames of jitter would show it.
    update(players: RenderPlayer[], selfId = -1) {
      frame++
      const now = performance.now()
      const dt = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      if (!zombiesRequested && info?.zombieMode?.()) { zombiesRequested = true; requestZombieModels(ZOMBIE_LOOK.models.map(m => m.file)) }
      const want = info?.characterSet?.() ?? ''
      if (want !== setId) {   // character set changed (joined another room): rebuild everything
        setId = want
        requestSkin(setId)
        for (const [id, a] of actors) dropActor(id, a)
      }
      for (const p of players) {
        if (p.id === selfId) continue
        const a = ensure(p)
        if (!a) continue
        lastSeen.set(p.id, frame)
        place(p, a, now, dt)
      }
      for (const [id, a] of actors) {
        if (lastSeen.get(id) === frame) continue
        const lb = labels.get(id)
        if (lb) { scene.remove(lb); lb.material.map?.dispose(); lb.material.dispose(); labels.delete(id) }
        dropActor(id, a)
      }
      for (const a of actors.values()) if (a.drop) updateDrop(a, dt)
      deathFx.update(dt)
    },
    // Other players' GrenadeAnim: pull the pin (left hand touches the pin ring), throw (upper-body clip), cancel
    grenadeAnim(id: number, phase: 'pulling' | 'throw' | 'cancel', mode: 'strong' | 'lob' = 'strong') {
      const a = actors.get(id); const sk = a?.rig.skel
      if (!a || !sk) return
      if (phase === 'pulling') { sk.startPull(); a.pulling = true; a.pinOff = false }
      else if (phase === 'throw') { sk.playThrow(mode); a.thrown = true; a.pulling = false }
      else { sk.cancelThrow(); a.pulling = false; a.pinOff = false }
    },
    /** Delay (ms) from receiving GrenadeSpawn to the grenade leaving the hand in the thrower's animation; 0 if there is no animation */
    grenadeReleaseDelayMs(id: number, mode: 'strong' | 'lob'): number { return actors.get(id)?.rig.skel?.releaseDelayMs(mode) ?? 0 },
    // Kill message: choose the death style (headshot -> death_2) for skinned characters; usable whether it arrives before or after the death snapshot
    markKill(victimId: number, headshot: boolean) {
      killMemory.set(victimId, { headshot, t: performance.now() })
      actors.get(victimId)?.rig.skel?.setDeathVariant(headshot)
    },
    // Zombie claw (the claw's ShotFx): upper-body clip
    zombieAttack(id: number, heavy: boolean) { actors.get(id)?.rig.skel?.playZombie(heavy ? 'heavy' : 'light') },
    // Muzzle flash when receiving this player's ShotFx
    muzzleFlash(id: number) {
      const a = actors.get(id)
      if (a) a.flashUntil = performance.now() + FLASH_MS
    },
    clear() { this.update([]); deathFx.clear() },
  }
}
