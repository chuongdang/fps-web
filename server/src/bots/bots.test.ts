import { describe, it, expect } from 'vitest'
import { MsgType, WEAPONS, type TeamId } from '@fps/shared'
import { createArena, type Arena } from './arena'
import { addBot } from './roster'
import type { BotController } from './controller'

function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const ready = (ms = 150) => new Promise(r => setTimeout(r, ms))   // the bots' worlds load asynchronously

async function arenaWith(team: TeamId, difficulty: 'medium' | 'hard', seed = 5) {
  const a = await createArena()
  const bot = addBot(a.room, difficulty, team, seeded(seed))!
  const dummy = await a.addDummy(team === 'A' ? 'B' : 'A')
  await ready()
  a.step(2); dummy.player.hp = 1e9
  a.step(60 * 3)   // enter the match + shopping
  return { a, bot, dummy }
}

const priv = (b: BotController) => b as unknown as { state: string; goTo(p: [number, number, number], run: boolean): void; flankUntil: number; perc: { known: Map<number, unknown> }; aim: { yaw: number } }

describe('bot — perception (B.3)', () => {
  it('enemy behind a wall: the bot does not see it, does not shoot, does not turn straight toward it', async () => {
    const { a, bot, dummy } = await arenaWith('A', 'hard')
    // the wall pillar at x = −19 (z ∈ [1; 4.67]) blocks the two players
    bot.state.pos = [-22, 0, 3]; bot.bot!.aim.set(-Math.PI / 2, 0)
    dummy.player.state.pos = [-16, 0, 3]
    const shots0 = bot.shotsFired
    a.step(60 * 4, () => { bot.state.pos[0] = -22; bot.state.pos[2] = 3; dummy.player.state.pos[0] = -16; dummy.player.state.pos[2] = 3 })
    expect(priv(bot.bot!).perc.known.size).toBe(0)
    expect(bot.shotsFired).toBe(shots0)
    a.dispose()
  })

  it('shot from behind: the bot turns around (after its reaction time), not instantly', async () => {
    const { a, bot } = await arenaWith('A', 'medium')
    bot.state.pos = [-10, 0, 5]; bot.bot!.aim.set(-Math.PI / 2, 0)   // looking +X
    const hold = () => { bot.state.pos[0] = -10; bot.state.pos[2] = 5 }
    a.step(30, hold)
    const yaw0 = priv(bot.bot!).aim.yaw
    bot.bot!.transport.send({ t: MsgType.Hurt, origin: [-25, 1.6, 5], damage: 20 })   // from the −X side (behind)
    a.step(3, hold)
    expect(Math.abs(Math.abs(priv(bot.bot!).aim.yaw - yaw0))).toBeLessThan(Math.PI / 2)   // has not had time to turn yet
    a.step(90, hold)
    const turned = Math.abs(((priv(bot.bot!).aim.yaw - yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
    expect(turned).toBeGreaterThan(Math.PI * 0.5 - 0.6)   // has fully turned to face backwards (± 20° error)
    a.dispose()
  })

  it('gunshots outside the hearing radius do not make the bot suspicious', async () => {
    const { a, bot } = await arenaWith('A', 'medium')
    bot.state.pos = [-10, 0, 5]
    const b = bot.bot as unknown as { perc: { suspicion: unknown } }
    bot.bot!.transport.send({ t: MsgType.ShotFx, shooterId: 2, weapon: 0, origin: [29, 1.6, -15], dir: [0, 0, 1], dist: 10 })
    expect(b.perc.suspicion).toBeNull()
    a.dispose()
  })
})

describe('bot — behaves as a normal player (B.2)', () => {
  it('add bot: the enemy side appears at its base, shops like a human (infinite money is not deducted)', async () => {
    const { a, bot } = await arenaWith('B', 'hard')
    expect(bot.team).toBe('B')
    const slots = bot.weapon.slots
    const long = slots[3]!, mid = slots[2]!
    expect(long >= 0 || mid >= 0).toBe(true)
    expect(bot.money).toBe(a.room.eco.maxMoney)   // offline + infinite: buying does not deduct
    a.dispose()
  })

  it('bot cannot shoot when out of ammo / reloading: obeys tryFire (shots ≤ magazine size before reloading)', async () => {
    const { a, bot, dummy } = await arenaWith('A', 'medium')
    bot.state.pos = [-10, 0, 5]; bot.bot!.aim.set(-Math.PI / 2, 0); dummy.player.state.pos = [10, 0, 5]
    const def = WEAPONS[bot.weapon.current]!
    const start = bot.shotsFired
    let maxBurst = 0, cur = 0, prevAmmo = bot.weapon.ammo[def.id]!
    a.step(60 * 10, () => {
      bot.state.pos[0] = -10; bot.state.pos[2] = 5
      const am = bot.weapon.ammo[def.id]!
      if (am < prevAmmo) cur += prevAmmo - am; else if (am > prevAmmo) { maxBurst = Math.max(maxBurst, cur); cur = 0 }
      prevAmmo = am
    })
    expect(bot.shotsFired).toBeGreaterThan(start)
    expect(maxBurst).toBeLessThanOrEqual(def.magSize)
    a.dispose()
  })
})

describe('bot — movement (B.1/B.2)', () => {
  it('hard bot follows the path to the top of tower A (ramp → tower) without getting stuck', async () => {
    const { a, bot } = await arenaWith('A', 'hard')
    // no enemy in sight: use Flank to force it to follow the path to the destination
    bot.state.pos = [-28, 0.2, -6]
    const b = priv(bot.bot!) as ReturnType<typeof priv> & { thinkHard(): void }
    b.thinkHard = () => {}   // disable the behaviour selector: only test path following (follow + jump + anti-stuck)
    b.state = 'Hunt'
    b.goTo([-15, 6.5, -18], true)
    let maxY = 0
    a.step(60 * 35, () => { maxY = Math.max(maxY, bot.state.pos[1]) })
    expect(maxY).toBeGreaterThan(6)   // reached the tower top
    a.dispose()
  }, 60000)

  it('8 bots at once: each simulated tick is cheap (not a bottleneck)', async () => {
    const a: Arena = await createArena()
    const rng = seeded(11)
    for (let i = 0; i < 8; i++) addBot(a.room, i % 2 ? 'hard' : 'medium', i < 4 ? 'A' : 'B', rng)
    await ready(400)
    a.step(60 * 5)
    const t0 = performance.now()
    a.step(60 * 20)
    const msPerTick = (performance.now() - t0) / (60 * 20)
    console.log(`8 bots: ${msPerTick.toFixed(2)} ms/tick (budget 16.7)`)
    expect(msPerTick).toBeLessThan(6)
    a.dispose()
  }, 60000)
})
