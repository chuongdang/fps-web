/** Same vertical limit as the mouse path in input.ts (just under straight up / down) */
export const PITCH_LIMIT = 1.553

/**
 * Drag-to-look. dxPx / dyPx: finger movement since the last event, in CSS px. `sensScale` is the ADS zoom factor
 * (the deeper the zoom the slower the camera), the same value the mouse uses. Signs match the mouse: dragging right turns
 * right (yaw decreases, because increasing yaw = turning left), dragging up looks up. Writes into `out`.
 */
export function lookStep(yaw: number, pitch: number, dxPx: number, dyPx: number, sens: number, sensScale: number, out: { yaw: number; pitch: number }): void {
  const k = sens * sensScale
  out.yaw = yaw - dxPx * k
  out.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - dyPx * k))
}
