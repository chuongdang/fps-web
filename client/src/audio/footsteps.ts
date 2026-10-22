// Footstep + landing sounds. All parameters live in FOOTSTEPS (tune in F8 > Footsteps).
import { dbToGain, randSpread, pickNoRepeat, distanceCutoff } from './audioMath'
import { getGraph, listenerPos, type AudioGraph } from './context'
import { tone, noise } from './synth'
import { commonKey, getBuffer } from './loader'

export const FOOTSTEPS = {
  stepDistM: 2.4,       // one step every 2.4m
  minSpeed: 1,          // m/s: slower than this does not count as stepping
  own: {
    gainDb: -20, crouchDb: -10,                 // crouching: an extra −10dB
    highpassHz: 180, lowShelfHz: 250, lowShelfDb: -5, highShelfHz: 3000, highShelfDb: 2,
    pitchRand: 0.07, gainRandDb: 2, pan: 0.15,  // alternates left/right ±pan
  },
  landing: { minFallSpeed: 4, gainDb: -14, thumpDb: -6 },   // fall speed (m/s) > minFallSpeed
  other: { gainDb: -14, maxDistM: 25, refDistance: 3, rolloff: 1.5 },
  synth: { bandHz: 1100, bandQ: 1.2, decayMs: 45, shuffleHz: 3000, shuffleDecayMs: 15, shuffleDb: -10 },
}

export const FOOTSTEP_FILES = ['footstep_01', 'footstep_02', 'footstep_03', 'footstep_04', 'land_01'].map(commonKey)

// ── Own bus: 2 panners left/right ─► highpass ─► lowshelf ─► highshelf ─► master ──
interface Bus { left: StereoPannerNode; right: StereoPannerNode; hp: BiquadFilterNode; low: BiquadFilterNode; high: BiquadFilterNode }
let bus: Bus | null = null
let nextRight = false
let lastFile: string | undefined

function applyBus(b: Bus): void {
  const o = FOOTSTEPS.own
  b.hp.frequency.value = o.highpassHz
  b.low.frequency.value = o.lowShelfHz; b.low.gain.value = o.lowShelfDb
  b.high.frequency.value = o.highShelfHz; b.high.gain.value = o.highShelfDb
  b.left.pan.value = -o.pan
  b.right.pan.value = o.pan
}

function ensureBus(g: AudioGraph): Bus {
  if (!bus) {
    const c = g.ctx
    const hp = c.createBiquadFilter(); hp.type = 'highpass'
    const low = c.createBiquadFilter(); low.type = 'lowshelf'
    const high = c.createBiquadFilter(); high.type = 'highshelf'
    const left = c.createStereoPanner(), right = c.createStereoPanner()
    left.connect(hp); right.connect(hp)
    hp.connect(low).connect(high).connect(g.master)
    bus = { left, right, hp, low, high }
    applyBus(bus)
  }
  return bus
}

/** Called when FOOTSTEPS.own is edited in the F8 panel. */
export function refreshFootstepBus(): void {
  if (bus) applyBus(bus)
}

/** One step (file if available, otherwise synthesized) into `dest`; `pitch` multiplies the frequency/playback rate. */
function emitStep(g: AudioGraph, dest: AudioNode, when: number, pitch: number, db: number, landing: boolean): void {
  const files = (landing ? ['land_01'] : ['footstep_01', 'footstep_02', 'footstep_03', 'footstep_04'])
    .map(commonKey).filter(k => getBuffer(k))
  const key = pickNoRepeat(files, lastFile, Math.random)
  if (key) {
    lastFile = key
    const src = g.ctx.createBufferSource()
    const gn = g.ctx.createGain()
    src.buffer = getBuffer(key)!
    src.playbackRate.value = pitch
    gn.gain.value = dbToGain(db)
    src.connect(gn).connect(dest)
    src.start(when)
    src.onended = () => { src.disconnect(); gn.disconnect() }
    return
  }
  // Fallback: step body (bandpass) + shoe-sole scuff (highpass, quieter)
  const s = FOOTSTEPS.synth
  noise(g.ctx, dest, { filter: 'bandpass', freq: s.bandHz * pitch, q: s.bandQ, gainDb: db, decayMs: s.decayMs, when })
  noise(g.ctx, dest, { filter: 'highpass', freq: s.shuffleHz * pitch, gainDb: db + s.shuffleDb, decayMs: s.shuffleDecayMs, when })
  if (landing) tone(g.ctx, dest, { type: 'sine', freq: 80 * pitch, freqEnd: 50 * pitch, gainDb: db + FOOTSTEPS.landing.thumpDb, decayMs: 90, when })
}

/** Own footsteps. Alternates left/right. */
export function playFootstep(crouching: boolean): void {
  const g = getGraph()
  if (!g) return
  const o = FOOTSTEPS.own
  const b = ensureBus(g)
  const db = o.gainDb + (crouching ? o.crouchDb : 0) + randSpread(o.gainRandDb)
  emitStep(g, nextRight ? b.right : b.left, g.ctx.currentTime, 1 + randSpread(o.pitchRand), db, false)
  nextRight = !nextRight
}

/** Own landing (a single sound, centered between the ears). */
export function playLanding(): void {
  const g = getGraph()
  if (!g) return
  const o = FOOTSTEPS.own
  const b = ensureBus(g)
  const db = FOOTSTEPS.landing.gainDb + randSpread(o.gainRandDb)
  const mid = g.ctx.createStereoPanner()   // pan 0, into the same filter chain
  mid.connect(b.hp)
  emitStep(g, mid, g.ctx.currentTime, 1 + randSpread(o.pitchRand), db, true)
  setTimeout(() => mid.disconnect(), 1000)
}

/** Other players' footsteps: only within maxDistM, panner + distance lowpass like gunshots. */
export function playFootstepOther(origin: [number, number, number]): void {
  const g = getGraph()
  if (!g) return
  const f = FOOTSTEPS.other
  const d = Math.hypot(origin[0] - listenerPos[0], origin[1] - listenerPos[1], origin[2] - listenerPos[2])
  if (d > f.maxDistM) return
  const c = g.ctx
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'
  lp.frequency.value = distanceCutoff(d)
  const pn = c.createPanner()
  pn.panningModel = 'equalpower'
  pn.distanceModel = 'inverse'
  pn.refDistance = f.refDistance
  pn.rolloffFactor = f.rolloff
  pn.positionX.value = origin[0]; pn.positionY.value = origin[1]; pn.positionZ.value = origin[2]
  lp.connect(pn).connect(g.master)
  emitStep(g, lp, c.currentTime, 1 + randSpread(FOOTSTEPS.own.pitchRand), f.gainDb + randSpread(FOOTSTEPS.own.gainRandDb), false)
  setTimeout(() => { lp.disconnect(); pn.disconnect() }, 1000)
}
