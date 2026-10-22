// Map materials (names + numbers only, no Three import). Map JSON declares each box with:
//   "texture": a class name ("brick" | "stone" | "concrete" | "plain"), or a type ("wall" | "floor" | "crate"), or an image file name ("concrete_2")
//   "variant": (optional) pick the nth image (from 1) in the class; omitted = chosen by box position (symmetric sides look the same)
//   "color":   (optional) "#rrggbb" — multiplied into the image (grey images like concrete change colour very visibly) or flat paint if the class is plain
// Images live in client/public/textures/<name>.jpg (source: assets/source/texture).
import type { MapBox } from './types'

export interface TextureClass {
  files: string[]   // file names (no extension) in client/public/textures
  tileM: number     // how many metres one repeat of the image covers
}

export const TEXTURE_CLASSES: Record<string, TextureClass> = {
  brick:    { files: ['brick_1'], tileM: 3 },                  // red brick
  stone:    { files: ['stone_1'], tileM: 2.5 },                // beige boulder stone
  concrete: { files: ['concrete_1', 'concrete_2'], tileM: 2 }, // grey concrete
  plain:    { files: [], tileM: 1 },                           // no image, just grid cells + colour
  greenfloor:    { files: ['greenfloor'], tileM: 1 },          // moss-green floor
}

export const FLOOR_COLOR = '#3d5a2a'   // moss green
export const CRATE_TYPE = 'crate'      // boxes of this type are drawn with the wooden crate model (collision/bullets still use the box)

// Legacy types → class + default colour
const TYPE_DEFAULTS: Record<string, { cls: string; color?: string }> = {
  wall:  { cls: 'concrete' },
  floor: { cls: 'plain', color: FLOOR_COLOR },
}

export interface BoxLook {
  crate: boolean
  file: string | null    // image used (no extension) or null = grid cells
  tileM: number
  color: string | null
}

function pickIndex(box: MapBox, n: number): number {
  if (box.variant !== undefined) return Math.max(0, Math.min(n - 1, Math.floor(box.variant) - 1))
  // |x| so a box and its mirror image pick the same image
  const h = Math.abs(Math.round(box.pos[0] * 7 + box.pos[1] * 13 * 7 + box.pos[2] * 31 * 7))
  return h % n
}

/** Convert a box's material declaration into what needs drawing. Unknown name → plain grid (no error). */
export function resolveBoxLook(box: MapBox): BoxLook {
  if (box.texture === CRATE_TYPE) return { crate: true, file: null, tileM: 1, color: box.color ?? null }
  const def = TYPE_DEFAULTS[box.texture]
  const cls = TEXTURE_CLASSES[def?.cls ?? box.texture]
  const color = box.color ?? def?.color ?? null
  if (cls) {
    const file = cls.files.length ? cls.files[pickIndex(box, cls.files.length)]! : null
    return { crate: false, file, tileM: cls.tileM, color }
  }
  for (const c of Object.values(TEXTURE_CLASSES)) {
    if (c.files.includes(box.texture)) return { crate: false, file: box.texture, tileM: c.tileM, color }
  }
  return { crate: false, file: null, tileM: 1, color }
}
