// Weapon icon: prefer a PNG (rendered from the model by tools/blender/render_icon.py), else a placeholder SVG, else plain text.
import { t } from './i18n'

const BASE = '/icons/weapons/'

export function weaponIcon(key: string, name: string, css = ''): HTMLElement {
  const img = document.createElement('img')
  img.alt = name
  img.draggable = false
  const file = key === 'smoke' ? 'm67' : key   // smoke has no icon of its own yet: use the M67 icon turned grey
  img.style.cssText = 'object-fit:contain;pointer-events:none;' + (key === 'smoke' ? 'filter:grayscale(1) brightness(1.25);' : '') + css
  let stage = 0
  img.addEventListener('error', () => {
    stage++
    if (stage === 1) img.src = `${BASE}${file}.svg`
    else {
      const t = document.createElement('span')
      t.textContent = name
      t.style.cssText = 'font:bold 11px sans-serif;color:#fff;text-align:center;' + css
      img.replaceWith(t)
    }
  })
  img.src = `${BASE}${file}.png`
  return img
}

/** Localized weapon name for the UI (falls back to `fallback`, e.g. the WeaponDef name, when there is no translation) */
export function weaponLabel(key: string, fallback = key): string {
  const k = `weapon.${key}`
  const s = t(k)
  return s === k ? fallback : s
}
