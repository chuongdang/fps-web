// Per-player touch control preferences (plan 19, M.7): button size, button opacity and which hand holds the Fire side.
// Chosen in the lobby ("Controls"), saved in localStorage, read when the touch controls are laid out. A change of hand reloads the page
// (the HUD columns that must stay clear of the buttons are built once at startup), like the language and graphics selectors.

export type TouchSize = 'normal' | 'large' | 'xlarge'
export type TouchOpacity = 'low' | 'medium' | 'high'
export type TouchHand = 'right' | 'left'

export const TOUCH_SIZES: readonly TouchSize[] = ['normal', 'large', 'xlarge']
export const TOUCH_OPACITIES: readonly TouchOpacity[] = ['low', 'medium', 'high']
export const TOUCH_HANDS: readonly TouchHand[] = ['right', 'left']

/**
 * Multiplies the whole button layout (sizes and distances), so the arc keeps its shape. There is no "small": on a small phone the
 * default is already close to the 44 px minimum target, and a smaller layout would make the clamped buttons overlap.
 */
export const SIZE_SCALE: Readonly<Record<TouchSize, number>> = { normal: 1, large: 1.15, xlarge: 1.3 }

/** Opacity of an enabled button (a button that can do nothing right now is dimmed further) */
export const OPACITY_VALUE: Readonly<Record<TouchOpacity, number>> = { low: 0.6, medium: 0.8, high: 1 }

export interface TouchPrefs {
  size: TouchSize
  opacity: TouchOpacity
  hand: TouchHand
}

export const DEFAULT_PREFS: Readonly<TouchPrefs> = { size: 'normal', opacity: 'high', hand: 'right' }

const KEYS = { size: 'fps.touch.size', opacity: 'fps.touch.opacity', hand: 'fps.touch.hand' } as const

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

/** Turns whatever was stored into valid prefs: anything unknown falls back to the default */
export function parsePrefs(raw: { size: string | null; opacity: string | null; hand: string | null }): TouchPrefs {
  return {
    size: isOneOf(TOUCH_SIZES, raw.size) ? raw.size : DEFAULT_PREFS.size,
    opacity: isOneOf(TOUCH_OPACITIES, raw.opacity) ? raw.opacity : DEFAULT_PREFS.opacity,
    hand: isOneOf(TOUCH_HANDS, raw.hand) ? raw.hand : DEFAULT_PREFS.hand,
  }
}

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }   // private mode: use the default
}

export function loadTouchPrefs(): TouchPrefs {
  return parsePrefs({ size: read(KEYS.size), opacity: read(KEYS.opacity), hand: read(KEYS.hand) })
}

export function saveTouchPref<K extends keyof TouchPrefs>(key: K, value: TouchPrefs[K]): void {
  try { localStorage.setItem(KEYS[key], value) } catch { /* ignore */ }
}
