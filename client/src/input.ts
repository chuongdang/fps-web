import * as THREE from 'three'
import { Btn } from '@fps/shared'
import { t } from './i18n'
import { isPortrait } from './touch/detect'
import { IS_TOUCH } from './touch/mode'
import { createTouchControls, type TouchControls, type TouchSink } from './touch/touchControls'
import type { TouchContext } from './touch/buttons'
import { lookStep, PITCH_LIMIT } from './touch/look'
import { TOUCH as TOUCH_CFG } from './touch/config'
import { wheelLook } from './touch/trackpad'

/** Phone / tablet without a mouse: no Pointer Lock, "Tap to play" instead of "Click to play" (plan 19) */
const TOUCH = IS_TOUCH
export function isTouchControls(): boolean { return TOUCH }

const LS_SENS_KEY = 'fps_sens'
const DEFAULT_SENS = 0.0022
let _sens = parseFloat(localStorage.getItem(LS_SENS_KEY) ?? '') || DEFAULT_SENS

export let yaw = 0
export let pitch = 0

let _locked = false
let _skipFirstMove = false
const _keys: Record<string, boolean> = {}
let _mouseLeft = false
let _mouseRight = false
let _wheel = 0       // total unread mouse-wheel steps (sign: >0 scrolled down)
let _sensScale = 1   // lower the sensitivity when zoomed (proportional to FOV)
let _flashlight = true         // flashlight (F key), on by default; only has an effect at night
let _flashlightAllowed = false // night room + we are a human

// ── Overlay ───────────────────────────────────────────────────────────────────
const _overlay = document.createElement('div')
_overlay.style.cssText =
  'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
  'background:rgba(0,0,0,0.55);color:#fff;font:28px monospace;cursor:pointer;z-index:10;' +
  'user-select:none'
_overlay.textContent = t(TOUCH ? 'hud.overlay.tapToPlay' : 'hud.overlay.clickToPlay')
document.body.appendChild(_overlay)

/** Offline may drop the dark layer of the "Click to play" screen to see better while tuning arms/weapons */
export function setOverlayDim(dim: boolean): void {
  _overlay.style.background = dim ? 'rgba(0,0,0,0.55)' : 'transparent'
  _overlay.style.textShadow = dim ? '' : '0 0 6px #000, 0 0 3px #000'
}

let _overlayHidden = false
function _syncOverlay(): void { _overlay.style.display = _locked || _overlayHidden ? 'none' : 'flex' }
/** The pose editor (F9) hides the "Click to play" layer while it is open (it releases the pointer lock, which would bring it back) */
export function setOverlayHidden(hide: boolean): void { _overlayHidden = hide; _syncOverlay() }

function _setLocked(v: boolean) {
  _locked = v
  _syncOverlay()
}

// ── Touch start flow ──────────────────────────────────────────────────────────
// There is no pointer lock to wait for: the first tap starts the game, and the game is only "live" in landscape.
let _touchStarted = false
let _portrait = false

let _touchBits = 0   // buttons held on the touch controls (move + fire), ORed into sampleButtons()
let _touchUi: TouchControls | null = null
const _look = { yaw: 0, pitch: 0 }
const _touchSink: TouchSink = {
  setButtons(bits: number): void { _touchBits = bits },
  look(dxPx: number, dyPx: number): void {
    if (!_locked) return
    lookStep(yaw, pitch, dxPx, dyPx, TOUCH_CFG.lookSens, _sensScale, _look)
    yaw = _look.yaw
    pitch = _look.pitch
  },
  toggleFlashlight(): void { if (_locked) _flashlight = !_flashlight },
  flashlight(): boolean { return _flashlight },
  lastWeapon(): void { if (_locked) _touchActions.lastWeapon() },
  dropWeapon(): void { if (_locked) _touchActions.dropWeapon() },
  tap(): void { if (_locked) _touchActions.tap() },
}

/** Things only main.ts knows how to do (it owns the weapon state, the shop and the spectator camera) */
export interface TouchActions { lastWeapon(): void; dropWeapon(): void; tap(): void }
let _touchActions: TouchActions = { lastWeapon() {}, dropWeapon() {}, tap() {} }
export function setTouchActions(a: TouchActions): void { _touchActions = a }

/** Which touch action buttons apply right now. Call every frame with one reused object; a no-op on desktop. */
export function setTouchContext(ctx: Readonly<TouchContext>): void { _touchUi?.setContext(ctx) }

function _refreshTouch(): void {
  _portrait = isPortrait(window.innerWidth, window.innerHeight)
  _locked = _touchStarted && !_portrait
  _overlay.textContent = t(_portrait ? 'hud.overlay.rotate' : 'hud.overlay.tapToPlay')
  _syncOverlay()
  _touchUi?.setActive(_locked)
  _syncCursor()
}

// Hide the system pointer everywhere while playing with a trackpad (not only over the canvas); buttons keep it so the HUD stays clickable
let _mouseSeen = false
const _cursorStyle = document.createElement('style')
_cursorStyle.textContent = 'html.mouse-look, html.mouse-look *:not(button):not(a):not(input):not(select) { cursor: none !important }'
document.head.appendChild(_cursorStyle)
function _syncCursor(): void { document.documentElement.classList.toggle('mouse-look', _mouseSeen && _locked) }

type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> }

/** Called from the tap itself (browsers only allow fullscreen / orientation lock inside a user gesture). Both are best effort:
 *  iPhone Safari has neither, iPad has fullscreen, Android Chrome has both. */
function _startTouch(): void {
  _touchStarted = true
  _refreshTouch()
  const el = document.documentElement as FullscreenEl
  try { void Promise.resolve((el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el)).catch(() => {}) } catch { /* not supported */ }
  try { void (screen.orientation as LockableOrientation).lock?.('landscape')?.catch(() => {}) } catch { /* not supported */ }
}

/** A mouse / trackpad on a touch-mode device (iPad: no Pointer Lock, so the cursor cannot be captured and would stop at the
 *  screen edge). Look = two-finger swipe (wheel events: the cursor does not move), Fire = left click, Aim = right click.
 *  Only pointerType 'mouse' is used: finger taps arrive as pointerType 'touch' and are handled by the touch controls. */
function _registerTrackpad(canvas: HTMLElement): void {
  const look = { dx: 0, dy: 0 }
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !_mouseSeen) { _mouseSeen = true; _syncCursor() }
  })
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return
    if (e.button === 0) _mouseLeft = true; else if (e.button === 2) _mouseRight = true
  })
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') return
    if (e.button === 0) _mouseLeft = false; else if (e.button === 2) _mouseRight = false
  })
  document.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'mouse') { _mouseLeft = false; _mouseRight = false }
  })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  // Not passive: preventDefault stops Safari scrolling / rubber-banding the page and the two-finger back-swipe
  document.addEventListener('wheel', (e) => {
    if (!_locked || e.target !== canvas) return
    e.preventDefault()
    wheelLook(e.deltaX, e.deltaY, e.deltaMode, window.innerHeight, look)
    lookStep(yaw, pitch, look.dx, look.dy, TOUCH_CFG.trackpadLookSens * (_sens / DEFAULT_SENS), _sensScale, _look)
    yaw = _look.yaw
    pitch = _look.pitch
  }, { passive: false })
}

function _registerKeyboard(): void {
  document.addEventListener('keydown', (e) => {
    _keys[e.code] = true
    if (e.code === 'KeyF' && !e.repeat && _locked) _flashlight = !_flashlight
    // Ctrl+key (S save page, D bookmark, W close tab...) opens a browser dialog
    // → focus is lost → the Ctrl keyup never arrives → stuck crouching. Block every Ctrl+key while the mouse is locked.
    if (_locked && e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') {
      e.preventDefault()
    }
  })
  // Losing window focus (Alt+Tab, dialogs...) also produces no keyup
  window.addEventListener('blur', () => {
    for (const k in _keys) _keys[k] = false
    _mouseLeft = false
    _mouseRight = false
  })
  document.addEventListener('keyup', (e) => { _keys[e.code] = false })
}

export function initInput(canvas: HTMLElement): void {
  if (TOUCH) {
    _overlay.addEventListener('click', _startTouch)
    window.addEventListener('resize', _refreshTouch)
    window.addEventListener('orientationchange', _refreshTouch)
    // Keys of an attached keyboard still work. The desktop mouse handlers below are NOT registered: iOS replays every tap as
    // mousemove/mousedown/mouseup, which would fire stray shots and feed unusable movementX values into the camera.
    // A real mouse / trackpad is picked up through pointer events instead (pointerType 'mouse' only).
    _registerKeyboard()
    _registerTrackpad(canvas)
    _touchUi = createTouchControls(canvas, _touchSink)
    _refreshTouch()
    return
  }
  canvas.addEventListener('click', () => canvas.requestPointerLock())
  _overlay.addEventListener('click', () => canvas.requestPointerLock())

  document.addEventListener('pointerlockchange', () => {
    const isLocked = document.pointerLockElement === canvas
    _setLocked(isLocked)
    if (isLocked) {
      _skipFirstMove = true
    } else {
      // Clear the key state when leaving pointer lock — prevents keys from getting "stuck"
      // because the browser sends no keyup after leaving the lock
      for (const k in _keys) _keys[k] = false
      _mouseLeft = false
      _mouseRight = false
    }
  })

  document.addEventListener('mousemove', (e) => {
    if (!_locked) return
    if (_skipFirstMove) {
      _skipFirstMove = false
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return
    }
    yaw   -= e.movementX * _sens * _sensScale
    pitch -= e.movementY * _sens * _sensScale
    pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch))
  })

  _registerKeyboard()

  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) _mouseLeft = true; else if (e.button === 2) _mouseRight = true })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  document.addEventListener('wheel', (e) => { if (_locked) _wheel += Math.sign(e.deltaY) }, { passive: true })
  // mouseup on document so a release outside the canvas is not missed
  document.addEventListener('mouseup',  (e) => { if (e.button === 0) _mouseLeft = false; else if (e.button === 2) _mouseRight = false })
}

let _cyclePulse = false
/** Press the grenade key again while holding a grenade: the next cmd carries Btn.CycleNade (one cmd; the server sees the rising edge) */
export function requestCycleNade(): void { _cyclePulse = true }

export function sampleButtons(): number {
  let b = 0
  if (_cyclePulse) { b |= Btn.CycleNade; _cyclePulse = false }
  if (_keys['KeyW'])                                            b |= Btn.Forward
  if (_keys['KeyS'])                                            b |= Btn.Back
  if (_keys['KeyA'])                                            b |= Btn.Left
  if (_keys['KeyD'])                                            b |= Btn.Right
  if (_keys['Space'])                                           b |= Btn.Jump
  if (_keys['KeyC'] || _keys['ControlLeft'] || _keys['ControlRight']) b |= Btn.Crouch
  if (_keys['KeyT'])                                            b |= Btn.QuickNade   // T: quick grenade (G drops the held gun, E picks one up)
  if (_keys['KeyE'])                                            b |= Btn.Ability
  if (_keys['KeyQ'])                                            b |= Btn.Sniff
  if (_flashlight && _flashlightAllowed)                        b |= Btn.Flashlight
  if (_mouseLeft)                                               b |= Btn.Fire
  if (_keys['KeyR'])                                            b |= Btn.Reload
  if (_mouseRight)                                              b |= Btn.Aim
  return b | _touchBits
}

export function applyCameraRotation(camera: THREE.Camera): void {
  (camera as THREE.PerspectiveCamera).rotation.order = 'YXZ'
  camera.rotation.y = yaw
  camera.rotation.x = pitch
  camera.rotation.z = 0   // explosion shake adds to z every frame: without a reset the tilt accumulates
}

// The server sets the look direction (respawn)
export function setLook(y: number, p: number): void { yaw = y; pitch = p }

/** Night room and we are a human: only then send/draw the flashlight */
export function setFlashlightAllowed(v: boolean): void { _flashlightAllowed = v }
export function flashlightOn(): boolean { return _flashlight && _flashlightAllowed }

export function isKeyDown(code: string): boolean {
  return !!_keys[code]
}

export function isLocked(): boolean {
  return _locked
}

/** Extra mouse sensitivity multiplier (1 = normal); the deeper the zoom the smaller */
export function setSensScale(v: number): void { _sensScale = v }

/** Read and clear the accumulated mouse-wheel steps (>0 scrolled down, <0 scrolled up) */
export function consumeWheel(): number { const w = _wheel; _wheel = 0; return w }
