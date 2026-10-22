import { Btn, isDroppable, type WeaponDef } from '@fps/shared'

/**
 * What decides which action buttons make sense right now. main.ts fills one reusable object and passes it every frame
 * (no allocation), so keep this a plain flat record.
 */
export interface TouchContext {
  /** playing: alive and not spectating. Nothing is shown while dead / spectating. */
  live: boolean
  /** human (has a weapon, reload, grenades) rather than a zombie player */
  human: boolean
  /** the E key: zombie leap, or reviving a downed teammate in Defense. None in the other modes. */
  ability: 'none' | 'leap' | 'revive'
  /** zombie sniff (Infection) */
  sniff: boolean
  /** night room and we are a human: the flashlight exists */
  flashlight: boolean
  /** the room lets players drop and pick up guns (Team Deathmatch, Elimination): the Drop button exists. Picking up is the "Pick up" prompt. */
  drops?: boolean
  /** What the held weapon can do (see abilitiesOf). A button whose ability is missing stays on screen but dimmed and dead, so the layout never jumps when you switch weapons. Missing = true. */
  canAim?: boolean
  canReload?: boolean
  canDrop?: boolean
  /** the quick-grenade button: we carry a grenade and are not already holding one (then Fire throws it). Missing = true. */
  canGrenade?: boolean
}

export interface WeaponAbilities { aim: boolean; reload: boolean; drop: boolean }

/** Which weapon-dependent buttons make sense for `def`: no zoom on a knife or shotgun, no reload on a knife or grenade, nothing to drop for a knife or grenade. */
export function abilitiesOf(def: WeaponDef): WeaponAbilities {
  const grenade = !!def.consumable
  return {
    aim: !!def.ads || grenade || def.category === 'claw',   // grenade: Aim = low throw; zombie claw: Aim = heavy claw
    reload: def.magSize > 0 && !def.melee && !grenade,
    drop: isDroppable(def),
  }
}

export type ButtonId = 'fire' | 'aim' | 'jump' | 'crouch' | 'reload' | 'last' | 'grenade' | 'drop' | 'flashlight' | 'revive' | 'leap' | 'sniff'

/** What a 'tap' button does */
export type TapAction = 'flashlight' | 'lastWeapon' | 'dropWeapon'

/**
 * hold:   the button bit is sent while the finger is down (like holding the key)
 * toggle: a tap switches it on / off (aim, crouch: a thumb can not hold them while it also fires and jumps)
 * tap:    a tap calls an action once (flashlight)
 */
export type ButtonMode = 'hold' | 'toggle' | 'tap'

export interface ButtonDef {
  id: ButtonId
  mode: ButtonMode
  /** the Btn bit it sends; 0 for a tap action */
  bit: number
  /** only for mode 'tap' */
  action?: TapAction
  /** a finger that is held on this button and drags also turns the camera (Fire: shoot while you aim) */
  dragLook?: boolean
  /** primary buttons have a fixed spot; secondary ones are lined up in a row, in the order they are visible */
  secondary: boolean
  /** centre, in vmin (1% of the shorter screen side) from the right and bottom edges, and diameter in vmin */
  cx: number
  cy: number
  d: number
  visible(ctx: Readonly<TouchContext>): boolean
  /** shown but dimmed and ignoring touches when false (default: always enabled) */
  enabled?(ctx: Readonly<TouchContext>): boolean
}

// Right-thumb layout, modelled on CoD Mobile / PUBG Mobile: one medium Fire button low in the corner (the resting spot of the thumb) and
// the other actions fanned out on an arc around it, so each is one short slide away and the look area to the left stays free.
// Positions are for a 844x390 phone in landscape; every size scales with the short side (capped, see LAYOUT_MAX_SHORT_PX).
// Nothing sits in the bottom MIN_CLEAR_BOTTOM vmin: the offline-only bot panel and the ammo readout live there, and a touch near a real
// HUD <button> is snapped onto it by the browser, so a touch button underneath would lose its taps.
// Arc (centre = Fire at 16/30 vmin, radius 23.5 vmin), from straight up to the left:  0° Jump · 35° Aim · 70° Reload · 105° Crouch.
// Secondary buttons (grenade, last weapon, drop, flashlight, ability, sniff) sit on a second, outer arc around Fire (radius 40 vmin, from
// 10° in steps of 22°), grenade first because it is the one used most: every one of them is still a thumb slide from Fire, where the old
// straight row above Jump was a stretch. They are packed in visible order, so a missing button leaves no gap.
const FIRE_CX = 16, FIRE_CY = 30
const SECONDARY_D = 10.5, SECONDARY_R = 40, SECONDARY_A0 = 10, SECONDARY_STEP = 22
const SECONDARY_CY = 0   // placeholder: placeButtons() computes the spot of a secondary button

export const BUTTONS: readonly ButtonDef[] = [
  { id: 'fire',       mode: 'hold',   bit: Btn.Fire,      secondary: false, cx: FIRE_CX, cy: FIRE_CY, d: 17, dragLook: true, visible: c => c.live },
  { id: 'jump',       mode: 'hold',   bit: Btn.Jump,      secondary: false, cx: 16,   cy: 53.5,   d: 12.5, visible: c => c.live },
  { id: 'aim',        mode: 'toggle', bit: Btn.Aim,       secondary: false, cx: 29.5, cy: 49.3, d: 12,   visible: c => c.live, enabled: c => c.canAim !== false },
  { id: 'reload',     mode: 'hold',   bit: Btn.Reload,    secondary: false, cx: 38.1, cy: 38,   d: 11,   visible: c => c.live && c.human, enabled: c => c.canReload !== false },
  { id: 'crouch',     mode: 'toggle', bit: Btn.Crouch,    secondary: false, cx: 38.7, cy: 23.9, d: 11,   visible: c => c.live },
  { id: 'grenade',    mode: 'hold',   bit: Btn.QuickNade, secondary: true,  cx: 0,  cy: SECONDARY_CY, d: SECONDARY_D, visible: c => c.live && c.human, enabled: c => c.canGrenade !== false },
  { id: 'last',       mode: 'tap',    bit: 0,             action: 'lastWeapon', secondary: true,  cx: 0, cy: SECONDARY_CY, d: SECONDARY_D, visible: c => c.live && c.human },
  { id: 'drop',       mode: 'tap',    bit: 0,             action: 'dropWeapon', secondary: true,  cx: 0,  cy: SECONDARY_CY, d: SECONDARY_D, visible: c => c.live && c.human && !!c.drops, enabled: c => c.canDrop !== false },
  { id: 'flashlight', mode: 'tap',    bit: 0,             action: 'flashlight', secondary: true,  cx: 0,  cy: SECONDARY_CY, d: SECONDARY_D, visible: c => c.live && c.flashlight },
  { id: 'revive',     mode: 'hold',   bit: Btn.Ability,   secondary: true,  cx: 0,  cy: SECONDARY_CY, d: SECONDARY_D, visible: c => c.live && c.human && c.ability === 'revive' },
  { id: 'leap',       mode: 'hold',   bit: Btn.Ability,   secondary: true,  cx: 0,  cy: SECONDARY_CY, d: SECONDARY_D, visible: c => c.live && !c.human && c.ability === 'leap' },
  { id: 'sniff',      mode: 'hold',   bit: Btn.Sniff,     secondary: true,  cx: 0,  cy: SECONDARY_CY, d: SECONDARY_D, visible: c => c.live && !c.human && c.sniff },
]

/** No action button reaches into the bottom strip of the screen (vmin of the short side) */
export const MIN_CLEAR_BOTTOM = 14

/** A touch target is never smaller than this (CSS px), whatever the screen size */
export const MIN_BUTTON_PX = 44

/** On a tablet the buttons are sized as if the short side were this many px: a thumb does not grow with the screen, and the HUD around them is fixed-size */
export const LAYOUT_MAX_SHORT_PX = 480

/** The length that "vmin" means for the button layout */
export const layoutShort = (width: number, height: number): number => Math.min(width, height, LAYOUT_MAX_SHORT_PX)

export interface PlacedButton {
  def: ButtonDef
  enabled: boolean
  /** diameter in CSS px */
  d: number
  /** distance from the thumb-side (right; left for a left-handed player, the caller mirrors) / bottom screen edge to the button's near side, in CSS px (add the safe-area inset in CSS) */
  right: number
  bottom: number
}

/** Centre of the secondary button in `slot`, in vmin from the thumb-side and bottom edges */
export function secondarySpot(slot: number): { cx: number; cy: number } {
  const a = (SECONDARY_A0 + SECONDARY_STEP * slot) * Math.PI / 180
  return { cx: FIRE_CX + SECONDARY_R * Math.sin(a), cy: FIRE_CY + SECONDARY_R * Math.cos(a) }
}

/**
 * The buttons to show for this context, with their pixel placement. Secondary buttons fill the outer arc in visible order.
 * `scale` (the player's button-size setting, >= 1) grows the whole layout around the corner, so the arc keeps its shape.
 */
export function placeButtons(ctx: Readonly<TouchContext>, width: number, height: number, scale = 1): PlacedButton[] {
  const short = layoutShort(width, height) * scale
  const out: PlacedButton[] = []
  let slot = 0
  for (const def of BUTTONS) {
    if (!def.visible(ctx)) continue
    const spot = def.secondary ? secondarySpot(slot++) : def
    const d = Math.max(MIN_BUTTON_PX, def.d / 100 * short)
    out.push({ def, enabled: def.enabled ? def.enabled(ctx) : true, d, right: spot.cx / 100 * short - d / 2, bottom: spot.cy / 100 * short - d / 2 })
  }
  return out
}
