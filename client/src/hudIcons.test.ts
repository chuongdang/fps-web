import { describe, it, expect } from 'vitest'
import { HUD_ICONS, hudIconSvg, type HudIconName } from './hudIcons'

describe('hud icons', () => {
  const names = Object.keys(HUD_ICONS) as HudIconName[]
  it('each icon has markup and uses currentColor only', () => {
    expect(names.length).toBeGreaterThan(0)
    for (const n of names) {
      expect(HUD_ICONS[n], n).toMatch(/^<(path|circle|rect)/)
      expect(HUD_ICONS[n], n).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i)
    }
  })
  it('hudIconSvg wraps the markup in a 24x24 svg that screen readers skip', () => {
    const svg = hudIconSvg('close')
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).toContain('aria-hidden="true"')
  })
})
