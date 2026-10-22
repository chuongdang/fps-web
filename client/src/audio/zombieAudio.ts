// Zombie audio (plan 16, ZF.5): file if available (client/public/sounds/common/*), otherwise a rough synthesized sound so it is never silent.
// Every other zombie's sound plays positionally (panner) so the direction can be heard. File search keywords: zombie growl, zombie scream, monster roar,
// claw swipe, flesh hit, night ambience.
import { NetFlag } from '@fps/shared'
import { getGraph, listenerPos, type AudioGraph } from './context'
import { commonKey, getBuffer } from './loader'
import { noise, tone } from './synth'
import { dbToGain, pickNoRepeat, randSpread } from './audioMath'

export const ZOMBIE_SOUND_FILES: string[] = [
  ...[1, 2, 3, 4, 5].map(i => `growl_0${i}`), 'scream', 'claw_swing', 'claw_hit', 'zombie_step',
  ...[1, 2, 3].map(i => `zombie_hurt_0${i}`), 'zombie_death', 'infect_sting', 'ambient_night', 'boss_roar', 'boss_theme',
].map(commonKey)

const GROWL_FILES = [1, 2, 3, 4, 5].map(i => commonKey(`growl_0${i}`))
const HURT_FILES = [1, 2, 3].map(i => commonKey(`zombie_hurt_0${i}`))
const MAX_DIST = 45
const lastPick = new Map<string, string>()

function dist(p: readonly number[]): number { return Math.hypot(p[0]! - listenerPos[0], p[1]! - listenerPos[1], p[2]! - listenerPos[2]) }

/** Source placed at `pos` (null = inside the head, non-positional); returns the input to connect to and a teardown function */
function source(g: AudioGraph, pos: readonly number[] | null, refDistance = 4): { dest: AudioNode; free: () => void } {
  if (!pos) return { dest: g.master, free: () => {} }
  const d = dist(pos)
  const lp = g.ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = Math.max(1500, 16000 * Math.pow(0.5, d / 18))
  const pn = g.ctx.createPanner()
  pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'
  pn.refDistance = refDistance; pn.rolloffFactor = 1.1
  pn.positionX.value = pos[0]!; pn.positionY.value = pos[1]!; pn.positionZ.value = pos[2]!
  lp.connect(pn).connect(g.master)
  return { dest: lp, free: () => { lp.disconnect(); pn.disconnect() } }
}

function playBuf(g: AudioGraph, key: string, dest: AudioNode, gainDb: number, rate = 1): boolean {
  const b = getBuffer(key)
  if (!b) return false
  const src = g.ctx.createBufferSource(), gn = g.ctx.createGain()
  src.buffer = b; src.playbackRate.value = rate; gn.gain.value = dbToGain(gainDb)
  src.connect(gn).connect(dest)
  src.start()
  src.onended = () => { src.disconnect(); gn.disconnect() }
  return true
}

/** Random growl: 400Hz lowpass noise + 70–110Hz sawtooth modulated (6Hz LFO), 0.8s */
export function playGrowl(pos: readonly number[] | null, deep = 1): void {
  const g = getGraph()
  if (!g || (pos && dist(pos) > MAX_DIST)) return
  const s = source(g, pos)
  const file = pickNoRepeat(GROWL_FILES.filter(k => getBuffer(k)), lastPick.get('growl'), Math.random)
  if (file) { lastPick.set('growl', file); playBuf(g, file, s.dest, -6 + randSpread(2), (0.9 + Math.random() * 0.2) / deep) }
  else {
    const t = g.ctx.currentTime
    const f0 = (70 + Math.random() * 40) / deep
    const osc = g.ctx.createOscillator(), og = g.ctx.createGain(), lfo = g.ctx.createOscillator(), lg = g.ctx.createGain()
    osc.type = 'sawtooth'; osc.frequency.value = f0
    lfo.frequency.value = 6; lg.gain.value = f0 * 0.18
    lfo.connect(lg).connect(osc.frequency)
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(dbToGain(-16), t + 0.1); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.8)
    osc.connect(og).connect(s.dest)
    osc.start(t); lfo.start(t); osc.stop(t + 0.85); lfo.stop(t + 0.85)
    osc.onended = () => { osc.disconnect(); lfo.disconnect(); og.disconnect(); lg.disconnect() }
    noise(g.ctx, s.dest, { filter: 'lowpass', freq: 400, gainDb: -22, attackMs: 80, decayMs: 650, when: t })
  }
  setTimeout(s.free, 1500)
}

/** Scream: turning into a zombie, mother zombie appears, jump E, boss calls the horde */
export function playScream(pos: readonly number[] | null, big = false): void {
  const g = getGraph()
  if (!g) return
  const s = source(g, pos, big ? 12 : 6)
  if (!playBuf(g, commonKey(big ? 'boss_roar' : 'scream'), s.dest, big ? -2 : -4) && !(big && playBuf(g, commonKey('scream'), s.dest, -2, 0.7))) {
    const t = g.ctx.currentTime
    const k = big ? 0.6 : 1
    tone(g.ctx, s.dest, { type: 'sawtooth', freq: 420 * k, freqEnd: 180 * k, gainDb: -14, attackMs: 40, decayMs: 900, when: t })
    tone(g.ctx, s.dest, { type: 'square', freq: 640 * k, freqEnd: 260 * k, gainDb: -22, attackMs: 40, decayMs: 800, when: t })
    noise(g.ctx, s.dest, { filter: 'bandpass', freq: 1800, freqEnd: 600, q: 1.2, gainDb: -20, decayMs: 850, when: t })
  }
  setTimeout(s.free, 2500)
}

export function playClawHit(pos: readonly number[] | null): void {
  const g = getGraph()
  if (!g) return
  const s = source(g, pos, 3)
  if (!playBuf(g, commonKey('claw_hit'), s.dest, -6)) {
    const t = g.ctx.currentTime
    noise(g.ctx, s.dest, { filter: 'lowpass', freq: 900, gainDb: -14, decayMs: 120, when: t })
    tone(g.ctx, s.dest, { type: 'sine', freq: 120, freqEnd: 60, gainDb: -16, decayMs: 110, when: t })
  }
  setTimeout(s.free, 800)
}

/** Heavy footstep, 4 dB louder than a human footstep */
export function playZombieStep(pos: readonly number[]): void {
  const g = getGraph()
  if (!g || dist(pos) > 28) return
  const s = source(g, pos, 3)
  if (!playBuf(g, commonKey('zombie_step'), s.dest, 4 - 6, 0.9 + Math.random() * 0.2)) {
    const t = g.ctx.currentTime
    noise(g.ctx, s.dest, { filter: 'bandpass', freq: 220, q: 1.2, gainDb: -14 + 4, decayMs: 130, when: t })
    tone(g.ctx, s.dest, { type: 'sine', freq: 70, freqEnd: 45, gainDb: -18 + 4, decayMs: 120, when: t })
  }
  setTimeout(s.free, 800)
}

const lastHurt = new Map<number, number>()
/** Bullet hit: limited to once per 0.3s per zombie */
export function playZombieHurt(id: number, pos: readonly number[]): void {
  const g = getGraph()
  if (!g) return
  const now = performance.now()
  if (now - (lastHurt.get(id) ?? -1e9) < 300) return
  lastHurt.set(id, now)
  const s = source(g, pos, 4)
  const file = pickNoRepeat(HURT_FILES.filter(k => getBuffer(k)), lastPick.get('hurt'), Math.random)
  if (file) { lastPick.set('hurt', file); playBuf(g, file, s.dest, -6 + randSpread(2), 0.95 + Math.random() * 0.1) }
  else {
    const t = g.ctx.currentTime
    tone(g.ctx, s.dest, { type: 'sawtooth', freq: 180 + Math.random() * 40, freqEnd: 90, gainDb: -20, decayMs: 200, when: t })
    noise(g.ctx, s.dest, { filter: 'bandpass', freq: 700, q: 1, gainDb: -26, decayMs: 160, when: t })
  }
  setTimeout(s.free, 900)
}

export function playZombieDeath(pos: readonly number[]): void {
  const g = getGraph()
  if (!g) return
  const s = source(g, pos, 5)
  if (!playBuf(g, commonKey('zombie_death'), s.dest, -4)) {
    const t = g.ctx.currentTime
    tone(g.ctx, s.dest, { type: 'sawtooth', freq: 200, freqEnd: 50, gainDb: -16, decayMs: 900, when: t })
    noise(g.ctx, s.dest, { filter: 'lowpass', freq: 500, freqEnd: 120, gainDb: -20, decayMs: 800, when: t })
  }
  setTimeout(s.free, 1500)
}

/** Short jingle when someone is infected (the whole room hears it, quiet) */
export function playInfectSting(): void {
  const g = getGraph()
  if (!g) return
  if (playBuf(g, commonKey('infect_sting'), g.master, -14)) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.master, { type: 'sine', freq: 392, gainDb: -26, decayMs: 600, when: t })
  tone(g.ctx, g.master, { type: 'sine', freq: 370, gainDb: -26, decayMs: 700, when: t + 0.12 })
  tone(g.ctx, g.master, { type: 'sine', freq: 311, gainDb: -24, decayMs: 900, when: t + 0.26 })
}

// ── Night ambience: wind + insects, looping ─────────────────────────────────────────────
let ambientTimer = 0
let ambientNode: { stop: () => void } | null = null
export function startNightAmbient(low = false): void {
  const g = getGraph()
  if (!g || ambientNode) return
  const bufKey = commonKey('ambient_night')
  const gain = g.ctx.createGain()
  gain.gain.value = low ? dbToGain(-24) : dbToGain(-16)
  gain.connect(g.master)
  const parts: { stop: () => void }[] = []
  const b = getBuffer(bufKey)
  if (b) {
    const src = g.ctx.createBufferSource()
    src.buffer = b; src.loop = true
    src.connect(gain); src.start()
    parts.push({ stop: () => { try { src.stop() } catch { /* already stopped */ } src.disconnect() } })
  } else {
    // wind: bandpass noise slowly swept by an LFO
    const len = g.ctx.sampleRate * 2
    const nb = g.ctx.createBuffer(1, len, g.ctx.sampleRate)
    const d = nb.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = g.ctx.createBufferSource(); src.buffer = nb; src.loop = true
    const bp = g.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.8
    const lfo = g.ctx.createOscillator(); lfo.frequency.value = 0.12
    const lg = g.ctx.createGain(); lg.gain.value = 160
    lfo.connect(lg).connect(bp.frequency)
    const wg = g.ctx.createGain(); wg.gain.value = 0.35
    src.connect(bp).connect(wg).connect(gain)
    src.start(); lfo.start()
    parts.push({ stop: () => { try { src.stop(); lfo.stop() } catch { /* already stopped */ } src.disconnect(); lfo.disconnect(); bp.disconnect(); wg.disconnect() } })
    // insects: sparse short chirps
    ambientTimer = window.setInterval(() => {
      if (Math.random() < 0.6) tone(g.ctx, gain, { type: 'sine', freq: 3800 + Math.random() * 900, gainDb: -34, decayMs: 70, when: g.ctx.currentTime })
    }, 700)
  }
  ambientNode = { stop: () => { for (const p of parts) p.stop(); gain.disconnect() } }
}
export function setAmbientLow(low: boolean): void { void low }   // hook for T.8: ambience softens between waves (adjust gain when needed)
export function stopNightAmbient(): void {
  clearInterval(ambientTimer); ambientTimer = 0
  ambientNode?.stop(); ambientNode = null
}

// ── Heartbeat when a zombie is nearby but unseen (vague warning) ───────────────
let beatTimer = 0
export function setNearbyZombieHeartbeat(on: boolean): void {
  if (on && !beatTimer) {
    const beat = () => {
      const g = getGraph()
      if (!g) return
      const t = g.ctx.currentTime
      tone(g.ctx, g.master, { type: 'sine', freq: 52, gainDb: -26, decayMs: 120, when: t })
      tone(g.ctx, g.master, { type: 'sine', freq: 52, gainDb: -26, decayMs: 120, when: t + 0.2 })
    }
    beat(); beatTimer = window.setInterval(beat, 800)
  } else if (!on && beatTimer) { clearInterval(beatTimer); beatTimer = 0 }
}

// ── Per-frame control: random growls every 3–8s, heavy footsteps, death sounds ─────
interface Zm { id: number; pos: [number, number, number]; flags: number; ztype?: string }
const nextGrowl = new Map<number, number>()
const lastPos = new Map<number, [number, number, number, boolean]>()
const walked = new Map<number, number>()
const wasDead = new Set<number>()

export function updateZombieAudio(dt: number, others: readonly Zm[], lookDir: readonly [number, number, number]): void {
  const now = performance.now()
  let near = false
  const seen = new Set<number>()
  for (const p of others) {
    if ((p.flags & NetFlag.Zombie) === 0) continue
    seen.add(p.id)
    const dead = (p.flags & NetFlag.Dead) !== 0
    if (dead) { if (!wasDead.has(p.id)) { wasDead.add(p.id); playZombieDeath(p.pos) } continue }
    wasDead.delete(p.id)
    const d = dist(p.pos)
    let ng = nextGrowl.get(p.id)
    if (ng === undefined) { ng = now + 1000 + Math.random() * 6000; nextGrowl.set(p.id, ng) }
    if (now >= ng) { nextGrowl.set(p.id, now + 3000 + Math.random() * 5000); playGrowl(p.pos, p.ztype === 'boss' || p.ztype === 'brute' ? 1.5 : 1) }
    const lp = lastPos.get(p.id)
    if (lp) {
      const step = Math.hypot(p.pos[0] - lp[0], p.pos[2] - lp[2])
      if (step < 3 && (p.flags & NetFlag.Grounded) !== 0) {
        const w = (walked.get(p.id) ?? 0) + step
        if (w >= 1.9) { walked.set(p.id, 0); playZombieStep(p.pos) } else walked.set(p.id, w)
      }
      lp[0] = p.pos[0]; lp[1] = p.pos[1]; lp[2] = p.pos[2]
    } else lastPos.set(p.id, [p.pos[0], p.pos[1], p.pos[2], false])
    // zombie within 8m but unseen (behind / more than 70° off the view direction): heartbeat
    if (d < 8) {
      const dx = (p.pos[0] - listenerPos[0]) / (d || 1), dz = (p.pos[2] - listenerPos[2]) / (d || 1)
      if (dx * lookDir[0] + dz * lookDir[2] < 0.35) near = true
    }
  }
  for (const id of [...lastPos.keys()]) if (!seen.has(id)) { lastPos.delete(id); nextGrowl.delete(id); walked.delete(id); wasDead.delete(id) }
  setNearbyZombieHeartbeat(near)
  void dt
}
