import type { ButtonId } from './buttons'

// Touch button icons (plan 19, M.7). Hand-drawn, monochrome (`currentColor`), 24x24, so they look the same on iOS and Android.
// Unicode glyphs did not: emoji are colour and differ per OS, and some symbols are missing from Android fonts (empty boxes).
const S = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'
const F = 'fill="currentColor"'

/** Inner SVG markup per button (static strings, never player input) */
export const ICONS: Readonly<Record<ButtonId, string>> = {
  // bullet: pointed head over a separate casing
  fire: `<path ${F} d="M12 2C14.8 4.2 16 6.6 16 9.5V15H8V9.5C8 6.6 9.2 4.2 12 2Z"/><rect ${F} x="8" y="16.5" width="8" height="5.5" rx="1"/>`,
  // leaping figure, arms up, knees bent
  jump: `<circle ${F} cx="12" cy="4.5" r="2.1"/><path ${S} d="M12 8V14M12 9.5L7.5 6M12 9.5L16.5 6M12 14L8 16.5L8.5 20.5M12 14L16 16.5L15.5 20.5"/>`,
  // squatting figure (torso up, knees forward) with a down arrow
  crouch: `<circle ${F} cx="8.5" cy="5" r="2.1"/><path ${S} d="M8.5 8L7.5 14.5L14 15.5L12 21M9 10L13.5 12.5M19 6.5V14.5M16.3 12L19 14.7L21.7 12"/>`,
  // scope: ring with a crosshair that stops short of the middle
  aim: `<circle ${S} cx="12" cy="12" r="7"/><path ${S} d="M12 2V8M12 16V22M2 12H8M16 12H22"/><circle ${F} cx="12" cy="12" r="1.3"/>`,
  // circular arrow around a magazine
  reload: `<path ${S} d="M20 12A8 8 0 1 1 17.6 6.3"/><path ${S} d="M20.2 3.2V7.6H15.8"/><rect ${F} x="10" y="8.5" width="4" height="7.5" rx="1"/>`,
  // two opposite arrows
  last: `<path ${S} d="M4 8H19M15 4L19 8L15 12M20 16H5M9 12L5 16L9 20"/>`,
  // pineapple grenade: body, fuse cap, spoon and pin ring
  grenade: `<circle ${F} cx="11.5" cy="14.5" r="6.7"/><rect ${F} x="9.3" y="4.2" width="4.4" height="3.6" rx=".8"/><path ${S} d="M13.7 5.5H18L19.4 8.2"/><circle ${S} cx="20" cy="10" r="1.5"/>`,
  // arrow dropping into a tray
  drop: `<path ${S} d="M12 3V15M7 10.5L12 15.5L17 10.5M5 20.5H19"/>`,
  // torch: lamp head, body and switch
  flashlight: `<path ${F} d="M6.5 2.5H17.5L15 8H9Z"/><rect ${S} x="9.5" y="9.5" width="5" height="12" rx="1.5"/><circle ${F} cx="12" cy="13.5" r="1"/>`,
  // medical cross
  revive: `<path ${F} d="M9 3H15V9H21V15H15V21H9V15H3V9H9Z"/>`,
  // lightning bolt
  leap: `<path ${F} d="M13.5 2L4.5 13.5H10.5L9.5 22L19.5 10H13.5Z"/>`,
  // nose with scent waves
  sniff: `<path ${S} d="M9.5 3C9.5 8 7 11.5 6.5 15C6.2 17.3 8 19 10.5 19H12.3C13.8 19.6 15.4 19.2 16 18"/><path ${S} d="M19 8.5Q21 11 19 13.5M16.5 9.8Q17.8 11 16.5 12.2"/><circle ${F} cx="10.4" cy="16.4" r="1"/>`,
}

/** A ready-to-insert <svg> for a button */
export function iconSvg(id: ButtonId): string {
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">${ICONS[id]}</svg>`
}
