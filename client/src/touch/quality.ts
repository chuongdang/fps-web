// Graphics quality on phones (plan 19, M.6): how many device pixels the renderer draws per CSS pixel.
// A phone reports devicePixelRatio 2-3, so drawing at the full ratio costs 4-9x the pixels of the desktop path (which stays at 1).
// The choice is saved and applied when the page loads (the lobby reloads the page after a change, like the language).

export type Quality = 'low' | 'medium' | 'high'
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high']
export const DEFAULT_QUALITY: Quality = 'medium'

/** Highest pixel ratio each level allows */
export const QUALITY_RATIO: Readonly<Record<Quality, number>> = { low: 1, medium: 1.5, high: 2 }

const STORE_KEY = 'fps.quality'

export const isQuality = (v: unknown): v is Quality => v === 'low' || v === 'medium' || v === 'high'

/** The renderer's pixel ratio: the device's own ratio, capped by the level, never below 1 */
export function pixelRatioFor(deviceRatio: number, q: Quality): number {
  const dpr = Number.isFinite(deviceRatio) && deviceRatio > 1 ? deviceRatio : 1
  return Math.min(dpr, QUALITY_RATIO[q])
}

/** `?quality=low|medium|high` (for a quick try) > the saved choice > the default */
export function readQuality(search: string, stored: string | null): Quality {
  const q = new URLSearchParams(search).get('quality')
  if (isQuality(q)) return q
  return isQuality(stored) ? stored : DEFAULT_QUALITY
}

export function getQuality(): Quality {
  let stored: string | null = null
  try { stored = localStorage.getItem(STORE_KEY) } catch { /* private mode: use the default */ }
  return readQuality(location.search, stored)
}

export function setQuality(q: Quality): void {
  try { localStorage.setItem(STORE_KEY, q) } catch { /* ignore */ }
}
