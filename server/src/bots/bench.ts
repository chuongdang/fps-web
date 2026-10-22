// Bot accuracy benchmark (plan 15, B.4/B.8): `npm run bot-bench`. Runs headless on a real Room + Rapier.
// If a measurement falls outside the target range, tune bots.json; do NOT change the aiming code to force the result.
import { MsgType, WEAPONS, type BotDifficulty } from '@fps/shared'
import { createArena, type Arena } from './arena'
import { addBot } from './roster'
import { getBotParams, setBotParams } from './params'

export interface BenchResult {
  hitRate: number          // hits / shots fired
  headRate: number         // headshots / hits
  shots: number
  maxHeadStreak: number    // longest streak of consecutive headshots
}

let saved: Record<BotDifficulty, ReturnType<typeof getBotParams>> | null = null
export function restoreParams(): void { if (saved) { setBotParams(saved); saved = null } }

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const BOT_POS: [number, number, number] = [-10, 0, 5]
const YAW_PLUS_X = -Math.PI / 2   // forward = (−sin yaw, −cos yaw) = (+1, 0)

async function setup(difficulty: BotDifficulty, seed: number, weapon?: string) {
  // the standard benchmark uses the AK47 (plan B.4): force bots to buy the AK, no grenades; restore the parameter table when done (restoreParams)
  const tbl = { medium: structuredClone(getBotParams('medium')), hard: structuredClone(getBotParams('hard')) }
  saved ??= structuredClone(tbl)
  for (const d of ['medium', 'hard'] as const) { tbl[d].buy = { long: ['ak47'], pistol: [], mid: [], grenades: 0 } }
  setBotParams(tbl)
  const a = await createArena({ nav: false })
  const rng = seeded(seed)
  const bot = addBot(a.room, difficulty, 'A', rng)!
  const dummy = await a.addDummy('B', [10, 0, 5])
  await new Promise(r => setTimeout(r, 100))   // the bots' worlds load asynchronously
  const events: { shot: number; head: boolean | null }[] = []
  let hits = 0, heads = 0
  const send = bot.bot!.transport.send
  bot.bot!.transport.send = msg => {
    if (msg.t === MsgType.HitConfirm && msg.targetId === dummy.player.id) {
      hits++; if (msg.headshot) heads++
      events.push({ shot: bot.shotsFired, head: msg.headshot })
    }
    send(msg)
  }
  if (weapon) { /* the weapon is bought by the bot per bots.json; `weapon` is only for reference */ void weapon }
  // wait for the match to start + shopping. At the start everyone respawns with full health: set infinite health on the target AFTER the first tick (otherwise the bot kills the target during startup and the target respawns at its base)
  a.step(2)
  dummy.player.hp = 1e9
  a.step(60 * 4)
  const place = () => {
    bot.state.pos = [BOT_POS[0], BOT_POS[1], BOT_POS[2]]; bot.state.vel = [0, 0, 0]
    bot.bot!.aim.set(YAW_PLUS_X, 0)
  }
  place()
  dummy.player.state.pos = [10, 0, 5]
  return { a, bot, dummy, rng, events, counters: () => ({ hits, heads }), reset: () => { hits = 0; heads = 0; events.length = 0 }, place }
}

function result(events: { shot: number; head: boolean | null }[], shots: number, hits: number, heads: number): BenchResult {
  let streak = 0, maxStreak = 0
  for (const e of events) { if (e.head) { streak++; maxStreak = Math.max(maxStreak, streak) } else streak = 0 }
  return { hitRate: hits / Math.max(1, shots), headRate: heads / Math.max(1, hits), shots, maxHeadStreak: maxStreak }
}

/** Human target standing still at 20m (or strafing back and forth at `strafeSpeed` m/s), shoot until `rounds` shots */
export async function benchAccuracy(difficulty: BotDifficulty, opts: { strafeSpeed?: number; rounds?: number; seed?: number } = {}): Promise<BenchResult> {
  const rounds = opts.rounds ?? 300
  const s = await setup(difficulty, opts.seed ?? 1)
  const { a, bot, dummy } = s
  s.reset()
  const startShots = bot.shotsFired
  let dir = 1
  const zc = 5, amp = 8
  const hold = () => {
    if (opts.strafeSpeed) {
      dummy.player.state.pos[2] += dir * opts.strafeSpeed / 60
      if (dummy.player.state.pos[2] > zc + amp) dir = -1
      if (dummy.player.state.pos[2] < zc - amp) dir = 1
      dummy.player.state.vel = [0, 0, dir * opts.strafeSpeed]
    }
    bot.state.pos[0] = BOT_POS[0]; bot.state.pos[2] = BOT_POS[2]   // keep the bot in place: this benchmark measures aiming, not movement
  }
  for (let t = 0; t < 60 * 900 && bot.shotsFired - startShots < rounds; t += 60) {
    a.step(60, hold)
    if (process.env.BENCH_DEBUG && t < 60 * 12) {
      const b = bot.bot as unknown as { state: string; targetId: number; perc: { known: Map<number, { visible: boolean; reactAtMs: number }> } }
      console.log(t / 60, b.state, b.targetId, [...b.perc.known.values()].map(k => `${k.visible}/${k.reactAtMs.toFixed(0)}`).join(','), bot.bot!.aim.yaw.toFixed(2), 'shots', bot.shotsFired, 'now', a.room.serverNow.toFixed(0), 'alive', bot.alive, 'dpos', dummy.player.state.pos.map(v => v.toFixed(0)).join(','))
    }
  }
  const shots = bot.shotsFired - startShots
  const c = s.counters()
  const r = result(s.events, shots, c.hits, c.heads)
  a.dispose()
  restoreParams()
  return r
}

/** Time from the enemy popping out (suddenly, standing still, in line of sight) to the first shot */
export async function benchReaction(difficulty: BotDifficulty, trials = 24): Promise<{ meanMs: number; minMs: number; maxMs: number }> {
  const s = await setup(difficulty, 99)
  const { a, bot, dummy } = s
  const times: number[] = []
  const hold = () => { bot.state.pos[0] = BOT_POS[0]; bot.state.pos[2] = BOT_POS[2] }
  for (let i = 0; i < trials; i++) {
    // hide the enemy behind the bot (out of sight), wait for the bot to settle, then pop it out in front
    dummy.player.state.pos = [-18, 0, 5]
    s.place()
    a.step(60 * 2, hold)
    s.place()
    bot.weapon.ammo[bot.weapon.current] = WEAPONS[bot.weapon.current]!.magSize; bot.weapon.reloadEndMs = 0   // each attempt starts with a full magazine and no reload in progress
    dummy.player.state.pos = [10, 0, 5]
    const base = bot.shotsFired
    let ticks = 0
    while (bot.shotsFired === base && ticks < 60 * 6) { a.step(1, hold); ticks++ }
    if (bot.shotsFired > base) times.push(ticks * 1000 / 60)
    a.step(60 * 2, hold)   // bot rests/reloads before the next attempt
  }
  a.dispose()
  restoreParams()
  const mean = times.reduce((x, y) => x + y, 0) / Math.max(1, times.length)
  return { meanMs: mean, minMs: Math.min(...times), maxMs: Math.max(...times) }
}

export const TARGETS = {
  still: { medium: { hit: [0.25, 0.4], head: 0.15 }, hard: { hit: [0.4, 0.55], head: 0.3 } },
  strafe: { medium: { hit: [0.10, 0.20] }, hard: { hit: [0.20, 0.35] } },
  react: { medium: [700, 1100], hard: [300, 550] },
} as const

async function main(): Promise<void> {
  const fmt = (x: number) => `${(x * 100).toFixed(1)}%`
  console.log(`weapon: ${WEAPONS[0]!.name} (bot buys per bots.json)`)
  for (const d of ['medium', 'hard'] as const) {
    const still = await benchAccuracy(d)
    const run = await benchAccuracy(d, { strafeSpeed: 6 })
    const react = await benchReaction(d)
    const t = TARGETS
    console.log(`\n== ${d.toUpperCase()} ==`)
    console.log(`still target 20m  : hit ${fmt(still.hitRate)} (target ${fmt(t.still[d].hit[0])}–${fmt(t.still[d].hit[1])}), headshots/hits ${fmt(still.headRate)} (≤ ${fmt(t.still[d].head)}), ${still.shots} shots, longest headshot streak ${still.maxHeadStreak}`)
    console.log(`running target 6 m/s 20m: hit ${fmt(run.hitRate)} (target ${fmt(t.strafe[d].hit[0])}–${fmt(t.strafe[d].hit[1])}), ${run.shots} shots`)
    console.log(`seen → first shot : mean ${react.meanMs.toFixed(0)}ms [${react.minMs.toFixed(0)}–${react.maxMs.toFixed(0)}] (target ${t.react[d][0]}–${t.react[d][1]}ms)`)
  }
}

if (process.argv[1] && /bench\.(ts|js)$/.test(process.argv[1])) void main()
export type { Arena }
