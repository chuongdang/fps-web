import { describe, it, expect } from 'vitest'
import { BOSS, DEFENSE, WAVES, ZOMBIE_TYPES, scaledCount, waveClearBonus, zombieStatsFor } from './defense'
import { ECONOMY_DEFENSE, economyFor } from './economy'

describe('Defense – data (T.2/T.3)', () => {
  it('7 zombie kinds as in the plan, the boss is the only kind with headMult 3', () => {
    expect(Object.keys(ZOMBIE_TYPES).sort()).toEqual(['boss', 'brute', 'crawler', 'leaper', 'runner', 'screamer', 'walker'])
    expect(ZOMBIE_TYPES.boss!.headMult).toBe(3)
    expect(ZOMBIE_TYPES.crawler!.abilities).toContain('crawl_holes')
    expect(ZOMBIE_TYPES.leaper!.abilities).toContain('leap')
    expect(ZOMBIE_TYPES.brute!.abilities).toContain('shove')
    expect(ZOMBIE_TYPES.screamer!.abilities).toContain('rally')
    expect(ZOMBIE_TYPES.boss!.abilities).toEqual(['slam', 'summon', 'charge'])
  })
  it('10 waves, every group uses a real kind; wave 10 has a boss', () => {
    expect(WAVES.waves.length).toBe(10)
    for (const w of WAVES.waves) for (const g of w.groups) { expect(ZOMBIE_TYPES[g.type], g.type).toBeDefined(); expect(g.count).toBeGreaterThan(0) }
    expect(WAVES.waves[9]!.groups.some(g => g.type === 'boss')).toBe(true)
    expect(WAVES.maxAlive).toBe(18)   // reduced from 28: crowded waves were too hard to shoot
  })
  it('count and HP by difficulty + player count', () => {
    expect(scaledCount(10, 'normal', 1)).toBe(10)
    expect(scaledCount(10, 'normal', 4)).toBe(Math.round(10 * (1 + 0.6 * 3)))
    expect(scaledCount(10, 'easy', 1)).toBe(7)
    expect(scaledCount(10, 'hard', 1)).toBe(13)
    expect(zombieStatsFor('walker', 'normal', 1).hpMax).toBe(150)
    expect(zombieStatsFor('walker', 'normal', 3).hpMax).toBe(Math.round(150 * 1.7))
    expect(zombieStatsFor('walker', 'hard', 1).clawDamage).toBe(Math.round(15 * 1.25))
  })
  it('economy: wave-clear reward = 800 + 100×n; no wanted bonus', () => {
    expect(waveClearBonus(1)).toBe(900)
    expect(waveClearBonus(10)).toBe(1800)
    expect(economyFor('defense')).toBe(ECONOMY_DEFENSE)
    expect(ECONOMY_DEFENSE.startMoney).toBe(DEFENSE.startMoney)
    expect(ECONOMY_DEFENSE.infiniteReserve).toBe(true)
    expect(BOSS.summon.thresholds).toEqual([0.75, 0.5, 0.25])
  })
})

describe('zombie-mode magazines', () => {
  it('Infection / Defense magazine ×2, other modes ×1; a finished reload fills the ×2 magazine', async () => {
    const { economyFor, ZOMBIE_MAG_MULT } = await import('./economy')
    const { makeWeaponState, WEAPONS, weaponByKey } = await import('./weapons')
    const { startReload, stepWeapon } = await import('./weaponLogic')
    expect(economyFor('infection').magMult).toBe(ZOMBIE_MAG_MULT)
    expect(economyFor('defense').magMult).toBe(ZOMBIE_MAG_MULT)
    expect(economyFor('tdm').magMult ?? 1).toBe(1)
    const m16 = weaponByKey('m16')!
    const ws = makeWeaponState(undefined, ZOMBIE_MAG_MULT)
    expect(ws.ammo[m16.id]).toBe(m16.magSize * 2)
    expect(ws.ammo[weaponByKey('knife')!.id]).toBe(0)   // knife has no magazine
    ws.current = m16.id
    ws.ammo[m16.id] = 10
    expect(startReload(ws, m16, 0)).toBe(true)
    stepWeapon(ws, m16.reloadMs + 1, false, false)
    expect(ws.ammo[m16.id]).toBe(60)
    expect(WEAPONS[m16.id]!.magSize).toBe(30)   // base config unchanged
  })
})
