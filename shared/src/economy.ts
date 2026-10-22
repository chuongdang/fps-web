// Buy/sell/reward rules (pure). The server decides, the client calls these for display. Never mutates input objects.
import { CATEGORY_SLOT, GRENADE_IDS, SLOT_COUNT, WEAPONS, weaponByKey } from './weapons'
import type { TeamId } from './teams'
import type { GameMode } from './roomConfig'
import { GRENADE, maxCarryOf } from './grenade'
import { INFECTION } from './infection'
import { DEFENSE } from './defense'

export interface EconomyConfig {
  startMoney: number
  maxMoney: number
  killReward: number
  bountyStreak: number      // a victim with a kill streak >= this pays out the bounty reward
  bountyReward: number
  sellRatio: number
  defaultResaleValue: number   // resale price of the starting weapons (0 = cannot be sold)
  keepLoadoutOnDeath: boolean
  maxBuysPerSecond: number
  infiniteReserve?: boolean   // zombie modes: infinite reserve ammo (only magazines need reloading) – HUD shows `25 / ∞`
  magMult?: number            // zombie modes: magazines are this many times larger (default 1)
}

/** Team Deathmatch (task 09) */
export const ECONOMY: EconomyConfig = {
  startMoney: 2000,
  maxMoney: 16000,
  killReward: 500,
  bountyStreak: 3,
  bountyReward: 1000,
  sellRatio: 0.8,
  defaultResaleValue: 0,
  keepLoadoutOnDeath: false,
  maxBuysPerSecond: 5,
}
export const ECONOMY_TDM: EconomyConfig = ECONOMY

/** Elimination (task 13): per-round money */
export const ECONOMY_ELIM = {
  ...ECONOMY,
  startMoney: 800,
  killReward: 300,
  bountyReward: 600,
  keepLoadoutIfSurvived: true,   // survive the round: keep weapons and grenades
  roundWin: 3000,
  roundLossBase: 1500,
  roundLossStep: 400,            // consecutive losses: 1500, 1900, 2300, 2700, 3000
  roundLossMax: 3000,
  roundDraw: 1500,               // drawn round: everyone +1500, loss streak unchanged
  resetAtHalftime: true,         // sides swap: money resets to startMoney, weapons to defaults
}
export type EliminationEconomy = typeof ECONOMY_ELIM

/** Human magazine size in zombie modes (Infection, Defense): ×2 because zombies are numerous and 30 rounds run out too fast */
export const ZOMBIE_MAG_MULT = 2

/** Infection (plan 16): starting money each round (not carried over), buy during the prep phase, infinite reserve ammo */
export const ECONOMY_INFECTION: EconomyConfig = {
  ...ECONOMY,
  startMoney: INFECTION.startMoney,
  keepLoadoutOnDeath: true,
  infiniteReserve: true,
  magMult: ZOMBIE_MAG_MULT,
}

/** Economy set by mode (server: mode.economy(); the client uses it to display resale price, max money...) */
export function economyFor(mode: GameMode): EconomyConfig {
  switch (mode) {
    case 'elimination': return ECONOMY_ELIM
    case 'infection': return ECONOMY_INFECTION
    case 'defense': return ECONOMY_DEFENSE
    default: return ECONOMY_TDM
  }
}

/** Defense (plan 17): low starting money, keep weapons on death, infinite reserve ammo; zombie kill money is per type (ZOMBIE_TYPES.reward), wave-clear bonus: DEFENSE */
export const ECONOMY_DEFENSE: EconomyConfig = {
  ...ECONOMY,
  startMoney: DEFENSE.startMoney,
  keepLoadoutOnDeath: true,
  infiniteReserve: true,
  magMult: ZOMBIE_MAG_MULT,
  killReward: 0, bountyStreak: 1e9, bountyReward: 0,   // no bounty; zombie kill money is computed per type
}

export const DEFAULT_LOADOUT: Record<TeamId, string[]> = {
  A: ['knife', 'colt', 'm16'],   // Cops
  B: ['knife', 'rulo', 'ak47'],  // Terrorists
}

// paid = money paid (starting weapons = 0). Only the grenade slot has count/counts: counts = number of each type ({ m67: 1, smoke: 1 }),
// key = first type with any left (HE first), count = number of that type. Create/modify via nadeSlot().
export interface OwnedWeapon { key: string; paid: number; count?: number; counts?: Record<string, number> }
export interface Loadout { slots: (OwnedWeapon | null)[] }    // always exactly SLOT_COUNT entries, indexed by CATEGORY_SLOT

export type BuyFailReason = 'not_buyable' | 'already_owned' | 'not_enough_money' | 'max_carry'
export type BuyQuote =
  | { ok: true; price: number; refund: number; net: number; slot: number }
  | { ok: false; reason: BuyFailReason; price: number; refund: number; net: number }

export function defaultLoadout(team: TeamId, eco: EconomyConfig = ECONOMY): Loadout {
  const slots: (OwnedWeapon | null)[] = new Array(SLOT_COUNT).fill(null)
  for (const key of DEFAULT_LOADOUT[team]) {
    const def = weaponByKey(key)
    if (def) slots[CATEGORY_SLOT[def.category]] = { key, paid: eco.defaultResaleValue }
  }
  return { slots }
}

/** Resale price of an owned weapon (consumables cannot be resold) */
export function resaleValue(w: OwnedWeapon, eco: EconomyConfig = ECONOMY): number {
  if (weaponByKey(w.key)?.consumable) return 0
  return Math.floor(w.paid * eco.sellRatio)
}

/** Number of grenades of type `key` ('m67' = default HE, 'smoke') being carried */
export function grenadeCount(loadout: Loadout, key: string = GRENADE.key): number {
  const g = loadout.slots[CATEGORY_SLOT.grenade]
  return g?.counts?.[key] ?? (g && g.key === key ? g.count ?? 0 : 0)
}

/** Build the grenade slot from per-type counts; none left → null. `paid` accumulates money paid (not used for resale) */
export function nadeSlot(counts: Record<string, number>, paid = 0): OwnedWeapon | null {
  const out: Record<string, number> = {}
  for (const id of GRENADE_IDS) { const k = WEAPONS[id]!.key; if ((counts[k] ?? 0) > 0) out[k] = counts[k]! }
  const first = Object.keys(out)[0]
  return first ? { key: first, paid, count: out[first], counts: out } : null
}

/** Use one grenade of type `key`. Does not mutate input; if none of that type is left → returns the loadout unchanged. */
export function consumeGrenade(loadout: Loadout, key: string = GRENADE.key): Loadout {
  const slot = CATEGORY_SLOT.grenade
  const g = loadout.slots[slot]
  if (!g || grenadeCount(loadout, key) <= 0) return loadout
  const slots = loadout.slots.slice()
  slots[slot] = nadeSlot({ ...(g.counts ?? { [g.key]: g.count ?? 0 }), [key]: grenadeCount(loadout, key) - 1 }, g.paid)
  return { slots }
}

export function quoteBuy(money: number, loadout: Loadout, key: string, eco: EconomyConfig = ECONOMY): BuyQuote {
  const def = weaponByKey(key)
  if (!def || !def.buyable) return { ok: false, reason: 'not_buyable', price: def?.price ?? 0, refund: 0, net: def?.price ?? 0 }
  const slot = CATEGORY_SLOT[def.category]
  const old = loadout.slots[slot] ?? null
  if (def.consumable) {   // consumables: stack up to maxCarry, no swap-for-refund
    const net = def.price
    if (grenadeCount(loadout, key) >= maxCarryOf(key)) return { ok: false, reason: 'max_carry', price: def.price, refund: 0, net }
    if (money < net) return { ok: false, reason: 'not_enough_money', price: def.price, refund: 0, net }
    return { ok: true, price: def.price, refund: 0, net, slot }
  }
  const refund = old ? resaleValue(old, eco) : 0
  const net = def.price - refund
  if (old && old.key === key) return { ok: false, reason: 'already_owned', price: def.price, refund, net }
  if (money < net) return { ok: false, reason: 'not_enough_money', price: def.price, refund, net }
  return { ok: true, price: def.price, refund, net, slot }
}

export function applyBuy(money: number, loadout: Loadout, key: string, eco: EconomyConfig = ECONOMY): { money: number; loadout: Loadout } | null {
  const q = quoteBuy(money, loadout, key, eco)
  if (!q.ok) return null
  const slots = loadout.slots.slice()
  const old = slots[q.slot]
  const consumable = !!weaponByKey(key)?.consumable
  slots[q.slot] = consumable
    ? nadeSlot({ ...(old?.counts ?? (old ? { [old.key]: old.count ?? 0 } : {})), [key]: grenadeCount(loadout, key) + 1 }, (old?.paid ?? 0) + q.price)
    : { key, paid: q.price }
  return { money: addMoney(money, -q.net, eco), loadout: { slots } }
}

/** Reward for killing a player with kill streak `victimStreak` */
export function killReward(victimStreak: number, eco: EconomyConfig = ECONOMY): number {
  return victimStreak >= eco.bountyStreak ? eco.bountyReward : eco.killReward
}

export function addMoney(money: number, delta: number, eco: EconomyConfig = ECONOMY): number {
  return Math.min(eco.maxMoney, Math.max(0, money + delta))
}

export type RoundOutcome = 'win' | 'loss' | 'draw'

/**
 * End-of-round money (Elimination) for one player of a team with loss streak `lossStreak` (before this round).
 * Win: +roundWin, streak resets to 0. Loss: streak + 1, +min(base + (new streak − 1)·step, max). Draw: +roundDraw, streak unchanged.
 */
export function roundIncome(outcome: RoundOutcome, lossStreak: number, eco: EliminationEconomy = ECONOMY_ELIM): { amount: number; lossStreak: number } {
  if (outcome === 'win') return { amount: eco.roundWin, lossStreak: 0 }
  if (outcome === 'draw') return { amount: eco.roundDraw, lossStreak }
  const next = lossStreak + 1
  return { amount: Math.min(eco.roundLossBase + (next - 1) * eco.roundLossStep, eco.roundLossMax), lossStreak: next }
}

/** Weapon id in each slot (-1 = empty), to write into WeaponState.slots */
export function loadoutWeaponIds(loadout: Loadout): number[] {
  return loadout.slots.map(w => (w ? weaponByKey(w.key)?.id ?? -1 : -1))   // grenade slot: key = first type with any left (nadeSlot)
}
