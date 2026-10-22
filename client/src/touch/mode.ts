import { isTouchMode, readTouchEnv } from './detect'
import { loadTouchPrefs } from './prefs'

/** True on a phone / tablet without a mouse (plan 19). Safe to import anywhere: it needs no DOM until the page marks <html class="touch">. */
export const IS_TOUCH: boolean = isTouchMode(readTouchEnv())

/** The edge of the screen where the HUD columns (room label, bot panel) go on a phone: the side opposite the action buttons, so it follows the player's hand setting. Read at startup. */
export const TOUCH_HUD_SIDE: 'left' | 'right' = IS_TOUCH && loadTouchPrefs().hand === 'left' ? 'right' : 'left'
export const LEFT_HANDED: boolean = TOUCH_HUD_SIDE === 'right'

// CSS hooks for touch-only sizing (buy menu, bot panel): `html.touch .something { ... }`
if (IS_TOUCH && typeof document !== 'undefined') document.documentElement.classList.add('touch')
// shop.ts moves the cart to the right edge for a left-handed player: the Fire arc sits where it is
if (LEFT_HANDED && typeof document !== 'undefined') document.documentElement.classList.add('hand-left')
// iOS Safari ignores user-scalable=no: block the pinch gesture itself
if (IS_TOUCH && typeof document !== 'undefined') document.addEventListener('gesturestart', e => e.preventDefault())
