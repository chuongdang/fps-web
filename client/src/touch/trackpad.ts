// Mouse / trackpad on a device without Pointer Lock (iPad Safari with a Magic Keyboard or any Bluetooth mouse).
// The cursor cannot be captured there, so moving it cannot turn the camera. A two-finger swipe sends wheel events and the
// cursor stays put, so that is the look input.

const LINE_PX = 16       // WheelEvent.deltaMode 1 (lines)
/** One event can never turn more than this many px worth (a mouse wheel notch in "lines" mode or a glitch) */
export const MAX_WHEEL_PX = 120

/**
 * Wheel event -> finger-drag-like pixel delta for `lookStep` (positive dx turns right, positive dy looks down).
 * iPadOS defaults to "natural scrolling", which reports the opposite sign of the finger movement, so the deltas are negated.
 * Writes into `out` (no allocation).
 */
export function wheelLook(deltaX: number, deltaY: number, deltaMode: number, pageHeightPx: number, out: { dx: number; dy: number }): void {
  const unit = deltaMode === 1 ? LINE_PX : deltaMode === 2 ? pageHeightPx : 1
  out.dx = clamp(-deltaX * unit)
  out.dy = clamp(-deltaY * unit)
}

function clamp(v: number): number { return Math.max(-MAX_WHEEL_PX, Math.min(MAX_WHEEL_PX, v)) }
