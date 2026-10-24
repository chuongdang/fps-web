import { CHARACTER_SETS, DEFAULT_CHARACTER_SET, type CharacterSetId } from '@fps/shared'
import { blocky } from './blocky'
import { robot } from './robot'
import type { CharacterSet } from './types'

// Character set registry. To add a set: add the id to CHARACTER_SETS (shared) + a module + one line here.
// Cops & Terrorists is skinned (characterRig.ts); the blocky boxes are only a fallback when the glb fails or with ?blocky=1
const REGISTRY: Record<CharacterSetId, CharacterSet> = { copsTerrorists: blocky, robot }

export function getCharacterSet(id: string): CharacterSet {
  return REGISTRY[id as CharacterSetId] ?? REGISTRY[DEFAULT_CHARACTER_SET]
}

export const characterSetList: CharacterSet[] = CHARACTER_SETS.map(id => REGISTRY[id])
export type { CharacterRig, CharacterSet } from './types'
export { disposeRig } from './kit'
