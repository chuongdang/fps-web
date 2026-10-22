// HUD icons as inline SVG (plan 19, M.7), for the places that used emoji or Unicode symbols: emoji are colour and look different on iOS,
// Android, Windows and macOS, and some symbols are missing from some fonts. Monochrome (`currentColor`), so the surrounding text colour applies.
import { ICONS } from './touch/icons'

export type HudIconName = 'trophy' | 'switchTeam' | 'close' | 'headshot' | 'zombie' | 'human' | 'heart' | 'dot' | 'sniff'

const S = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'
const F = 'fill="currentColor"'

/** Inner SVG markup per icon, 24x24 viewBox (static strings, never player input) */
export const HUD_ICONS: Readonly<Record<HudIconName, string>> = {
  trophy: `<path ${F} d="M7 3H17V9A5 5 0 0 1 7 9Z"/><path ${S} d="M7 5H4V7A3 3 0 0 0 7 10M17 5H20V7A3 3 0 0 1 17 10M12 14V18M8.5 21H15.5M9.5 18H14.5"/>`,
  switchTeam: `<path ${S} d="M4 11A8 8 0 0 1 18 6.5M20 3V7.5H15.5M20 13A8 8 0 0 1 6 17.5M4 21V16.5H8.5"/>`,
  close: `<path ${S} stroke-width="2.4" d="M5.5 5.5L18.5 18.5M18.5 5.5L5.5 18.5"/>`,
  // bullseye
  headshot: `<circle ${S} cx="12" cy="12" r="9"/><circle ${S} cx="12" cy="12" r="5"/><circle ${F} cx="12" cy="12" r="1.8"/>`,
  // stitched dead face: X eyes and a sewn mouth
  zombie: `<circle ${S} cx="12" cy="12" r="9.5"/><path ${S} stroke-width="1.7" d="M7.5 8.5L10.5 11.5M10.5 8.5L7.5 11.5M13.5 8.5L16.5 11.5M16.5 8.5L13.5 11.5M7.5 16H16.5M10 14.5V17.5M12 14.5V17.5M14 14.5V17.5"/>`,
  heart: `<path ${F} d="M12 21C5 15.5 3 11.5 3 8.5A4.5 4.5 0 0 1 12 6.5A4.5 4.5 0 0 1 21 8.5C21 11.5 19 15.5 12 21Z"/>`,
  // a filled round marker (alive / dead dots)
  dot: `<circle ${F} cx="12" cy="12" r="8"/>`,
  sniff: ICONS.sniff,   // same nose as the touch button
  human: `<circle ${F} cx="12" cy="6.5" r="3.4"/><path ${F} d="M5 21V18.5A5 5 0 0 1 10 13.5H14A5 5 0 0 1 19 18.5V21Z"/>`,
}

export function hudIconSvg(name: HudIconName): string {
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">${HUD_ICONS[name]}</svg>`
}

/** An inline icon that sits in a line of text like a character; `size` is its width and height (default: a bit taller than the text) */
export function hudIcon(name: HudIconName, size = '1.1em'): HTMLSpanElement {
  const s = document.createElement('span')
  s.style.cssText = `display:inline-block;width:${size};height:${size};vertical-align:-0.2em;line-height:0`
  s.innerHTML = hudIconSvg(name)   // static markup from this file
  return s
}
