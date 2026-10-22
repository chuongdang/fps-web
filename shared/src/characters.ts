// Character set catalogue (ids only): each room picks one set at creation and the server tells every client via Welcome.
// Drawing lives in client/src/render/characters/ (one module per set); a new set = add an id here + one module there.
export const CHARACTER_SETS = ['saberDesert', 'copRobber', 'robot'] as const
export type CharacterSetId = (typeof CHARACTER_SETS)[number]
export const DEFAULT_CHARACTER_SET: CharacterSetId = 'saberDesert'

export function isCharacterSet(v: unknown): v is CharacterSetId {
  return typeof v === 'string' && (CHARACTER_SETS as readonly string[]).includes(v)
}
