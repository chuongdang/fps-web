import type { ButtonId } from './buttons'

// Colours of the touch buttons (plan 19, M.7). The first version drew the "on" state as a 50% white fill under a white glyph, so a
// toggled button became harder to read, and the idle fill (32% dark) vanished against sky and sand. Idle buttons are now darker with a
// shadow; an "on" button is a near-opaque light fill with a dark glyph.
export interface ButtonLook {
  /** rgb of the fill and its alpha (kept apart so a test can check the contrast over a worst-case bright background) */
  rgb: readonly [number, number, number]
  alpha: number
  /** glyph colour */
  fg: string
  border: string
}

const IDLE: ButtonLook = { rgb: [12, 16, 22], alpha: 0.6, fg: '#ffffff', border: 'rgba(255,255,255,0.75)' }
const IDLE_FIRE: ButtonLook = { rgb: [120, 15, 15], alpha: 0.7, fg: '#ffffff', border: 'rgba(255,110,110,0.95)' }
const ON: ButtonLook = { rgb: [255, 205, 70], alpha: 0.95, fg: '#1a1408', border: 'rgba(255,255,255,0.95)' }
const ON_FIRE: ButtonLook = { rgb: [210, 30, 30], alpha: 0.95, fg: '#ffffff', border: 'rgba(255,255,255,0.95)' }

export function buttonLook(id: ButtonId, on: boolean): ButtonLook {
  if (id === 'fire') return on ? ON_FIRE : IDLE_FIRE
  return on ? ON : IDLE
}

export const lookFill = (l: ButtonLook): string => `rgba(${l.rgb[0]},${l.rgb[1]},${l.rgb[2]},${l.alpha})`

/** Soft shadow so a button stays visible on any background */
export const BUTTON_SHADOW = '0 2px 8px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.35)'
