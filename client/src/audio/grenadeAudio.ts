// Grenade audio (plan 12, G.8): pin, spoon, throw swing, bounce, layered explosion, tinnitus. Each sound uses a file if available
// (client/public/sounds/grenade/*.ogg) otherwise it is synthesized. All numbers live in GSND (mutable) for tuning in the F8 panel Grenade tab.
import { dbToGain, distanceCutoff, randSpread } from './audioMath'
import { getGraph, listenerPos, type AudioGraph } from './context'
import { tone, noise } from './synth'
import { getBuffer } from './loader'

type Vec3 = [number, number, number]

export const GSND = {
  pin:    { toneHz: 3200, toneDb: -14, toneDecayMs: 120, noiseHz: 5000, noiseDb: -16, noiseDecayMs: 10, nearM: 6, nearDb: -8 },
  spoon:  { startHz: 2400, endHz: 1800, db: -16, decayMs: 200 },
  throw:  { startHz: 400, endHz: 1500, db: -16, durMs: 150 },
  bounce: { noiseHz: 1800, q: 3, noiseDecayMs: 40, toneHz: 900, toneDecayMs: 60, minDb: -24, maxDb: -10, maxSpeed: 10 },
  explode: {
    crackHz: 1500, crackDb: 4, crackDecayMs: 90,
    bodyHz: 900, bodyDb: 6, bodyDecayMs: 900,
    thumpStartHz: 90, thumpEndHz: 24, thumpDb: 8, thumpDecayMs: 900,
    boomHz: 220, boomDb: 6, boomDecayMs: 1600,   // long, deep boom layer
    fileDb: 6,
    tailHz: 450, tailAttackMs: 40, tailDb: -4, tailDecayMs: 3800,
    debrisN: 8, debrisDb: -22, debrisMinS: 0.3, debrisMaxS: 1.2,
    farM: 40,   // beyond this range only thump + tail remain
  },
  tinnitus: { enabled: true, radiusM: 4, toneHz: 3500, toneDb: -18, durS: 2, muffleHz: 700 },
}

export const GRENADE_SOUND_FILES = ['pin', 'spoon', 'throw', 'bounce_01', 'bounce_02', 'explode_01', 'explode_02', 'explode_03', 'smoke_burst'].map(n => `grenade/${n}`)

const dist = (o: Vec3): number => Math.hypot(o[0] - listenerPos[0], o[1] - listenerPos[1], o[2] - listenerPos[2])

function panner(g: AudioGraph, o: Vec3): PannerNode {
  const pn = g.ctx.createPanner()
  pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.refDistance = 4; pn.rolloffFactor = 1.2
  pn.positionX.value = o[0]; pn.positionY.value = o[1]; pn.positionZ.value = o[2]
  return pn
}

// Destination of a sound: own → master; positional → panner + distance lowpass → master
function sink(g: AudioGraph, pos: Vec3 | null, extraDb = 0): AudioNode {
  const gain = g.ctx.createGain()
  gain.gain.value = dbToGain(extraDb)
  if (!pos) { gain.connect(g.master); return gain }
  const lp = g.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = distanceCutoff(dist(pos))
  gain.connect(lp).connect(panner(g, pos)).connect(g.master)
  return gain
}

function playFile(g: AudioGraph, key: string, dest: AudioNode, when: number, db: number, rate = 1): boolean {
  const buf = getBuffer(key)
  if (!buf) return false
  const src = g.ctx.createBufferSource(), gn = g.ctx.createGain()
  src.buffer = buf; src.playbackRate.value = rate; gn.gain.value = dbToGain(db)
  src.connect(gn).connect(dest)
  src.start(when)
  src.onended = () => { src.disconnect(); gn.disconnect() }
  return true
}

/** Pull pin: only the local player hears it; others within pin.nearM meters hear it quietly (pos of the player pulling) */
export function playPin(pos?: Vec3): void {
  const g = getGraph()
  if (!g) return
  const p = GSND.pin, t = g.ctx.currentTime
  if (pos && dist(pos) > p.nearM) return
  const out = sink(g, pos ?? null, pos ? p.nearDb : 0)
  if (playFile(g, 'grenade/pin', out, t, 0)) return
  tone(g.ctx, out, { type: 'sine', freq: p.toneHz, gainDb: p.toneDb, decayMs: p.toneDecayMs, when: t })
  noise(g.ctx, out, { filter: 'highpass', freq: p.noiseHz, gainDb: p.noiseDb, decayMs: p.noiseDecayMs, when: t })
}

/** Grenade leaves the hand: spoon pops off ("toinggg") */
export function playSpoon(pos?: Vec3): void {
  const g = getGraph()
  if (!g) return
  const p = GSND.spoon, t = g.ctx.currentTime
  const out = sink(g, pos ?? null)
  if (playFile(g, 'grenade/spoon', out, t, 0)) return
  tone(g.ctx, out, { type: 'sine', freq: p.startHz, freqEnd: p.endHz, gainDb: p.db, decayMs: p.decayMs, when: t })
}

/** Throwing swing: whoosh of wind */
export function playThrowSwish(pos?: Vec3): void {
  const g = getGraph()
  if (!g) return
  const p = GSND.throw, t = g.ctx.currentTime
  const out = sink(g, pos ?? null)
  if (playFile(g, 'grenade/throw', out, t, 0)) return
  noise(g.ctx, out, { filter: 'bandpass', freq: p.startHz, freqEnd: p.endHz, q: 1.2, gainDb: p.db, attackMs: 40, decayMs: p.durMs, when: t })
}

/** Each bounce; volume scales with impact speed (−24 → −10 dB) */
export function playBounce(pos: Vec3, speed: number): void {
  const g = getGraph()
  if (!g) return
  const p = GSND.bounce, t = g.ctx.currentTime
  const k = Math.min(1, Math.max(0, speed / p.maxSpeed))
  const db = p.minDb + (p.maxDb - p.minDb) * k
  const out = sink(g, pos)
  const f = ['grenade/bounce_01', 'grenade/bounce_02'][Math.random() < 0.5 ? 0 : 1]!
  if (playFile(g, f, out, t, db, 1 + randSpread(0.05))) return
  noise(g.ctx, out, { filter: 'bandpass', freq: p.noiseHz * (1 + randSpread(0.1)), q: p.q, gainDb: db, decayMs: p.noiseDecayMs, when: t })
  tone(g.ctx, out, { type: 'sine', freq: p.toneHz * (1 + randSpread(0.1)), gainDb: db - 2, decayMs: p.toneDecayMs, when: t })
}

/** Layered explosion sound. `alive`: the listener is alive (only then tinnitus applies) */
export function playExplode(pos: Vec3, alive = true): void {
  const g = getGraph()
  if (!g) return
  const e = GSND.explode, c = g.ctx, t = c.currentTime
  const d = dist(pos)
  const out = sink(g, pos)
  const far = d > e.farM
  if (!far) {
    // crack + body, or an explode_01..03 file replacing both layers
    const f = `grenade/explode_0${1 + Math.floor(Math.random() * 3)}`
    if (!playFile(g, f, out, t, e.fileDb, 1 + randSpread(0.04))) {
      noise(c, out, { filter: 'highpass', freq: e.crackHz, gainDb: e.crackDb, decayMs: e.crackDecayMs, when: t })
      noise(c, out, { filter: 'lowpass', freq: e.bodyHz, gainDb: e.bodyDb, decayMs: e.bodyDecayMs, when: t })
    }
  }
  tone(c, out, { type: 'sine', freq: e.thumpStartHz, freqEnd: e.thumpEndHz, gainDb: e.thumpDb, decayMs: e.thumpDecayMs, when: t })
  noise(c, out, { filter: 'lowpass', freq: e.boomHz, gainDb: e.boomDb, decayMs: e.boomDecayMs, when: t })
  noise(c, out, { filter: 'lowpass', freq: e.tailHz, gainDb: e.tailDb, attackMs: e.tailAttackMs, decayMs: e.tailDecayMs, when: t })
  if (!far) {   // debris clattering down here and there after the blast
    for (let i = 0; i < e.debrisN; i++) {
      const at = t + e.debrisMinS + Math.random() * (e.debrisMaxS - e.debrisMinS)
      noise(c, out, { filter: 'bandpass', freq: 2200 + Math.random() * 3000, q: 4, gainDb: e.debrisDb + randSpread(3), decayMs: 25 + Math.random() * 30, when: at })
    }
  }
  if (alive && d < GSND.tinnitus.radiusM) tinnitus()
}

/** Smoke grenade bursts: a "puff" + hissing for ~1.5s (grenade/smoke_burst file if available). No tinnitus, no explosion */
export function playSmokeBurst(pos: Vec3): void {
  const g = getGraph()
  if (!g) return
  const c = g.ctx, t = c.currentTime
  const out = sink(g, pos)
  if (playFile(g, 'grenade/smoke_burst', out, t, -2, 1 + randSpread(0.03))) return
  tone(c, out, { type: 'sine', freq: 140, freqEnd: 55, gainDb: -8, decayMs: 160, when: t })
  noise(c, out, { filter: 'lowpass', freq: 900, gainDb: -9, decayMs: 220, when: t })
  noise(c, out, { filter: 'bandpass', freq: 5200, freqEnd: 2400, q: 0.7, gainDb: -16, attackMs: 60, decayMs: 1400, when: t + 0.04 })   // hiss
}

/** Tinnitus: a fading 3500Hz tone + master muffled by a 700Hz lowpass, then gradually opening back to 20kHz */
export function tinnitus(): void {
  const g = getGraph(), s = GSND.tinnitus
  if (!g || !s.enabled) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.comp, { type: 'sine', freq: s.toneHz, gainDb: s.toneDb, attackMs: 30, decayMs: s.durS * 1000, when: t })   // goes straight into the compressor: not muffled by the lowpass itself
  const f = g.muffle.frequency
  f.cancelScheduledValues(t)
  f.setValueAtTime(s.muffleHz, t)
  f.exponentialRampToValueAtTime(20000, t + s.durS)
}

