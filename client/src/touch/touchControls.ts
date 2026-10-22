import { t } from '../i18n'
import { TOUCH } from './config'
import { BUTTONS, placeButtons, type ButtonDef, type ButtonId, type TouchContext } from './buttons'
import { moveBits, clampToRadius } from './joystick'
import { joystickRadius } from './layout'
import { isTap } from './gesture'
import { iconSvg } from './icons'
import { BUTTON_SHADOW, buttonLook, lookFill } from './style'
import { OPACITY_VALUE, SIZE_SCALE, loadTouchPrefs, type TouchPrefs } from './prefs'

/** What the touch controls feed into: input.ts turns these into button bits and camera movement. */
export interface TouchSink {
  /** the buttons held right now (Btn.Forward | ... | Btn.Fire | ...); called only when the set changes */
  setButtons(bits: number): void
  /** finger movement since the last event, in CSS px */
  look(dxPx: number, dyPx: number): void
  toggleFlashlight(): void
  flashlight(): boolean
  lastWeapon(): void
  dropWeapon(): void
  /** a short touch on the world (not a drag): tap-to-spectate, tap to close the shop */
  tap(): void
}

export interface TouchControls {
  /** On while the game is live (started, landscape). Off releases every finger and hides the controls. */
  setActive(on: boolean): void
  /** Which action buttons apply right now (alive? human or zombie? night?). Cheap to call every frame: only changes do any work. */
  setContext(ctx: Readonly<TouchContext>): void
}

const NO_SELECT = 'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none;'
const px = (v: number): string => `${v}px`

function el(css: string, parent: HTMLElement): HTMLDivElement {
  const d = document.createElement('div')
  d.style.cssText = css
  parent.appendChild(d)
  return d
}

/**
 * Left part of the screen: a floating joystick (appears where the thumb lands). The rest of the canvas: drag to look.
 * Right side: the action buttons of buttons.ts (Fire, aim, jump, crouch, reload, ...). Every finger is tracked by its
 * pointer id, so move + look + fire work together. Touches that land on HUD buttons (shop, scoreboard, ...) never reach the
 * canvas, so those keep working.
 */
export function createTouchControls(canvas: HTMLElement, sink: TouchSink): TouchControls {
  canvas.style.touchAction = 'none'
  canvas.addEventListener('contextmenu', e => e.preventDefault())

  // z-index 11: above the canvas, under the "tap to play" overlay (10 hides us anyway while it shows) and the HUD (12+)
  const root = el(`position:fixed;inset:0;display:none;pointer-events:none;z-index:11;${NO_SELECT}`, document.body)
  const base = el(`position:absolute;display:none;border-radius:50%;box-sizing:border-box;border:2px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.1);${NO_SELECT}`, root)
  const knob = el('position:absolute;left:50%;top:50%;border-radius:50%;background:rgba(255,255,255,0.45);margin:0;', base)
  knob.setAttribute('data-touch', 'knob')
  base.setAttribute('data-touch', 'stick')

  // ── action buttons ──────────────────────────────────────────────────────────
  interface Btn { def: ButtonDef; node: HTMLDivElement; pointer: number; on: boolean; enabled: boolean; px: number; py: number }
  const btns = new Map<ButtonId, Btn>()
  for (const def of BUTTONS) {
    const node = el(
      'position:absolute;display:none;border-radius:50%;box-sizing:border-box;border:2px solid rgba(255,255,255,0.75);' +
      `box-shadow:${BUTTON_SHADOW};padding:0;pointer-events:auto;align-items:center;justify-content:center;transition:background .06s;${NO_SELECT}`, root)
    node.setAttribute('data-touch', def.id)
    node.setAttribute('role', 'button')
    node.setAttribute('aria-label', t(`hud.touch.${def.id}`))
    node.innerHTML = iconSvg(def.id)   // static markup from icons.ts
    node.addEventListener('contextmenu', e => e.preventDefault())
    btns.set(def.id, { def, node, pointer: -1, on: false, enabled: true, px: 0, py: 0 })
  }

  let active = false
  let prefs: TouchPrefs = loadTouchPrefs()
  let radius = joystickRadius(window.innerWidth, window.innerHeight)
  let joyId = -1, lookId = -1
  let ox = 0, oy = 0          // where the stick started
  let lx = 0, ly = 0          // last look position
  let sx = 0, sy = 0, st = 0  // where / when the look touch started (for tap detection)
  let joyT = 0                // when the stick touch started
  let moveB = 0
  const knobPos = { x: 0, y: 0 }
  const ctx: TouchContext = { live: false, human: true, ability: 'none', sniff: false, flashlight: false, drops: false, canAim: true, canReload: true, canDrop: true, canGrenade: true }
  const shown = new Set<ButtonId>()

  /** held buttons + toggled-on buttons + the stick */
  const push = (): void => {
    let bits = moveB
    for (const b of btns.values()) if (b.on && b.def.mode !== 'tap') bits |= b.def.bit
    sink.setButtons(bits)
  }

  function paint(b: Btn): void {
    const look = buttonLook(b.def.id, b.on)
    const op = OPACITY_VALUE[prefs.opacity]
    b.node.style.opacity = String(b.enabled ? op : op * 0.3)
    b.node.setAttribute('aria-disabled', b.enabled ? 'false' : 'true')
    b.node.style.background = lookFill(look)
    b.node.style.color = look.fg
    b.node.style.borderColor = look.border
    if (b.on) b.node.setAttribute('data-down', ''); else b.node.removeAttribute('data-down')
  }

  /** Position and show exactly the buttons the context asks for; anything that just disappeared is let go of. */
  function applyButtons(): void {
    const w = window.innerWidth, h = window.innerHeight
    prefs = loadTouchPrefs()
    radius = joystickRadius(w, h)
    base.style.width = base.style.height = px(radius * 2)
    knob.style.width = knob.style.height = px(radius)
    shown.clear()
    let changed = false
    if (active) {
      for (const p of placeButtons(ctx, w, h, SIZE_SCALE[prefs.size])) {
        const b = btns.get(p.def.id)!
        shown.add(p.def.id)
        b.enabled = p.enabled
        if (!p.enabled && b.def.mode !== 'tap' && (b.on || b.pointer !== -1)) { b.on = false; b.pointer = -1; changed = true }   // switched to a weapon that cannot do this: let go
        const s = b.node.style
        s.display = 'flex'
        s.width = s.height = px(p.d)
        // left-handed: the same layout mirrored (placeButtons measures from the thumb side)
        const side = prefs.hand === 'left' ? 'left' : 'right'
        s.right = s.left = ''
        s[side] = `calc(env(safe-area-inset-${side},0px) + ${p.right}px)`
        s.bottom = `calc(env(safe-area-inset-bottom,0px) + ${p.bottom}px)`
        const pad = p.d * (p.def.id === 'fire' ? 0.2 : 0.15)   // the icon fills the circle minus a margin
        s.padding = px(pad)
        if (p.def.id === 'flashlight') b.on = sink.flashlight()
        paint(b)
      }
    }
    for (const b of btns.values()) {
      if (shown.has(b.def.id)) continue
      b.node.style.display = 'none'
      if (b.pointer !== -1 || (b.on && b.def.mode !== 'tap')) { b.pointer = -1; b.on = false; paint(b); changed = true }
    }
    if (changed) push()
  }

  function showKnob(dx: number, dy: number): void {
    clampToRadius(dx, dy, radius, knobPos)
    knob.style.transform = `translate(calc(-50% + ${knobPos.x}px), calc(-50% + ${knobPos.y}px))`
  }

  function releaseAll(): void {
    joyId = lookId = -1
    moveB = 0
    base.style.display = 'none'
    for (const b of btns.values()) { b.pointer = -1; if (b.def.mode !== 'tap') b.on = false; paint(b) }
    push()
  }

  // ── stick + look on the canvas ──────────────────────────────────────────────
  canvas.addEventListener('pointerdown', e => {
    if (!active || e.pointerType === 'mouse') return
    e.preventDefault()
    const w = window.innerWidth
    if (prefs.hand === 'left' ? e.clientX > w * (1 - TOUCH.joystickZone) : e.clientX < w * TOUCH.joystickZone) {
      if (joyId !== -1) return
      joyId = e.pointerId
      ox = e.clientX; oy = e.clientY; joyT = performance.now()
      base.style.left = px(ox - radius); base.style.top = px(oy - radius)
      base.style.display = 'block'
      showKnob(0, 0)
    } else {
      if (lookId !== -1) return
      lookId = e.pointerId
      lx = e.clientX; ly = e.clientY; sx = lx; sy = ly; st = performance.now()
    }
    try { canvas.setPointerCapture(e.pointerId) } catch { /* the pointer is already gone */ }
  })

  canvas.addEventListener('pointermove', e => {
    if (!active) return
    if (e.pointerId === joyId) {
      const dx = e.clientX - ox, dy = e.clientY - oy
      showKnob(dx, dy)
      const bits = moveBits(dx, dy, radius)
      if (bits !== moveB) { moveB = bits; push() }
    } else if (e.pointerId === lookId) {
      sink.look(e.clientX - lx, e.clientY - ly)
      lx = e.clientX; ly = e.clientY
    }
  })

  const end = (e: PointerEvent): void => {
    if (e.pointerId === joyId) {
      joyId = -1
      moveB = 0
      base.style.display = 'none'
      push()
      if (e.type === 'pointerup' && isTap(Math.hypot(e.clientX - ox, e.clientY - oy), performance.now() - joyT)) sink.tap()
    } else if (e.pointerId === lookId) {
      lookId = -1
      if (e.type === 'pointerup' && isTap(Math.hypot(e.clientX - sx, e.clientY - sy), performance.now() - st)) sink.tap()
    }
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)

  // ── action buttons ──────────────────────────────────────────────────────────
  for (const b of btns.values()) {
    b.node.addEventListener('pointerdown', e => {
      if (!active || e.pointerType === 'mouse' || !shown.has(b.def.id) || !b.enabled) return
      e.preventDefault()
      if (b.def.mode === 'toggle') {
        b.on = !b.on
      } else if (b.def.mode === 'tap') {
        if (b.def.action === 'flashlight') { sink.toggleFlashlight(); b.on = sink.flashlight() }
        else if (b.def.action === 'lastWeapon') sink.lastWeapon()
        else if (b.def.action === 'dropWeapon') sink.dropWeapon()
      } else {
        if (b.pointer !== -1) return
        b.pointer = e.pointerId
        b.on = true
        b.px = e.clientX; b.py = e.clientY
        try { b.node.setPointerCapture(e.pointerId) } catch { /* the pointer is already gone */ }
      }
      paint(b)
      push()
    })
    if (b.def.dragLook) {   // a held Fire button that is dragged turns the camera, so you can shoot while you aim
      b.node.addEventListener('pointermove', e => {
        if (!active || e.pointerId !== b.pointer) return
        sink.look(e.clientX - b.px, e.clientY - b.py)
        b.px = e.clientX; b.py = e.clientY
      })
    }
    const release = (e: PointerEvent): void => {
      if (b.def.mode !== 'hold' || e.pointerId !== b.pointer) return
      b.pointer = -1
      b.on = false
      paint(b)
      push()
    }
    b.node.addEventListener('pointerup', release)
    b.node.addEventListener('pointercancel', release)
  }

  // A finger can vanish without an "up" (app switch, system gesture): never leave a button stuck
  window.addEventListener('blur', releaseAll)
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll() })
  window.addEventListener('resize', applyButtons)
  applyButtons()

  return {
    setActive(on: boolean): void {
      if (on === active) return
      active = on
      root.style.display = on ? 'block' : 'none'
      if (!on) releaseAll()
      applyButtons()
    },
    setContext(c: Readonly<TouchContext>): void {
      if (c.live === ctx.live && c.human === ctx.human && c.ability === ctx.ability && c.sniff === ctx.sniff && c.flashlight === ctx.flashlight && !!c.drops === !!ctx.drops
        && c.canAim !== false === ctx.canAim && c.canReload !== false === ctx.canReload && c.canDrop !== false === ctx.canDrop && c.canGrenade !== false === ctx.canGrenade) return
      ctx.live = c.live; ctx.human = c.human; ctx.ability = c.ability; ctx.sniff = c.sniff; ctx.flashlight = c.flashlight; ctx.drops = !!c.drops
      ctx.canAim = c.canAim !== false; ctx.canReload = c.canReload !== false; ctx.canDrop = c.canDrop !== false; ctx.canGrenade = c.canGrenade !== false
      applyButtons()
    },
  }
}
