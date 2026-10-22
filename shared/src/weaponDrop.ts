// Dropping and picking up guns (Counter-Strike style: G drops the held gun, E picks up the nearest one, a dead player drops their gun).
// All numbers live here. The server decides everything; the client only simulates the flight of a dropped gun with the grenade physics
// (shared/grenadePhysics.ts) so server and client agree on where it comes to rest.
import type { Vec3 } from './math'
import type { GameMode } from './roomConfig'
import type { WeaponDef } from './weapons'

export const WEAPON_DROP = {
  modes: ['tdm', 'elimination'] as readonly GameMode[],   // zombie modes keep weapons on death and forbid picking up guns (plan 16)
  reachRadius: 1.6,        // m, horizontal distance from the player to the gun
  reachBelow: 1.0,         // m, how far below the player's feet a gun can still be reached
  reachAbove: 1.8,         // m, how far above the player's feet
  lifetimeMs: 60_000,      // a gun nobody picks up disappears after this
  maxPerRoom: 24,          // the oldest gun is removed first
  throwSpeed: 3.5,         // m/s forward when dropping
  throwUp: 1.5,            // m/s upward when dropping
  inheritVelocity: 0.5,    // adds 50% of the dropper's velocity
  ownerLockMs: 700,        // whoever dropped a gun cannot pick that same gun up again right away
  maxActionsPerSecond: 5,  // drop + pickup commands per player (spam limit)
}

export function dropsEnabled(mode: GameMode): boolean {
  return WEAPON_DROP.modes.includes(mode)
}

/** Only real guns can be dropped: not the knife, not grenades (consumables), not zombie claws */
export function isDroppable(def: WeaponDef): boolean {
  return !def.consumable && !def.melee && (def.category === 'pistol' || def.category === 'mid' || def.category === 'long')
}

/** Can a player standing at `playerPos` (feet) pick up a gun lying at `dropPos`? */
export function inPickupReach(playerPos: Vec3, dropPos: Vec3): boolean {
  const dy = dropPos[1] - playerPos[1]
  if (dy < -WEAPON_DROP.reachBelow || dy > WEAPON_DROP.reachAbove) return false
  const dx = dropPos[0] - playerPos[0], dz = dropPos[2] - playerPos[2]
  return dx * dx + dz * dz <= WEAPON_DROP.reachRadius * WEAPON_DROP.reachRadius
}

/** Horizontal distance squared (to pick the nearest gun) */
export function dropDistSq(playerPos: Vec3, dropPos: Vec3): number {
  const dx = dropPos[0] - playerPos[0], dz = dropPos[2] - playerPos[2]
  return dx * dx + dz * dz
}
