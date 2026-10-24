import * as THREE from 'three'
import { poses, WEAPON_KEYS, type FingerName, weaponPose, armBodyOf, handsOf, armBodyDefault, handAdjustDefault, getAnchor, notifyPosesChanged, onPosesReplaced, exportPoses, exportWeapon, resetPosesToFile, type ArmView, type Vec3 } from './poses'
import type { ViewmodelHandle } from './viewmodel'
import { setOverlayHidden } from '../input'

// Debug (plan 10, P.6): F9 = pose editor panel (hands + gun, writes straight into the running `poses`), F10 = orbit camera
// looking at your own model. Tuning only; when done, "Copy JSON" and paste into render/poses.json.
type Tab = 'First' | 'Third' | 'Character' | 'Grip' | 'Arms' | 'Anchors' | 'Style' | 'Reload'
const TABS: Tab[] = ['First', 'Third', 'Character', 'Grip', 'Arms', 'Anchors', 'Style', 'Reload']
const FINGERS: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky']
const AXES = ['x', 'y', 'z']

export interface PoseEditor {
  readonly orbitOn: boolean
  /** Place the orbit camera around (x,y,z) while F10 is on */
  applyOrbit(camera: THREE.PerspectiveCamera, x: number, y: number, z: number): void
  /** Every frame: update the debug dots / reload preview playback */
  tick(dt: number): void
}

export function createPoseEditor(vm: ViewmodelHandle, weaponId: () => number, equip?: (id: number) => void): PoseEditor {
  let open = false
  let orbit = false
  let tab: Tab = 'First'
  let armView: ArmView = 'first', armSide: 'R' | 'L' = 'R'   // Arms tab: which view's adjustments / which hand
  let selWeapon = -1   // -1 = follow the held gun
  let orbitYaw = 0.6, orbitPitch = 0.25, orbitDist = 3
  let playT = -1       // reload preview: elapsed time (seconds)

  const panel = document.createElement('div')
  panel.style.cssText = 'position:fixed;top:8px;right:8px;width:340px;max-height:calc(100vh - 16px);overflow:auto;background:rgba(10,12,16,.92);color:#dde;font:12px monospace;padding:8px;border:1px solid #445;z-index:50;display:none'
  document.body.appendChild(panel)

  // Debug dots in the viewmodel camera space
  const dots = new Map<string, THREE.Mesh>()
  const dotGeo = new THREE.SphereGeometry(0.008, 8, 6)
  const dot = (name: string, color: number) => {
    const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color, depthTest: false }))
    m.renderOrder = 20; m.visible = false
    vm.scene.add(m); dots.set(name, m)
  }
  dot('sight', 0x30ff90); dot('hand_r', 0xff3030); dot('hand_l', 0x3080ff); dot('mag', 0xffe030)
  dot('shoulderR', 0xffffff); dot('shoulderL', 0xffffff); dot('elbowR', 0xc040ff); dot('elbowL', 0xc040ff)
  const _v = new THREE.Vector3()

  const wid = () => (selWeapon >= 0 ? selWeapon : weaponId())
  const dirty = () => notifyPosesChanged()

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag); e.style.cssText = css; e.textContent = text; return e
  }
  function numRow(parent: HTMLElement, label: string, get: () => number, set: (v: number) => void, min: number, max: number, step = 0.005): void {
    const row = el('div', 'display:flex;align-items:center;gap:4px;margin:2px 0')
    row.append(el('span', 'width:84px;overflow:hidden;white-space:nowrap', label))
    const rng = el('input'); rng.type = 'range'; rng.min = String(min); rng.max = String(max); rng.step = String(step); rng.value = String(get()); rng.style.flex = '1'
    const num = el('input', 'width:62px;background:#111;color:#dde;border:1px solid #445'); num.type = 'number'; num.step = String(step); num.value = String(+get().toFixed(4))
    const apply = (v: number) => { if (Number.isFinite(v)) { set(v); dirty() } }
    rng.oninput = () => { num.value = rng.value; apply(parseFloat(rng.value)) }
    num.onchange = () => { rng.value = num.value; apply(parseFloat(num.value)) }
    row.append(rng, num); parent.append(row)
  }
  function vecRows(parent: HTMLElement, label: string, v: () => Vec3, min: number, max: number, step?: number, names: readonly string[] = AXES): void {
    names.forEach((ax, i) => numRow(parent, label ? `${label}.${ax}` : ax, () => v()[i]!, n => { v()[i] = n }, min, max, step))
  }
  function selectRow(parent: HTMLElement, label: string, opts: string[], get: () => string, set: (v: string) => void): void {
    const row = el('div', 'margin:3px 0'); row.append(el('span', 'display:inline-block;width:84px', label))
    const s = el('select', 'background:#111;color:#dde')
    for (const o of opts) { const op = el('option', '', o); op.value = o; s.append(op) }
    s.value = get(); s.onchange = () => { set(s.value); dirty() }
    row.append(s); parent.append(row)
  }
  function btn(parent: HTMLElement, text: string, fn: () => void): void {
    const b = el('button', 'margin:2px 3px 2px 0;background:#223;color:#dde;border:1px solid #556;cursor:pointer', text)
    b.onclick = fn; parent.append(b)
  }
  function checkRow(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const row = el('label', 'display:inline-flex;align-items:center;gap:3px;margin:2px 8px 2px 0;cursor:pointer')
    const c = el('input'); c.type = 'checkbox'; c.checked = get()
    c.onchange = () => { set(c.checked); dirty(); render() }
    row.append(c, el('span', '', label)); parent.append(row); return row
  }
  function copy(obj: unknown): void {
    const text = JSON.stringify(obj, null, 2)
    navigator.clipboard?.writeText(text).catch(() => console.log(text))
  }

  function render(): void {
    panel.replaceChildren()
    const head = el('div', 'margin-bottom:4px')
    head.append(el('b', '', 'Pose editor (F9) · F10 orbit camera '))
    panel.append(head)
    const wsel = el('select', 'background:#111;color:#dde;margin-right:6px')
    const auto = el('option', '', '(held gun)'); auto.value = '-1'; wsel.append(auto)
    WEAPON_KEYS.forEach((k, i) => { const o = el('option', '', k); o.value = String(i); wsel.append(o) })
    wsel.value = String(selWeapon); wsel.onchange = () => { selWeapon = parseInt(wsel.value); if (selWeapon >= 0) equip?.(selWeapon); render() }
    head.append(wsel)
    const tabs = el('div', 'margin:4px 0')
    for (const t of TABS) { const b = el('button', `margin-right:2px;background:${t === tab ? '#446' : '#223'};color:#dde;border:1px solid #556;cursor:pointer`, t); b.onclick = () => { tab = t; render() }; tabs.append(b) }
    panel.append(tabs)

    const id = wid(), w = weaponPose(id), body = el('div')
    if (tab === 'First') {
      numRow(body, 'fov', () => poses.first.fov, v => { poses.first.fov = v }, 30, 90, 1)
      selectRow(body, 'hold', ['twoHand', 'pistolSupport', 'oneHand'], () => w.first.hold, v => { w.first.hold = v as never })
      if (!w.first.gunPos) w.first.gunPos = [0.14, -0.16, -0.36]
      vecRows(body, 'gunPos', () => w.first.gunPos!, -1, 1)
      vecRows(body, 'gunRotDeg', () => w.first.gunRotDeg, -90, 90, 0.5)
      body.append(el('div', 'margin-top:6px;color:#8af', 'Aim (hold right mouse; green dot = front sight)'))
      numRow(body, 'adsEyeDist', () => w.first.adsEyeDist ?? 0.45, v => { w.first.adsEyeDist = v }, 0.05, 0.8, 0.005)
      if (!w.first.adsRotDeg) w.first.adsRotDeg = [0, 0, 0]
      vecRows(body, 'adsRotDeg', () => w.first.adsRotDeg!, -30, 30, 0.25)
      numRow(body, 'scale', () => w.first.scale, v => { w.first.scale = v }, 0.3, 2, 0.01)
      vecRows(body, 'shoulderR', () => poses.first.shoulderR, -1, 1)
      vecRows(body, 'shoulderL', () => poses.first.shoulderL, -1, 1)
      vecRows(body, 'poleR', () => poses.first.poleR, -1, 1)
      vecRows(body, 'poleL', () => poses.first.poleL, -1, 1)
      body.append(el('div', 'margin-top:6px;color:#8af', 'Hands from the character model (real bones)'))
      vecRows(body, 'armsRoot', () => poses.first.armsRootOffset, -1, 1)
      vecRows(body, 'armsRot°', () => poses.first.armsRootRotDeg, -90, 90, 1)
      numRow(body, 'armsScale', () => poses.first.armsScale, v => { poses.first.armsScale = v }, 0.5, 3, 0.01)
      numRow(body, 'armsMaxExt', () => poses.first.armsMaxExtension, v => { poses.first.armsMaxExtension = v }, 0.6, 1, 0.01)
      vecRows(body, 'armsPoleR', () => poses.first.armsPoleR, -1, 1)
      vecRows(body, 'armsPoleL', () => poses.first.armsPoleL, -1, 1)
    } else if (tab === 'Third') {
      selectRow(body, 'hold', ['twoHand', 'oneHand'], () => w.third.hold, v => { w.third.hold = v as never })
      vecRows(body, 'gunPos', () => w.third.gunPos, -1, 1)
      vecRows(body, 'gunRotDeg', () => w.third.gunRotDeg, -90, 90, 0.5)
      vecRows(body, 'shoulderR', () => poses.third.shoulderR, -1, 2)
      vecRows(body, 'shoulderL', () => poses.third.shoulderL, -1, 2)
      vecRows(body, 'aimPivot', () => poses.third.aimPivot, -1, 2)
      vecRows(body, 'poleR', () => poses.third.poleR, -1, 1)
      vecRows(body, 'poleL', () => poses.third.poleL, -1, 1)
    } else if (tab === 'Character') {
      const c = poses.character, an = c.anim
      body.append(el('div', 'color:#8af', 'Skinned character (3rd person)'))
      numRow(body, 'crouchDrop', () => c.crouchDrop, v => { c.crouchDrop = v }, -0.3, 0.6, 0.01)
      numRow(body, 'crouchWalkDrop', () => c.crouchWalkDrop, v => { c.crouchWalkDrop = v }, -0.3, 0.6, 0.01)
      numRow(body, 'pitchLimit°', () => c.spinePitchLimitDeg, v => { c.spinePitchLimitDeg = v }, 10, 90, 1)
      numRow(body, 'headShare', () => c.headPitchShare, v => { c.headPitchShare = v }, 0, 1, 0.01)
      numRow(body, 'palmCenter', () => c.palmCenterFrac, v => { c.palmCenterFrac = v }, 0, 1.2, 0.01)
      vecRows(body, 'aimPivot+', () => c.aimPivotOffset, -0.6, 0.6)
      vecRows(body, 'poleR', () => c.poleR, -1, 1)
      vecRows(body, 'poleL', () => c.poleL, -1, 1)
      vecRows(body, 'handRotR°', () => c.handRotOffsetDegR, -180, 180, 1)
      vecRows(body, 'handRotL°', () => c.handRotOffsetDegL, -180, 180, 1)
      vecRows(body, 'oneHand.pos', () => c.oneHandGunPos, -0.3, 0.3, 0.002)
      vecRows(body, 'oneHand.rot°', () => c.oneHandGunRotDeg, -180, 180, 1)
      body.append(el('div', 'margin-top:6px;color:#8af', 'Animation'))
      numRow(body, 'blendTime', () => an.blendTime, v => { an.blendTime = v }, 0.02, 0.6, 0.01)
      numRow(body, 'walkRef m/s', () => an.walkRefSpeed, v => { an.walkRefSpeed = v }, 0.5, 4, 0.05)
      numRow(body, 'runRef m/s', () => an.runRefSpeed, v => { an.runRefSpeed = v }, 2, 10, 0.1)
      numRow(body, 'runStart m/s', () => an.runStartSpeed, v => { an.runStartSpeed = v }, 2, 10, 0.1)
      numRow(body, 'maxRate', () => an.maxRate, v => { an.maxRate = v }, 1, 4, 0.1)
      numRow(body, 'jumpHold s', () => an.jumpHoldS, v => { an.jumpHoldS = v }, 0, 1, 0.01)
    } else if (tab === 'Grip') {
      selectRow(body, 'axis', ['x', 'y', 'z'], () => poses.grip.axis, v => { poses.grip.axis = v as 'x' | 'y' | 'z' })
      for (const hand of ['R', 'L'] as const) {
        body.append(el('div', 'margin-top:4px;color:#8af', hand === 'R' ? 'Right hand (joint 1/2/3 bend, degrees)' : 'Left hand (joint 1/2/3 bend, degrees)'))
        for (const f of FINGERS) {
          const v = poses.grip[hand][f]
          for (let i = 0; i < 3; i++) numRow(body, `${f}${i + 1}`, () => v[i]!, n => { v[i] = n }, -120, 120, 1)
        }
      }
    } else if (tab === 'Arms') {
      const ab = armBodyOf(id, armView)[armSide], hands = handsOf(id), h = hands[armSide]
      body.append(el('div', 'color:#999', 'Per gun and per hand. "Hand" and "Fingers" are the grip on this gun: one setting for first AND third person. "Arm and forearm" (elbow, twists) is per view. Added on top of the shared settings (First / Character poles + hand rotation, Grip curls). All zero = unchanged. "Copy this gun" exports it.'))
      selectRow(body, 'view (arm and forearm only)', ['first', 'third'], () => armView, v => { armView = v as ArmView; render() })
      selectRow(body, 'hand', ['R', 'L'], () => armSide, v => { armSide = v as 'R' | 'L'; render() })
      if (armView === 'first' && armSide === 'L' && w.first.hold === 'oneHand') body.append(el('div', 'color:#fa6', 'This gun is held one-handed in first person: the left arm is hidden.'))
      if (armView === 'third') body.append(el('div', 'color:#999', 'Third person: look at it with the F10 orbit camera.'))
      const head2 = (s: string) => body.append(el('div', 'margin-top:8px;padding-top:4px;border-top:1px solid #445;color:#8af;font-weight:bold', s))
      head2(`Arm and forearm (${armView} person only)`)
      body.append(el('div', 'color:#999', 'Elbow: metres added to the elbow pole (swings the elbow). Twists: the skin rolls, the elbow / hand stay.'))
      vecRows(body, 'elbow', () => ab.elbow, -1, 1, 0.01)
      numRow(body, 'upperTwist°', () => ab.upperTwistDeg, v => { ab.upperTwistDeg = v }, -180, 180, 1)
      numRow(body, 'foreTwist°', () => ab.foreTwistDeg, v => { ab.foreTwistDeg = v }, -180, 180, 1)
      head2('Hand (shared by first and third person)')
      body.append(el('div', 'color:#999', 'Palm move (m, gun space: x right, y up, z towards the stock)'))
      vecRows(body, '', () => h.palmPos, -0.2, 0.2, 0.002, ['right +', 'up +', 'back +'])
      body.append(el('div', 'color:#999', 'Palm rotate about the palm (degrees, gun space)'))
      vecRows(body, '', () => h.palmRotDeg, -180, 180, 0.5, ['pitch', 'yaw', 'roll'])
      body.append(el('div', 'color:#999', 'Wrist (degrees, hand-bone axes): the palm and fingers pivot at the wrist, the forearm stays'))
      vecRows(body, '', () => h.wristDeg, -90, 90, 1, ['flex', 'twist', 'side'])
      head2('Fingers (shared by first and third person)')
      body.append(el('div', 'color:#999', 'Degrees per joint (knuckle out) added to the shared Grip curl. manual = ignore the shared curl, only these numbers. spread: + fans out (a finger away from the thumb side, the thumb away from the fingers).'))
      for (const f of FINGERS) {
        checkRow(body, `${f} manual`, () => h.manual.includes(f), on => { const i = h.manual.indexOf(f); if (on && i < 0) h.manual.push(f); else if (!on && i >= 0) h.manual.splice(i, 1) })
        for (let j = 0; j < 3; j++) numRow(body, `${f}${j + 1}`, () => h.fingers[f]?.[j] ?? 0, v => { (h.fingers[f] ??= [0, 0, 0])[j] = v }, -60, 120, 1)
        numRow(body, `${f} spread`, () => h.spread[f] ?? 0, v => { h.spread[f] = v }, -45, 45, 1)
      }
      head2('Tools')
      const other = armSide === 'R' ? 'L' : 'R'
      btn(body, `Copy fingers ${armSide} → ${other}`, () => { const o = hands[other]; o.fingers = structuredClone(h.fingers); o.spread = structuredClone(h.spread); o.manual = [...h.manual]; dirty() })
      btn(body, `Zero hand ${armSide} (both views)`, () => { Object.assign(h, handAdjustDefault()); dirty(); render() })
      btn(body, 'Zero both hands (both views)', () => { Object.assign(hands.R, handAdjustDefault()); Object.assign(hands.L, handAdjustDefault()); dirty(); render() })
      btn(body, `Zero arm ${armSide} (${armView} only)`, () => { Object.assign(ab, armBodyDefault()); dirty(); render() })
    } else if (tab === 'Anchors') {
      for (const n of ['hand_r', 'hand_l', 'mag'] as const) {
        if (!w.anchors[n]) { getAnchor(id, n, _v); w.anchors[n] = [_v.x, _v.y, _v.z] }
        vecRows(body, n, () => w.anchors[n]!, -1, 1, 0.002)
      }
    } else if (tab === 'Style') {
      for (const view of ['first', 'third'] as const) {
        body.append(el('div', 'margin-top:4px;color:#8af', view))
        const s = poses.style[view]
        numRow(body, 'upperLen', () => s.upperLen, v => { s.upperLen = v }, 0.1, 0.8)
        numRow(body, 'foreLen', () => s.foreLen, v => { s.foreLen = v }, 0.1, 0.8)
        numRow(body, 'thickness', () => s.thickness, v => { s.thickness = v }, 0.02, 0.2, 0.001)
        numRow(body, 'handSize', () => s.handSize, v => { s.handSize = v }, 0.02, 0.2, 0.001)
      }
      body.append(el('div', 'margin-top:6px', 'Sleeve/skin colours are changed in poses.json (reload the page to see them).'))
    } else {
      const rl = poses.reloadLeftHand
      numRow(body, 't (freeze frame)', () => vm.debug.freezeReload, v => { vm.debug.freezeReload = v; playT = -1 }, 0, 1, 0.01)
      btn(body, 'Preview reload', () => { playT = 0 })
      btn(body, 'Unfreeze', () => { vm.debug.freezeReload = -1; playT = -1; render() })
      numRow(body, 'magDetachT', () => rl.magDetachT, v => { rl.magDetachT = v }, 0, 1, 0.01)
      numRow(body, 'magAttachT', () => rl.magAttachT, v => { rl.magAttachT = v }, 0, 1, 0.01)
      for (const k of ['roll', 'pitch'] as const) numRow(body, `tilt.${k}`, () => rl.gunTiltDeg[k], v => { rl.gunTiltDeg[k] = v }, -90, 90, 1)
      numRow(body, 'tilt.inT', () => rl.gunTiltDeg.inT, v => { rl.gunTiltDeg.inT = v }, 0, 1, 0.01)
      numRow(body, 'tilt.outT', () => rl.gunTiltDeg.outT, v => { rl.gunTiltDeg.outT = v }, 0, 1, 0.01)
      rl.keys.forEach((k, i) => {
        body.append(el('div', 'margin-top:4px;color:#8af', `key ${i}: → ${k.to}`))
        numRow(body, 't', () => k.t, v => { k.t = v }, 0, 1, 0.01)
        if (!k.offset) k.offset = [0, 0, 0]
        vecRows(body, 'offset', () => k.offset!, -0.6, 0.6)
      })
      body.append(el('div', 'margin-top:6px;color:#999', 'The t marks should match the `at` marks in the reload audio profile (A.6).'))
    }
    panel.append(body)
    const foot = el('div', 'margin-top:8px;border-top:1px solid #445;padding-top:6px')
    btn(foot, 'Copy JSON', () => copy(exportPoses()))
    // poses.json shape, but only this gun under `weapons`: the shared tabs (First, Third, Character, Grip, Style, Reload: fov, armsScale, poles, shoulders...) come along,
    // so nothing edited in them is missed (they are not part of any gun's own block)
    btn(foot, 'Copy this gun + shared', () => { const { weapons: _all, ...shared } = exportPoses() as Record<string, unknown>; copy({ ...shared, weapons: { [WEAPON_KEYS[id]!]: exportWeapon(id) } }) })
    btn(foot, 'Reset to file', () => { resetPosesToFile(); render() })
    panel.append(foot)
  }

  // poses.json changed on disk: the panel's sliders point at the replaced objects, draw them again (else edits go nowhere until a tab switch)
  onPosesReplaced(() => { if (open) render() })

  function setOpen(v: boolean): void {
    open = v
    panel.style.display = v ? 'block' : 'none'
    vm.debug.showReach = v
    setOverlayHidden(v)
    if (v) { document.exitPointerLock?.(); render() } else { vm.debug.freezeReload = -1; playT = -1 }
    for (const d of dots.values()) d.visible = v
  }
  function setOrbit(v: boolean): void {
    orbit = v
    vm.setHidden(v)
    if (v) document.exitPointerLock?.()
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'F9') { e.preventDefault(); setOpen(!open) }
    else if (e.code === 'F10') { e.preventDefault(); setOrbit(!orbit) }
  })
  window.addEventListener('mousemove', e => {
    if (!orbit || (e.buttons & 1) === 0) return
    orbitYaw -= e.movementX * 0.006
    orbitPitch = Math.max(-1.2, Math.min(1.4, orbitPitch + e.movementY * 0.006))
  })
  window.addEventListener('wheel', e => { if (orbit) orbitDist = Math.max(1, Math.min(8, orbitDist + Math.sign(e.deltaY) * 0.3)) }, { passive: true })

  return {
    get orbitOn() { return orbit },
    applyOrbit(camera, x, y, z) {
      const cy = y + 1.1
      camera.position.set(
        x + Math.sin(orbitYaw) * Math.cos(orbitPitch) * orbitDist,
        cy + Math.sin(orbitPitch) * orbitDist,
        z + Math.cos(orbitYaw) * Math.cos(orbitPitch) * orbitDist,
      )
      camera.lookAt(x, cy, z)
    },
    tick(dt) {
      if (playT >= 0) {
        playT += dt
        const total = 2.2
        vm.debug.freezeReload = Math.min(1, playT / total)
        if (playT > total + 0.3) { vm.debug.freezeReload = -1; playT = -1 }
      }
      if (!open) return
      const d = vm.debug, id = vm.currentWeapon, M = d.gunGroup.matrix
      const put = (name: string, v: THREE.Vector3, on = true) => { const m = dots.get(name)!; m.position.copy(v); m.visible = on }
      put('sight', _v.copy(d.sight ?? _v.set(0, 0, 0)).applyMatrix4(M), !!d.sight)
      put('hand_r', getAnchor(id, 'hand_r', _v).applyMatrix4(M))
      put('hand_l', getAnchor(id, 'hand_l', _v).applyMatrix4(M))
      put('mag', getAnchor(id, 'mag', _v).applyMatrix4(M))
      put('shoulderR', d.shoulderR); put('shoulderL', d.shoulderL)
      put('elbowR', d.armR.elbowPos, d.validR); put('elbowL', d.armL.elbowPos, d.validL)
    },
  }
}
