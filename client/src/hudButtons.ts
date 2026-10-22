// Two buttons in the top-left corner (Scoreboard / Switch team), the switch-team confirm box and short toasts. Plain DOM.
import { t } from './i18n'
import { IS_TOUCH, LEFT_HANDED, TOUCH_HUD_SIDE } from './touch/mode'
import { hudIcon, type HudIconName } from './hudIcons'
import { stripKeyHint } from './touch/hint'
const BTN = 'pointer-events:auto;cursor:pointer;padding:6px 12px;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:6px;font:13px monospace' + (IS_TOUCH ? ';min-height:44px;padding:8px 16px;font-size:14px' : '')
// Phone: the top corners are crowded (the match banner is in the middle), so these are 44px square icon buttons; the words go to aria-label / title
const ICON = ';width:44px;height:44px;padding:0;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1'
const btnLabel = (key: 'hud.btn.scoreboard' | 'hud.btn.switchTeam' | 'hud.btn.backToLobby'): string => (IS_TOUCH ? stripKeyHint(t(key)) : t(key))
function iconOrText(b: HTMLButtonElement, key: 'hud.btn.scoreboard' | 'hud.btn.switchTeam' | 'hud.btn.backToLobby', icon: HudIconName): void {
  if (IS_TOUCH) { b.replaceChildren(hudIcon(icon, '24px')); b.setAttribute('aria-label', btnLabel(key)); b.title = btnLabel(key); b.style.cssText += ICON } else b.textContent = t(key)
}

export interface TopButtonsDeps {
  onScores(): void
  onSwitch(): void
}

export function createTopButtons(deps: TopButtonsDeps, showSwitch: boolean) {
  const box = document.createElement('div')
  // left-handed phone: the Fire arc is on the left, so these two move to the top right, beside the leave button (44px + 12px edge + 12px gap)
  box.style.cssText = `position:fixed;${LEFT_HANDED ? 'right:68px' : 'left:12px'};top:12px;z-index:30;display:flex;gap:8px;pointer-events:none`
  const scores = document.createElement('button'); scores.style.cssText = BTN; iconOrText(scores, 'hud.btn.scoreboard', 'trophy')
  scores.addEventListener('click', () => deps.onScores())
  box.appendChild(scores)
  if (showSwitch) {
    const sw = document.createElement('button'); sw.style.cssText = BTN; iconOrText(sw, 'hud.btn.switchTeam', 'switchTeam')
    sw.addEventListener('click', () => deps.onSwitch())
    box.appendChild(sw)
  }
  document.body.appendChild(box)
  const setActive = (v: boolean) => { scores.style.background = v ? 'rgba(80,110,200,.8)' : 'rgba(0,0,0,.55)' }
  return { setScoresActive: setActive }
}

/** Confirm box: Enter / Confirm button = accept, Esc / Cancel button = dismiss */
export function createConfirmPrompt() {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:40;color:#fff;font:16px monospace'
  const card = document.createElement('div')
  card.style.cssText = 'background:rgba(15,18,28,.95);border:1px solid #667;border-radius:10px;padding:18px 22px;display:flex;flex-direction:column;gap:14px;min-width:min(300px,80vw);max-width:90vw;box-sizing:border-box;text-align:center'
  const text = document.createElement('div')
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:center'
  const ok = document.createElement('button'); ok.textContent = IS_TOUCH ? stripKeyHint(t('hud.btn.confirm')) : t('hud.btn.confirm'); ok.style.cssText = BTN
  const no = document.createElement('button'); no.textContent = IS_TOUCH ? stripKeyHint(t('hud.btn.cancel')) : t('hud.btn.cancel'); no.style.cssText = BTN
  row.append(ok, no); card.append(text, row); el.appendChild(card)
  document.body.appendChild(el)
  let onYes: (() => void) | null = null
  const close = () => { el.style.display = 'none'; onYes = null }
  const yes = () => { const f = onYes; close(); f?.() }
  ok.addEventListener('click', yes); no.addEventListener('click', close)
  document.addEventListener('keydown', e => {
    if (!onYes) return
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); yes() }
    else if (e.code === 'Escape') { e.preventDefault(); close() }
  }, true)
  return {
    get isOpen(): boolean { return onYes !== null },
    open(message: string, confirm: () => void): void {
      text.textContent = message
      onYes = confirm
      el.style.display = 'flex'
      document.exitPointerLock?.()   // the pointer is needed to click the buttons
    },
    close,
  }
}

export function createToast() {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:35;color:#fff;font:15px monospace;background:rgba(0,0,0,.65);padding:6px 14px;border-radius:6px;pointer-events:none;display:none'
  document.body.appendChild(el)
  let timer = 0
  return (text: string) => {
    el.textContent = text; el.style.display = 'block'
    clearTimeout(timer); timer = window.setTimeout(() => { el.style.display = 'none' }, 3000)
  }
}

/** Above the weapon slots: "[E] Pick up AK47" while a dropped gun is in reach. On a phone (no E key) the prompt itself is the button. */
export function createPickupPrompt(onTap: () => void) {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;left:50%;bottom:${IS_TOUCH ? 110 : 128}px;transform:translateX(-50%);z-index:13;display:none;align-items:center;gap:8px;color:#fff;font:15px monospace;background:rgba(0,0,0,.6);padding:6px 12px;border-radius:6px;text-shadow:0 0 4px #000;pointer-events:${IS_TOUCH ? 'auto' : 'none'};touch-action:manipulation`
  const key = document.createElement('span')
  key.textContent = 'E'
  key.style.cssText = 'display:inline-block;min-width:22px;text-align:center;font-weight:bold;color:#000;background:#fff;border-radius:4px;padding:1px 6px'
  const label = document.createElement('span')
  el.append(key, label)
  el.addEventListener('pointerdown', e => { e.preventDefault(); onTap() })
  document.body.appendChild(el)
  let text: string | null = null
  return (next: string | null): void => {
    if (next === text) return
    text = next
    if (next === null) { el.style.display = 'none'; return }
    label.textContent = next
    el.style.display = 'flex'
  }
}

/** Top-right button: back to the room selection screen */
export function createLeaveButton(onClick: () => void): void {
  const b = document.createElement('button')
  b.style.cssText = BTN + ';position:fixed;right:12px;top:12px;z-index:30'
  iconOrText(b, 'hud.btn.backToLobby', 'close')
  b.addEventListener('click', onClick)
  document.body.appendChild(b)
}

/** Top-left, under the 2 buttons: "Elimination · Map · ROOM 1" + a button that copies the direct room link */
export function createRoomLabel(text: string, link: string | null, onCopied: () => void): void {
  const box = document.createElement('div')
  // Phone: below the two icon buttons, stacked and narrow so it stays clear of the match banner in the middle; z-index 24 = under the buy menu (25)
  box.style.cssText = IS_TOUCH
    ? `position:fixed;${TOUCH_HUD_SIDE}:12px;top:62px;z-index:24;max-width:150px;display:flex;flex-direction:column;gap:4px;align-items:${TOUCH_HUD_SIDE === 'left' ? 'flex-start' : 'flex-end'};color:#fff;font:11px monospace;text-shadow:0 0 4px #000`
    : 'position:fixed;left:12px;top:48px;z-index:30;display:flex;gap:8px;align-items:center;color:#fff;font:12px monospace;text-shadow:0 0 4px #000'
  const label = document.createElement('span'); label.textContent = text
  if (IS_TOUCH) label.style.cssText = 'max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
  box.append(label)
  if (link !== null) {   // offline has no room link
    const b = document.createElement('button'); b.textContent = t('hud.btn.copyLink'); b.style.cssText = BTN + (IS_TOUCH ? ';min-height:36px;padding:4px 10px;font-size:12px' : ';padding:2px 8px;font-size:11px')
    b.addEventListener('click', () => {
      void navigator.clipboard?.writeText(link).then(onCopied, () => {})
    })
    box.append(b)
  }
  document.body.appendChild(box)
}

/** Debug command box (dev build only): `/` opens, Enter sends, Esc closes */
export function createCommandBox(onSubmit: (cmd: string) => void) {
  const input = document.createElement('input')
  input.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);width:360px;z-index:45;display:none;padding:6px 10px;background:rgba(0,0,0,.8);color:#fff;border:1px solid #889;border-radius:6px;font:15px monospace'
  input.placeholder = '/endround A | /setround 9 | /time 10 | /money 16000 | /hp 30 | /kill | /zombie | /human | /wave 9 | /clearwave'
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { const v = input.value.trim(); close(); if (v) onSubmit(v) }
    else if (e.code === 'Escape') close()
  })
  document.body.appendChild(input)
  function close(): void { input.style.display = 'none'; input.blur(); input.value = '' }
  return {
    get isOpen(): boolean { return input.style.display !== 'none' },
    open(): void { input.style.display = 'block'; input.value = '/'; document.exitPointerLock?.(); input.focus() },
  }
}

/** Right-hand column under the killfeed (top:120px, at most 5 lines): holds the key hints and the offline bot panel */
// Phone: the column moves to the LEFT under the room label (290px down is the bottom of the screen, and the right edge belongs to the touch buttons).
// z-index 20 there: under the buy menu (24-26), whose first entries sit in the same corner and would otherwise lose their taps to the Bots button.
export function getRightColumn(): HTMLDivElement {
  let col = document.getElementById('hud-right-col') as HTMLDivElement | null
  if (!col) {
    col = document.createElement('div'); col.id = 'hud-right-col'
    col.style.cssText = `position:fixed;${IS_TOUCH ? `${TOUCH_HUD_SIDE}:12px;top:116px` : 'right:12px;top:290px'};z-index:${IS_TOUCH ? 20 : 25};display:flex;flex-direction:column;align-items:${IS_TOUCH && TOUCH_HUD_SIDE === 'left' ? 'flex-start' : 'flex-end'};gap:10px;pointer-events:none`
    document.body.appendChild(col)
  }
  return col
}

/** Key hints shown on the right while playing. `setItems` sets the list (key, action); `setHidden` hides it (e.g. while playing a zombie). */
export function createKeyHints() {
  const box = document.createElement('div')
  box.style.cssText = 'display:flex;flex-direction:column;gap:3px;align-items:flex-end;color:#fff;font:13px monospace;text-shadow:0 0 4px #000;pointer-events:none'
  getRightColumn().prepend(box)
  let key = ''
  let hidden = false
  return {
    setItems(items: readonly (readonly [string, string])[]): void {
      const k = items.map(i => i.join('|')).join(';')
      if (k === key) return
      key = k
      box.replaceChildren(...items.map(([label, code]) => {
        const row = document.createElement('div')
        row.style.cssText = 'background:rgba(0,0,0,.45);padding:2px 8px;border-radius:4px'
        row.textContent = `${label} (${code})`
        return row
      }))
    },
    setHidden(v: boolean): void { if (v !== hidden) { hidden = v; box.style.display = v ? 'none' : 'flex' } },
  }
}
