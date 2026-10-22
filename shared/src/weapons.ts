import { GRENADE, SMOKE, makeThrowState, type ThrowState } from './grenade'

export type WeaponCategory = 'claw' | 'knife' | 'pistol' | 'mid' | 'long' | 'grenade'
/** Weapon slot (keys 1–5) of each category. Slot 5 = grenade (consumable, not counted among the 4 gun categories) */
export const CATEGORY_SLOT: Record<WeaponCategory, 0 | 1 | 2 | 3 | 4> = { claw: 0, knife: 0, pistol: 1, mid: 2, long: 3, grenade: 4 }
export const CATEGORY_LABEL: Record<WeaponCategory, string> = {
  claw: 'Claws', knife: 'Knife', pistol: 'Pistol', mid: 'Mid-range', long: 'Rifle', grenade: 'Grenade',
}
export const SLOT_COUNT = 5
/** Grenade slot */
export const GRENADE_SLOT = CATEGORY_SLOT.grenade
/** Default slot on respawn / entering a match: long gun (slot 4 of 0–4 is the grenade, never the default) */
export const DEFAULT_SLOT = 3

export interface WeaponDef {
  id: number
  key: string             // icon/model file name: 'knife' | 'colt' | 'rulo' | 'shotgun' | 'smg' | 'ak47' | 'm16' | 'sniper'
  name: string
  category: WeaponCategory
  price: number           // USD; dao = 0
  buyable: boolean        // dao = false
  moveSpeedMul: number    // run-speed multiplier while holding this weapon
  melee?: boolean         // knife: no ammo, no reload, short range
  auto: boolean
  damage: number
  headMult: number
  legMult: number
  fireIntervalMs: number
  magSize: number
  reloadMs: number
  range: number
  spread: SpreadDef
  recoilPitchDeg: number
  recoilYawDeg: number
  recoilRecoverDegPerSec: number
  ads?: AdsDef            // present = hold right mouse to ADS
  recoilRecoverDelayMs?: number   // recoil recovers this many ms after a shot (default: after fireIntervalMs). Slow guns like the sniper need to recover early
  pellets?: number                // rays per shot (default 1). Each ray has its own spread, seeded by shotSeq + ray index
  falloff?: DamageFalloff         // damage drops with distance (default: no drop)
  consumable?: boolean    // grenade: consumable (buy more up to maxCarry, no resale, no ammo/firing)
}

// Spread (cone half-angle, degrees). Formula: shared/src/spread.ts
export interface SpreadDef {
  standDeg: number        // standing still, no bloom
  crouchDeg: number       // crouching or sliding
  moveDeg: number         // added at full run speed (cfg.runSpeed × moveSpeedMul)
  accurateSpeed: number   // m/s: below this there is no movement penalty
  airDeg: number          // added while airborne (replaces moveDeg)
  bloomPerShotDeg: number
  bloomMaxDeg: number
  bloomRecoverDegPerSec: number
  bloomRecoverDelayMs: number   // bloom only starts recovering after this many ms without firing (must be > the gap between 2 shots of an auto weapon)
  pelletConeDeg?: number  // shotgun: fixed cone of the pellets around the pattern centre; movement spread shifts the pattern centre
  unscopedDeg?: number    // sniper: fixed spread when not scoped (adsT = 0); fully scoped uses the normal formula
}

// Damage multiplier 1 up to fullM, falling linearly to minMult at endM, then holding minMult
export interface DamageFalloff {
  fullM: number
  endM: number
  minMult: number
}

// ADS mode (hold right mouse). adsT (0..1) is movement state: rises 1000/inMs per second while aiming, falls 1000/outMs on release.
// scope = black out outside a circle and hide the gun when nearly fully aimed
export interface AdsDef {
  spreadMult: number   // multiplies all spread when fully aimed (sniper: ignored, uses unscopedDeg → normal formula)
  moveMult: number     // multiplies run speed when fully aimed
  fovMult: number      // multiplies the main camera FOV when fully aimed
  inMs: number
  outMs: number
  scope: boolean
}

export interface WeaponState {
  current: number         // id of the held weapon (WEAPONS[current])
  slots: number[]         // weapon id in 5 slots (by CATEGORY_SLOT; slot 4 = grenade), -1 = empty. Held by the server, snapshot sends it to that player only
  slot: number            // held slot
  wantSlot: number        // cmd.weapon of the latest cmd: only switch weapon when cmd.weapon CHANGES (an old in-flight cmd does not drag back the slot just bought)
  ammo: number[]          // by weapon id; ammo[GRENADE_ID] / ammo[SMOKE_ID] = number of HE / smoke grenades carried. slots[GRENADE_SLOT] = selected type
  nade: ThrowState        // pin-pull / throw state of the grenade
  throwSeq: number        // number of grenades thrown (attached to GrenadeSpawn so the client recognises its own predicted grenade)
  quickHeld: boolean      // G key is held (rising edge detection)
  cycleHeld: boolean      // grenade-type switch button is held (rising edge detection)
  prevSlot: number        // slot held before switching to the grenade (G / key 5), to switch back to
  switchBackAtMs: number  // > 0: at this time (seq timescale) auto-switch back to prevSlot if still holding a grenade
  reloadEndMs: number
  nextFireMs: number
  shotSeq: number
  triggerHeld: boolean
  bloomDeg: number[]      // by weapon id: bloom right after the most recent shot (each weapon keeps its own bloom, recovering over time)
  lastShotMs: number[]    // by weapon id: time (seq timescale) of the most recent shot
  shotBloomDeg: number    // bloom applied to the shot just fired (before adding its own bloom): the first bullet does not carry its own bloom
  switchEndMs: number     // weapon-switch lock ends at this time (seq timescale): cannot ADS before then
  magMult: number         // magazines are this many times larger (the mode's EconomyConfig.magMult; fixed for the whole round)
}

// Fire lock after switching weapon (matches the lower/raise animation 2×0.15s on the viewmodel)
export const SWITCH_MS = 300

// Real-gun parameters (damage on a 100-health scale):
// - AK47: 7.62x39, ~600 rounds/min, 30-round magazine, strong recoil, large spread when moving.
// - M16: 5.56x45, ~750 rounds/min, 30-round magazine, more accurate and lower recoil than the AK, longer range.
// - COLT (M1911 .45): semi-auto, 7 rounds, noticeable recoil.
// - ROULEAU (revolver): semi-auto, 6 rounds, high damage, long reload.
export const WEAPONS: WeaponDef[] = [
  {
    id: 0, key: 'ak47', name: 'AK47', category: 'long', price: 2700, buyable: true, moveSpeedMul: 0.92, auto: true, damage: 36, headMult: 3.5, legMult: 0.75,
    fireIntervalMs: 100, magSize: 30, reloadMs: 2500, range: 180,
    spread: { standDeg: 0.35, crouchDeg: 0.20, moveDeg: 1.0, accurateSpeed: 3, airDeg: 3.0, bloomPerShotDeg: 0.25, bloomMaxDeg: 2.0, bloomRecoverDegPerSec: 6, bloomRecoverDelayMs: 150 },
    recoilPitchDeg: 0.95, recoilYawDeg: 0.45, recoilRecoverDegPerSec: 8,
    ads: { spreadMult: 0.25, moveMult: 0.55, fovMult: 0.8, inMs: 180, outMs: 120, scope: false },   // rifle: aim over the front sight, slight zoom, no screen occlusion
  },
  {
    id: 1, key: 'm16', name: 'M16', category: 'long', price: 3100, buyable: true, moveSpeedMul: 0.93, auto: true, damage: 30, headMult: 4, legMult: 0.75,
    fireIntervalMs: 80, magSize: 30, reloadMs: 2200, range: 220,
    spread: { standDeg: 0.25, crouchDeg: 0.15, moveDeg: 0.8, accurateSpeed: 3, airDeg: 2.5, bloomPerShotDeg: 0.18, bloomMaxDeg: 1.5, bloomRecoverDegPerSec: 7, bloomRecoverDelayMs: 150 },
    recoilPitchDeg: 0.56, recoilYawDeg: 0.25, recoilRecoverDegPerSec: 10,
    ads: { spreadMult: 0.25, moveMult: 0.55, fovMult: 0.8, inMs: 180, outMs: 120, scope: false },
  },
  {
    id: 2, key: 'colt', name: 'COLT', category: 'pistol', price: 300, buyable: true, moveSpeedMul: 1.0, auto: false, damage: 32, headMult: 3, legMult: 0.75,
    fireIntervalMs: 160, magSize: 7, reloadMs: 1600, range: 90,
    spread: { standDeg: 0.25, crouchDeg: 0.15, moveDeg: 0.6, accurateSpeed: 3, airDeg: 2.0, bloomPerShotDeg: 0.40, bloomMaxDeg: 1.6, bloomRecoverDegPerSec: 5, bloomRecoverDelayMs: 250 },
    recoilPitchDeg: 1.5, recoilYawDeg: 0.3, recoilRecoverDegPerSec: 12,
    ads: { spreadMult: 0.4, moveMult: 0.7, fovMult: 0.88, inMs: 120, outMs: 90, scope: false },
  },
  {
    id: 3, key: 'rulo', name: 'ROULEAU', category: 'pistol', price: 700, buyable: true, moveSpeedMul: 1.0, auto: false, damage: 55, headMult: 3, legMult: 0.75,
    fireIntervalMs: 400, magSize: 6, reloadMs: 3000, range: 110,
    spread: { standDeg: 0.15, crouchDeg: 0.10, moveDeg: 1.0, accurateSpeed: 3, airDeg: 3.0, bloomPerShotDeg: 0.80, bloomMaxDeg: 2.4, bloomRecoverDegPerSec: 4, bloomRecoverDelayMs: 500 },
    recoilPitchDeg: 2.5, recoilYawDeg: 0.4, recoilRecoverDegPerSec: 10,
    ads: { spreadMult: 0.4, moveMult: 0.7, fovMult: 0.88, inMs: 120, outMs: 90, scope: false },
  },
  {
    // Sniper: 1 shot/1.2s, 90 damage (head ×2 = 180), very large spread when not scoped; scope with 2 zoom levels
    id: 4, key: 'sniper', name: 'SNIPER', category: 'long', price: 4750, buyable: true, moveSpeedMul: 0.85, auto: false, damage: 90, headMult: 2, legMult: 0.75,
    fireIntervalMs: 1200, magSize: 5, reloadMs: 3200, range: 400,
    // Not scoped: fixed unscopedDeg. Fully scoped: 0.05° standing still + moveDeg by speed + airDeg. No bloom (each shot re-cycles the bolt)
    spread: { standDeg: 0.05, crouchDeg: 0.05, moveDeg: 3.0, accurateSpeed: 1, airDeg: 10, bloomPerShotDeg: 0, bloomMaxDeg: 0, bloomRecoverDegPerSec: 0, bloomRecoverDelayMs: 0, unscopedDeg: 8 },
    recoilPitchDeg: 3, recoilYawDeg: 0.5, recoilRecoverDegPerSec: 15, recoilRecoverDelayMs: 120,
    ads: { spreadMult: 1, moveMult: 0.5, fovMult: 0.4, inMs: 150, outMs: 100, scope: true },
  },
  {
    // Shotgun: 8 rays/shot, 16 damage each (close range: 8 body rays = 128, enough to kill in 1 shot), falling off with distance
    id: 5, key: 'shotgun', name: 'SHOTGUN', category: 'mid', price: 1100, buyable: true, moveSpeedMul: 0.95, auto: false, damage: 16, headMult: 2, legMult: 0.75,
    fireIntervalMs: 900, magSize: 6, reloadMs: 3000, range: 60,
    // pelletConeDeg: fixed cone of the 8 pellets; movement/airborne spread only shifts the pattern centre
    spread: { standDeg: 0, crouchDeg: 0, moveDeg: 0.6, accurateSpeed: 3, airDeg: 2.0, bloomPerShotDeg: 0, bloomMaxDeg: 0, bloomRecoverDegPerSec: 0, bloomRecoverDelayMs: 0, pelletConeDeg: 4.5 },
    recoilPitchDeg: 4, recoilYawDeg: 0.6, recoilRecoverDegPerSec: 12, recoilRecoverDelayMs: 120,
    pellets: 8, falloff: { fullM: 6, endM: 30, minMult: 0.2 },
  },
  {
    // Knife: 2.2m hitscan slash from the eye, no spread/recoil, no ammo. 2 slashes kill (55 × 2 ≥ 100 to the body)
    id: 6, key: 'knife', name: 'KNIFE', category: 'knife', price: 0, buyable: false, moveSpeedMul: 1.1, melee: true,
    auto: true, damage: 55, headMult: 2, legMult: 1,
    fireIntervalMs: 450, magSize: 0, reloadMs: 0, range: 2.2,
    spread: { standDeg: 0, crouchDeg: 0, moveDeg: 0, accurateSpeed: 3, airDeg: 0, bloomPerShotDeg: 0, bloomMaxDeg: 0, bloomRecoverDegPerSec: 0, bloomRecoverDelayMs: 0 },
    recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0,
  },
  {
    // SMG: fast, weak bullets, mid range
    id: 7, key: 'smg', name: 'SMG', category: 'mid', price: 1250, buyable: true, moveSpeedMul: 1.0,
    auto: true, damage: 20, headMult: 3, legMult: 0.75,
    fireIntervalMs: 70, magSize: 30, reloadMs: 1800, range: 100,
    spread: { standDeg: 0.60, crouchDeg: 0.40, moveDeg: 0.5, accurateSpeed: 3, airDeg: 2.5, bloomPerShotDeg: 0.15, bloomMaxDeg: 1.5, bloomRecoverDegPerSec: 8, bloomRecoverDelayMs: 120 },
    recoilPitchDeg: 0.45, recoilYawDeg: 0.35, recoilRecoverDegPerSec: 10,
    falloff: { fullM: 15, endM: 40, minMult: 0.6 },
  },
  {
    // M67 grenade: does not use the firing fields (see grenade.ts / grenadePhysics.ts)
    id: 8, key: GRENADE.key, name: 'M67', category: 'grenade', price: GRENADE.price, buyable: true, moveSpeedMul: 1.0, consumable: true,
    auto: false, damage: 0, headMult: 1, legMult: 1,
    fireIntervalMs: 0, magSize: 0, reloadMs: 0, range: 0,
    spread: { standDeg: 0, crouchDeg: 0, moveDeg: 0, accurateSpeed: 3, airDeg: 0, bloomPerShotDeg: 0, bloomMaxDeg: 0, bloomRecoverDegPerSec: 0, bloomRecoverDelayMs: 0 },
    recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0,
  },
  {
    // Zombie claw (plan 16, ZF.2): left mouse. Real damage comes from the zombie type (Player.zstats.clawDamage), `damage` is only a placeholder
    id: 9, key: 'claw', name: 'CLAW', category: 'claw', price: 0, buyable: false, moveSpeedMul: 1, melee: true,
    auto: true, damage: 1, headMult: 1, legMult: 1,
    fireIntervalMs: 550, magSize: 0, reloadMs: 0, range: 1.8,
    spread: { standDeg: 0, crouchDeg: 0, moveDeg: 0, accurateSpeed: 3, airDeg: 0, bloomPerShotDeg: 0, bloomMaxDeg: 0, bloomRecoverDegPerSec: 0, bloomRecoverDelayMs: 0 },
    recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0,
  },
  {
    // Heavy claw (right mouse): 0.3s swing then lands (see ZOMBIE.heavyWindupMs), damage ×ZOMBIE.heavyDamageMult
    id: 10, key: 'claw_heavy', name: 'HEAVY CLAW', category: 'claw', price: 0, buyable: false, moveSpeedMul: 1, melee: true,
    auto: true, damage: 1, headMult: 1, legMult: 1,
    fireIntervalMs: 1100, magSize: 0, reloadMs: 0, range: 2.0,
    spread: { standDeg: 0, crouchDeg: 0, moveDeg: 0, accurateSpeed: 3, airDeg: 0, bloomPerShotDeg: 0, bloomMaxDeg: 0, bloomRecoverDegPerSec: 0, bloomRecoverDelayMs: 0 },
    recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0,
  },
  {
    // Smoke grenade: same slot and throw as the M67, no damage (see SMOKE in grenade.ts)
    id: 11, key: SMOKE.key, name: 'SMOKE', category: 'grenade', price: SMOKE.price, buyable: true, moveSpeedMul: 1.0, consumable: true,
    auto: false, damage: 0, headMult: 1, legMult: 1,
    fireIntervalMs: 0, magSize: 0, reloadMs: 0, range: 0,
    spread: { standDeg: 0, crouchDeg: 0, moveDeg: 0, accurateSpeed: 3, airDeg: 0, bloomPerShotDeg: 0, bloomMaxDeg: 0, bloomRecoverDegPerSec: 0, bloomRecoverDelayMs: 0 },
    recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0,
  },
]

export const WEAPON_BY_KEY: ReadonlyMap<string, WeaponDef> = new Map(WEAPONS.map(w => [w.key, w]))
/** Grenade id in WEAPONS */
export const GRENADE_ID = WEAPON_BY_KEY.get(GRENADE.key)!.id
/** Smoke grenade id */
export const SMOKE_ID = WEAPON_BY_KEY.get(SMOKE.key)!.id
/** All grenade types (same GRENADE_SLOT slot); order = priority when choosing the default type */
export const GRENADE_IDS: readonly number[] = [GRENADE_ID, SMOKE_ID]
export function isGrenadeId(id: number): boolean { return id === GRENADE_ID || id === SMOKE_ID }
/** Normal / heavy zombie claw */
export const CLAW_ID = WEAPON_BY_KEY.get('claw')!.id
export const CLAW_HEAVY_ID = WEAPON_BY_KEY.get('claw_heavy')!.id
export function weaponByKey(key: string): WeaponDef | undefined { return WEAPON_BY_KEY.get(key) }

/** Max rays per shot (the fire-direction array is preallocated to this size; the seed reserves 6 bits for the ray index) */
export const MAX_PELLETS = 16


/** Default set when the team is unknown (Cops): Knife, Colt, —, M16, (no grenade) */
export const FALLBACK_SLOTS: readonly number[] = [6, 2, -1, 1, -1]

/** Actual magazine size of weapon `def` with multiplier `mult` */
export function magSizeOf(def: WeaponDef, mult = 1): number { return Math.round(def.magSize * mult) }

export function makeWeaponState(slots: readonly number[] = FALLBACK_SLOTS, magMult = 1): WeaponState {
  const slot = slots[DEFAULT_SLOT]! >= 0 ? DEFAULT_SLOT : Math.max(0, slots.findIndex(id => id >= 0))
  return {
    current:     slots[slot]!,
    slots:       [...slots],
    slot,
    wantSlot:    DEFAULT_SLOT,
    ammo:        WEAPONS.map(w => magSizeOf(w, magMult)),
    nade:        makeThrowState(),
    throwSeq:    0,
    quickHeld:   false,
    cycleHeld:   false,
    prevSlot:    DEFAULT_SLOT,
    switchBackAtMs: 0,
    reloadEndMs: 0,
    nextFireMs:  0,
    shotSeq:     0,
    triggerHeld: false,
    bloomDeg:    WEAPONS.map(() => 0),
    lastShotMs:  WEAPONS.map(() => 0),
    shotBloomDeg: 0,
    switchEndMs: 0,
    magMult,
  }
}
