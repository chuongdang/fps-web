import { describe, it, expect } from 'vitest'
import { BUTTONS } from './buttons'
import { ICONS } from './icons'
import { buttonLook, type ButtonLook } from './style'

const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const lum = (r: number, g: number, b: number): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
/** WCAG contrast of the glyph over the fill, with the fill blended onto `bg` (a worst-case bright / dark world) */
function contrast(l: ButtonLook, bg: number): number {
  const fill = l.rgb.map(c => c * l.alpha + bg * (1 - l.alpha)) as [number, number, number]
  const a = lum(...fill), b = lum(...hex(l.fg))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('button colours', () => {
  for (const def of BUTTONS) {
    for (const on of [false, true]) {
      it(`${def.id} ${on ? 'on' : 'idle'}: the glyph stays readable (4.5:1) over a white and a black background`, () => {
        const l = buttonLook(def.id, on)
        expect(contrast(l, 255)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(l, 0)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
  it('an "on" button looks different from an idle one', () => {
    for (const def of BUTTONS) expect(buttonLook(def.id, true).rgb).not.toEqual(buttonLook(def.id, false).rgb)
  })
})

describe('icons', () => {
  it('every button has an icon, and none is a text glyph', () => {
    for (const def of BUTTONS) {
      const svg = ICONS[def.id]
      expect(svg, def.id).toBeTruthy()
      expect(svg, def.id).toMatch(/^<(path|circle|rect)/)
    }
  })
  it('icons use currentColor only (the button decides the colour)', () => {
    for (const [id, svg] of Object.entries(ICONS)) expect(svg, id).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i)
  })
})
