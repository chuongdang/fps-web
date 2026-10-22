import { describe, it, expect } from 'vitest'
import { Btn, WEAPONS, weaponByKey } from '@fps/shared'
import { BUTTONS, abilitiesOf, MIN_BUTTON_PX, MIN_CLEAR_BOTTOM, layoutShort, placeButtons, type ButtonId, type TouchContext } from './buttons'
import { SIZE_SCALE, TOUCH_SIZES } from './prefs'

const base: TouchContext = { live: true, human: true, ability: 'none', sniff: false, flashlight: false }
const ids = (ctx: TouchContext, w = 844, h = 390): ButtonId[] => placeButtons(ctx, w, h).map(p => p.def.id)

describe('which buttons show in which situation', () => {
  it('a human in a normal mode: fire, aim, jump, crouch, reload, last weapon and grenade', () => {
    expect(ids(base).sort()).toEqual(['aim', 'crouch', 'fire', 'grenade', 'jump', 'last', 'reload'])
  })
  it('the last-weapon button is a tap action for humans only (a zombie has no weapons to swap)', () => {
    const last = BUTTONS.find(b => b.id === 'last')!
    expect(last.mode).toBe('tap'); expect(last.action).toBe('lastWeapon')
    expect(ids({ live: true, human: false, ability: 'none', sniff: false, flashlight: false })).not.toContain('last')
  })
  it('nothing at all while dead or spectating', () => {
    expect(ids({ ...base, live: false, flashlight: true, ability: 'revive' })).toEqual([])
  })
  it('the flashlight button only exists when the flashlight does (night, human)', () => {
    expect(ids({ ...base, flashlight: true })).toContain('flashlight')
    expect(ids(base)).not.toContain('flashlight')
  })
  it('Defense: humans get Revive (the E key), not the zombie leap', () => {
    const r = ids({ ...base, ability: 'revive' })
    expect(r).toContain('revive')
    expect(r).not.toContain('leap')
  })
  it('a zombie has no reload or grenade; it gets leap, and sniff only in Infection', () => {
    const z = ids({ live: true, human: false, ability: 'leap', sniff: false, flashlight: false })
    expect(z).not.toContain('reload'); expect(z).not.toContain('grenade'); expect(z).toContain('leap'); expect(z).not.toContain('sniff')
    expect(ids({ live: true, human: false, ability: 'leap', sniff: true, flashlight: false })).toContain('sniff')
  })
  it('a zombie still can attack (fire = claw, aim = heavy claw), jump and crouch', () => {
    const z = ids({ live: true, human: false, ability: 'none', sniff: false, flashlight: false })
    expect(z.sort()).toEqual(['aim', 'crouch', 'fire', 'jump'])
  })
})

describe('what each button sends', () => {
  const bit = (id: ButtonId): number => BUTTONS.find(b => b.id === id)!.bit
  it('maps to the same Btn bits as the keyboard keys', () => {
    expect(bit('fire')).toBe(Btn.Fire); expect(bit('aim')).toBe(Btn.Aim); expect(bit('jump')).toBe(Btn.Jump)
    expect(bit('crouch')).toBe(Btn.Crouch); expect(bit('reload')).toBe(Btn.Reload); expect(bit('grenade')).toBe(Btn.QuickNade)
    expect(bit('revive')).toBe(Btn.Ability); expect(bit('leap')).toBe(Btn.Ability); expect(bit('sniff')).toBe(Btn.Sniff)
  })
  it('aim and crouch toggle (a thumb cannot hold them while firing and jumping); the others are held; the flashlight is a tap', () => {
    const mode = (id: ButtonId) => BUTTONS.find(b => b.id === id)!.mode
    expect(mode('aim')).toBe('toggle'); expect(mode('crouch')).toBe('toggle')
    expect(mode('fire')).toBe('hold'); expect(mode('jump')).toBe('hold'); expect(mode('reload')).toBe('hold'); expect(mode('grenade')).toBe('hold')
    expect(mode('flashlight')).toBe('tap')
  })
  it('ids are unique', () => {
    expect(new Set(BUTTONS.map(b => b.id)).size).toBe(BUTTONS.length)
  })
})

describe('size', () => {
  it('Fire is the biggest button but at most a fifth of the short side on a phone; the rest are smaller still', () => {
    const placed = placeButtons({ ...base, flashlight: true, ability: 'revive' }, 844, 390)
    const fire = placed.find(p => p.def.id === 'fire')!
    expect(fire.d).toBeLessThanOrEqual(390 * 0.2)
    for (const p of placed) if (p !== fire) expect(p.d).toBeLessThan(fire.d)
  })
  it('a tablet gets phone-sized buttons (a thumb does not grow with the screen)', () => {
    const phone = placeButtons(base, 844, 390).find(p => p.def.id === 'fire')!
    const tablet = placeButtons(base, 1024, 768).find(p => p.def.id === 'fire')!
    expect(tablet.d).toBeLessThanOrEqual(phone.d * 1.3)
  })
})

describe('layout on real phone sizes (landscape)', () => {
  const screens: [string, number, number][] = [
    ['iPhone SE (1st gen)', 568, 320], ['iPhone SE / 8', 667, 375], ['iPhone 14', 844, 390], ['iPhone 14 Pro Max', 932, 430],
    ['Android 360x800 landscape', 800, 360], ['iPad', 1024, 768],
  ]
  const contexts: [string, TouchContext][] = [
    ['human', base],
    ['human, night, defense (everything)', { live: true, human: true, ability: 'revive', sniff: false, flashlight: true }],
    ['human, deathmatch (drop)', { live: true, human: true, ability: 'none', sniff: false, flashlight: false, drops: true }],
    ['zombie, infection', { live: true, human: false, ability: 'leap', sniff: true, flashlight: false }],
  ]
  for (const [sn, w, h] of screens) {
    for (const [cn, ctx] of contexts) {
     for (const size of TOUCH_SIZES) {
      it(`${sn}: ${cn}, size ${size}: no two buttons overlap, all fully on screen, none below ${MIN_BUTTON_PX}px`, () => {
        const placed = placeButtons(ctx, w, h, SIZE_SCALE[size])
        for (const p of placed) {
          expect(p.d).toBeGreaterThanOrEqual(MIN_BUTTON_PX)
          expect(p.right).toBeGreaterThanOrEqual(0)
          expect(p.bottom, `${p.def.id} stays clear of the bottom strip`).toBeGreaterThanOrEqual(layoutShort(w, h) * MIN_CLEAR_BOTTOM / 100)
          expect(w - (p.right + p.d)).toBeGreaterThanOrEqual(0)   // left edge on screen
          expect(h - (p.bottom + p.d)).toBeGreaterThanOrEqual(0)  // top edge on screen
        }
        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) {
            const a = placed[i]!, b = placed[j]!
            const dist = Math.hypot((a.right + a.d / 2) - (b.right + b.d / 2), (a.bottom + a.d / 2) - (b.bottom + b.d / 2))
            expect(dist, `${a.def.id} vs ${b.def.id}`).toBeGreaterThanOrEqual((a.d + b.d) / 2)
          }
        }
      })
     }
    }
  }
  it('the Drop button exists only for a live human in a room that allows drops', () => {
    expect(ids(base)).not.toContain('drop')
    expect(ids({ ...base, drops: true })).toContain('drop')
    expect(ids({ ...base, drops: true, human: false })).not.toContain('drop')
    expect(ids({ ...base, drops: true, live: false })).not.toContain('drop')
  })
  it('secondary buttons fill the outer arc in visible order, grenade first (no gap when one is missing)', () => {
    const withLight = placeButtons({ ...base, flashlight: true }, 844, 390).filter(p => p.def.secondary)
    expect(withLight.map(p => p.def.id)).toEqual(['grenade', 'last', 'flashlight'])
    const noLight = placeButtons(base, 844, 390).filter(p => p.def.secondary)
    expect(noLight.map(p => p.def.id)).toEqual(['grenade', 'last'])
    expect(noLight[1]!.right).toBeCloseTo(withLight[1]!.right)   // the last-weapon button does not move when the flashlight appears
  })
  it('every secondary button is a thumb slide from Fire (within 42 vmin of its centre), none farther than the old straight row', () => {
    const placed = placeButtons({ ...base, flashlight: true, ability: 'revive', drops: true }, 844, 390)
    const fire = placed.find(p => p.def.id === 'fire')!
    const sec = placed.filter(p => p.def.secondary)
    expect(sec).toHaveLength(5)
    for (const p of sec) {
      const dist = Math.hypot((p.right + p.d / 2) - (fire.right + fire.d / 2), (p.bottom + p.d / 2) - (fire.bottom + fire.d / 2))
      expect(dist, p.def.id).toBeLessThanOrEqual(390 * 0.42)
    }
  })
  it('the size setting grows the whole layout around the corner (positions and sizes), and normal is the plain layout', () => {
    const at = (k: number) => placeButtons(base, 844, 390, k).find(p => p.def.id === 'fire')!
    expect(at(1)).toEqual(placeButtons(base, 844, 390).find(p => p.def.id === 'fire')!)
    expect(at(1.3).d).toBeCloseTo(at(1).d * 1.3)
    expect(at(1.3).right).toBeGreaterThan(at(1).right)
  })
  it('Fire is the only button that turns the camera when dragged', () => {
    expect(BUTTONS.filter(b => b.dragLook).map(b => b.id)).toEqual(['fire'])
  })
})

describe('weapon abilities dim buttons (never hide them)', () => {
  const ab = (key: string) => abilitiesOf(weaponByKey(key)!)
  const enabled = (ctx: TouchContext, id: ButtonId) => placeButtons(ctx, 844, 390).find(p => p.def.id === id)!.enabled

  it('knife: no zoom, no reload, nothing to drop', () => {
    expect(ab('knife')).toEqual({ aim: false, reload: false, drop: false })
  })
  it('rifles and the sniper zoom; pistols and the shotgun do not, but they all reload and can be dropped', () => {
    for (const k of ['ak47', 'm16', 'sniper', 'colt', 'rulo']) expect(ab(k).aim, k).toBe(true)
    expect(ab('shotgun')).toEqual({ aim: false, reload: true, drop: true })
    expect(ab('smg')).toEqual({ aim: false, reload: true, drop: true })
    for (const k of ['ak47', 'm16', 'sniper', 'colt', 'rulo']) { expect(ab(k).reload, k).toBe(true); expect(ab(k).drop, k).toBe(true) }
  })
  it('grenades: Aim is the low throw, but no reload and no drop', () => {
    for (const k of ['m67', 'smoke']) expect(ab(k)).toEqual({ aim: true, reload: false, drop: false })
  })
  it('the grenade button is dimmed with no grenade to throw, or when one is already in hand (Fire throws it)', () => {
    expect(enabled(base, 'grenade')).toBe(true)   // unset = enabled
    expect(enabled({ ...base, canGrenade: true }, 'grenade')).toBe(true)
    expect(enabled({ ...base, canGrenade: false }, 'grenade')).toBe(false)
    expect(ids({ ...base, canGrenade: false })).toContain('grenade')   // still on screen: the row does not shift
  })
  it('every weapon has a defined answer and a held button stays shown', () => {
    for (const w of WEAPONS) expect(Object.keys(abilitiesOf(w))).toHaveLength(3)
    const knife = { ...base, drops: true, canAim: false, canReload: false, canDrop: false }
    expect(ids(knife)).toEqual(expect.arrayContaining(['aim', 'reload', 'drop']))   // same buttons as with a rifle: the layout does not jump
    expect(enabled(knife, 'aim')).toBe(false); expect(enabled(knife, 'reload')).toBe(false); expect(enabled(knife, 'drop')).toBe(false)
    expect(enabled(knife, 'fire')).toBe(true); expect(enabled(knife, 'jump')).toBe(true); expect(enabled(knife, 'crouch')).toBe(true)
    expect(enabled({ ...base, drops: true }, 'aim')).toBe(true)   // unset = enabled
  })
})
