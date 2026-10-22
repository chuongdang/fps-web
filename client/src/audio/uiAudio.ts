// Shop UI audio (synthesized): "ka-ching" on a successful purchase, a low "beep" when denied.
import { getGraph } from './context'
import { tone } from './synth'

/** 2 triangle tones, 1320Hz then 1760Hz 60ms apart, 150ms decay, −12dB */
export function playBuyOk(): void {
  const g = getGraph()
  if (!g) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.master, { type: 'triangle', freq: 1320, gainDb: -12, decayMs: 150, when: t })
  tone(g.ctx, g.master, { type: 'triangle', freq: 1760, gainDb: -12, decayMs: 150, when: t + 0.06 })
}

/** tone square 220Hz, 120ms, −16dB */
export function playBuyFail(): void {
  const g = getGraph()
  if (!g) return
  tone(g.ctx, g.master, { type: 'square', freq: 220, gainDb: -16, decayMs: 120, when: g.ctx.currentTime })
}

/** Round start: short horn (square 440Hz, 220ms) */
export function playRoundStart(): void {
  const g = getGraph()
  if (!g) return
  tone(g.ctx, g.master, { type: 'square', freq: 440, gainDb: -14, decayMs: 220, when: g.ctx.currentTime })
}

/** Round won: 2 ascending notes */
export function playRoundWin(): void {
  const g = getGraph()
  if (!g) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.master, { type: 'triangle', freq: 660, gainDb: -12, decayMs: 180, when: t })
  tone(g.ctx, g.master, { type: 'triangle', freq: 990, gainDb: -12, decayMs: 260, when: t + 0.14 })
}

/** Round lost: 2 descending notes */
export function playRoundLose(): void {
  const g = getGraph()
  if (!g) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.master, { type: 'triangle', freq: 520, gainDb: -12, decayMs: 180, when: t })
  tone(g.ctx, g.master, { type: 'triangle', freq: 330, gainDb: -12, decayMs: 300, when: t + 0.14 })
}

/** Last 10 seconds of each round: a small tick every second */
export function playTick(): void {
  const g = getGraph()
  if (!g) return
  tone(g.ctx, g.master, { type: 'square', freq: 1200, gainDb: -22, decayMs: 40, when: g.ctx.currentTime })
}
