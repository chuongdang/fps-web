import { t } from '../i18n'
import {
  TOUCH_HANDS, TOUCH_OPACITIES, TOUCH_SIZES, loadTouchPrefs, saveTouchPref,
  type TouchHand, type TouchOpacity, type TouchPrefs, type TouchSize,
} from './prefs'

const SELECT_CSS = 'font:16px sans-serif;padding:6px 8px;min-height:44px;border-radius:6px;background:#1c2028;color:#fff;border:1px solid #556;min-width:150px'

function row(label: string, sel: HTMLSelectElement): HTMLElement {
  const r = document.createElement('label')
  r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:14px;font:15px sans-serif'
  const span = document.createElement('span'); span.textContent = label
  r.append(span, sel)
  return r
}

function select<T extends string>(values: readonly T[], current: T, text: (v: T) => string, onChange: (v: T) => void): HTMLSelectElement {
  const sel = document.createElement('select')
  sel.style.cssText = SELECT_CSS
  for (const v of values) sel.add(new Option(text(v), v))
  sel.value = current
  sel.addEventListener('change', () => onChange(sel.value as T))
  return sel
}

/**
 * Phone lobby: a small "Controls" button (top-left) that opens a sheet with the touch control settings: button size, button opacity and
 * left/right hand (plan 19, M.7). Size and opacity apply the next time the game starts; a change of hand reloads the page on "Done",
 * because the HUD columns that stay clear of the buttons are built once at startup.
 */
export function createControlsSettings(extraCss = ''): HTMLButtonElement {
  const open = document.createElement('button')
  open.setAttribute('data-controls-open', '')
  open.textContent = t('lobby.controls')
  open.style.cssText = 'font:16px sans-serif;padding:3px 10px;min-height:32px;border-radius:6px;background:#1c2028;color:#fff;border:1px solid #556;' + extraCss
  open.addEventListener('click', () => {
    const start: TouchPrefs = loadTouchPrefs()
    const shade = document.createElement('div')
    shade.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;overflow:auto'
    const box = document.createElement('div')
    box.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:16px 18px;background:#12161d;border:1px solid #556;border-radius:10px;color:#fff;max-width:92vw'
    const title = document.createElement('div'); title.textContent = t('lobby.controls'); title.style.cssText = 'font:bold 17px sans-serif'
    const size = select<TouchSize>(TOUCH_SIZES, start.size, v => t(`lobby.controls.size.${v}`), v => saveTouchPref('size', v))
    const opacity = select<TouchOpacity>(TOUCH_OPACITIES, start.opacity, v => t(`lobby.controls.opacity.${v}`), v => saveTouchPref('opacity', v))
    const hand = select<TouchHand>(TOUCH_HANDS, start.hand, v => t(`lobby.controls.hand.${v}`), v => saveTouchPref('hand', v))
    const done = document.createElement('button')
    done.textContent = t('lobby.controls.done')
    done.style.cssText = 'font:16px sans-serif;padding:8px 14px;min-height:44px;border-radius:6px;background:#2a3550;color:#fff;border:1px solid #556'
    done.addEventListener('click', () => {
      shade.remove()
      if (loadTouchPrefs().hand !== start.hand) location.reload()
    })
    box.append(title, row(t('lobby.controls.size'), size), row(t('lobby.controls.opacity'), opacity), row(t('lobby.controls.hand'), hand), done)
    shade.append(box)
    document.body.appendChild(shade)
  })
  return open
}
