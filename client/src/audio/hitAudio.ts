// Hit, kill and being-hit sounds (A.8). UI audio: goes straight into master, bypassing the gun EQ.
import { dbToGain, randSpread, pickNoRepeat, ComboTracker, HitDeduper } from './audioMath'
import { getGraph, listenerPos, settings, type AudioGraph } from './context'
import { tone, noise } from './synth'
import { commonKey, getBuffer } from './loader'

export type HitKind = 'body' | 'head' | 'kill' | 'killHead'
export type HitMode = 'file' | 'synth' | 'both'

/** Synthesized layer parameters — mutable so they can be tuned in the F8 panel. */
export const HIT = {
  body: { crackHz: 3200, crackQ: 2, crackDb: -6, crackDecayMs: 30, bodyHz: 1250, bodyDb: -12, bodyDecayMs: 70 },
  head: { crackHz: 4500, ping1Hz: 2100, ping1Db: -10, ping1DecayMs: 380, ping2Ratio: 2.76, ping2Db: -16, ping2DecayMs: 250, ping3Ratio: 5.4, ping3Db: -22, ping3DecayMs: 150 },
  thick: { startHz: 220, endHz: 120, db: -14, decayMs: 60 },
  kill: { thumpStartHz: 160, thumpEndHz: 55, thumpDb: -6, thumpDecayMs: 180, n1Hz: 880, n1Db: -12, n1DecayMs: 120, n2Hz: 1320, n2HeadHz: 1760, n2Db: -12, n2DecayMs: 220, n2AtMs: 70 },
  hurt: { noiseHz: 900, noiseDb: -8, noiseDecayMs: 80, thumpStartHz: 140, thumpEndHz: 70, thumpDb: -10, thumpDecayMs: 120 },
  // Fall pain: heavy "thud" + crunchy snap + breath forced out of the lungs (synthesized, no file). Grows louder with damage (0..fullDmg)
  fall: { thumpStartHz: 95, thumpEndHz: 38, thumpDb: -3, thumpDecayMs: 260, crunchHz: 650, crunchDb: -8, crunchDecayMs: 110, grunt1Hz: 190, grunt2Hz: 110, gruntDb: -13, gruntDecayMs: 220, gruntAtMs: 40, breathHz: 1400, breathDb: -14, breathDecayMs: 320, breathAtMs: 90, minScale: 0.45, fullDmg: 40 },
  mode: { body: 'both', head: 'both', kill: 'both', killHead: 'both' } as Record<HitKind, HitMode>,
}

const WEIGHT: Record<HitKind, number> = { body: 1, head: 2, kill: 3, killHead: 4 }
const FILES: Record<HitKind, string[]> = {
  body: ['hit_body_01', 'hit_body_02', 'hit_body_03'],
  head: ['hit_head_01', 'hit_head_02'],
  kill: ['kill'],
  killHead: ['kill_head'],
}
export const HIT_FILE_NAMES: string[] = [...Object.values(FILES).flat(), 'hurt_01', 'hurt_02', 'hurt_03']
/** The user's personal fall pain sound: client/public/sounds/local/player/pl_fallpain{1..3}.wav (gitignored, not packaged). Missing = use the synthesized sound. */
export const FALL_HURT_KEYS = ['local/player/pl_fallpain1', 'local/player/pl_fallpain2', 'local/player/pl_fallpain3']

const combo = new ComboTracker()
const dedupe = new HitDeduper()
const lastFile = new Map<string, string>()

function playFile(g: AudioGraph, key: string, rate: number, db: number, dest: AudioNode, when: number): void {
  const src = g.ctx.createBufferSource()
  const gn = g.ctx.createGain()
  src.buffer = getBuffer(key)!
  src.playbackRate.value = rate
  gn.gain.value = dbToGain(db)
  src.connect(gn).connect(dest)
  src.start(when)
  src.onended = () => { src.disconnect(); gn.disconnect() }
}

function synthCrack(g: AudioGraph, hz: number, m: number, t: number): void {
  const b = HIT.body
  noise(g.ctx, g.master, { filter: 'bandpass', freq: hz * m, q: b.crackQ, gainDb: b.crackDb + randSpread(1), decayMs: b.crackDecayMs, when: t })
}

function synthThick(g: AudioGraph, m: number, t: number): void {
  const k = HIT.thick
  tone(g.ctx, g.master, { type: 'sine', freq: k.startHz * m, freqEnd: k.endHz * m, gainDb: k.db, decayMs: k.decayMs, when: t })
}

function synthBody(g: AudioGraph, m: number, t: number, crackHz: number): void {
  synthCrack(g, crackHz, m, t)
  tone(g.ctx, g.master, { type: 'triangle', freq: HIT.body.bodyHz * m, gainDb: HIT.body.bodyDb, decayMs: HIT.body.bodyDecayMs, when: t })
  synthThick(g, m, t)
}

function synthPing(g: AudioGraph, m: number, t: number): void {
  const h = HIT.head
  const parts: [number, number, number][] = [
    [h.ping1Hz, h.ping1Db, h.ping1DecayMs],
    [h.ping1Hz * h.ping2Ratio, h.ping2Db, h.ping2DecayMs],
    [h.ping1Hz * h.ping3Ratio, h.ping3Db, h.ping3DecayMs],
  ]
  for (const [hz, db, decay] of parts) tone(g.ctx, g.master, { type: 'sine', freq: hz * m, gainDb: db, decayMs: decay, when: t })
}

function synthKill(g: AudioGraph, t: number, head: boolean): void {
  const k = HIT.kill
  tone(g.ctx, g.master, { type: 'sine', freq: k.thumpStartHz, freqEnd: k.thumpEndHz, gainDb: k.thumpDb, decayMs: k.thumpDecayMs, when: t })
  tone(g.ctx, g.master, { type: 'triangle', freq: k.n1Hz, gainDb: k.n1Db, decayMs: k.n1DecayMs, when: t })
  tone(g.ctx, g.master, { type: 'triangle', freq: head ? k.n2HeadHz : k.n2Hz, gainDb: k.n2Db, decayMs: k.n2DecayMs, when: t + k.n2AtMs / 1000 })
  if (head) synthPing(g, 1, t)
}

/** Lowers own gunshot volume by -4dB for 150ms so the kill "confirm" sound stands out. */
function duckGuns(g: AudioGraph): void {
  const now = g.ctx.currentTime
  const p = g.gunGroup.gain
  p.cancelScheduledValues(now)
  p.setValueAtTime(dbToGain(-4), now)
  p.linearRampToValueAtTime(1, now + 0.15)
}

/** Called from HitConfirm/Kill. Returns true if it actually played (not merged). */
export function playHit(kind: HitKind): boolean {
  const g = getGraph()
  if (!g) return false
  const nowMs = performance.now()
  if (!dedupe.accept(nowMs, WEIGHT[kind])) return false

  const t = g.ctx.currentTime
  const isKill = kind === 'kill' || kind === 'killHead'
  const head = kind === 'head' || kind === 'killHead'
  const m = isKill ? 1 : combo.hit(nowMs) * (1 + randSpread(0.02))   // combo applies to normal hits only

  const files = FILES[kind].map(f => commonKey(f)).filter(k => getBuffer(k))
  const mode = HIT.mode[kind]
  const useFile = mode !== 'synth' && files.length > 0

  if (useFile) {
    const key = pickNoRepeat(files, lastFile.get(kind), Math.random)!
    lastFile.set(kind, key)
    playFile(g, key, m, randSpread(1), g.master, t)
    // files are usually thin, lacking bass → 'both' adds a synthesized thickness layer
    if (mode === 'both') {
      if (isKill) tone(g.ctx, g.master, { type: 'sine', freq: HIT.kill.thumpStartHz, freqEnd: HIT.kill.thumpEndHz, gainDb: HIT.kill.thumpDb, decayMs: HIT.kill.thumpDecayMs, when: t })
      else synthThick(g, m, t)
    }
  } else if (isKill) {
    synthKill(g, t, head)
  } else {
    synthBody(g, m, t, head ? HIT.head.crackHz : HIT.body.crackHz)
    if (head) synthPing(g, m, t)
  }

  if (isKill) duckGuns(g)
  return true
}

// ── Being hit (victim) ───────────────────────────────────────────────────────
/** dir = direction from the player to the shooter (no need to normalize). Places the source 1m away in that direction. */
export function playHurt(dirX: number, dirY: number, dirZ: number): void {
  const g = getGraph()
  if (!g) return
  const len = Math.hypot(dirX, dirY, dirZ) || 1
  const pn = g.ctx.createPanner()
  pn.panningModel = 'equalpower'
  pn.distanceModel = 'inverse'
  pn.refDistance = 1
  pn.positionX.value = listenerPos[0] + dirX / len
  pn.positionY.value = listenerPos[1] + dirY / len
  pn.positionZ.value = listenerPos[2] + dirZ / len
  pn.connect(g.master)

  const t = g.ctx.currentTime
  const h = HIT.hurt
  const files = [1, 2, 3].map(i => commonKey(`hurt_0${i}`)).filter(k => getBuffer(k))
  const key = pickNoRepeat(files, lastFile.get('hurt'), Math.random)
  if (key) {
    lastFile.set('hurt', key)
    playFile(g, key, 1 + randSpread(0.03), 0, pn, t)
  } else {
    noise(g.ctx, pn, { filter: 'lowpass', freq: h.noiseHz, gainDb: h.noiseDb, decayMs: h.noiseDecayMs, when: t })
  }
  tone(g.ctx, pn, { type: 'sine', freq: h.thumpStartHz, freqEnd: h.thumpEndHz, gainDb: h.thumpDb, decayMs: h.thumpDecayMs, when: t })
}

/** Fall pain from a height (CS-style): plays at the center of the player's head (no direction). damage = health just lost. */
export function playFallHurt(damage: number): void {
  const g = getGraph()
  if (!g) return
  const f = HIT.fall
  const sc = Math.min(1, f.minScale + (1 - f.minScale) * damage / f.fullDmg)   // light → soft & high, heavy → loud & deep
  const dbSc = 20 * Math.log10(sc)
  const m = 1 + randSpread(0.06) + (1 - sc) * 0.25
  const t = g.ctx.currentTime
  const files = FALL_HURT_KEYS.filter(k => getBuffer(k))
  if (files.length > 0) {   // personal file available: use the file (quieter when light), skip synthesis
    const key = pickNoRepeat(files, lastFile.get('fall'), Math.random)
    if (key) { lastFile.set('fall', key); playFile(g, key, m, dbSc, g.master, t); return }
  }
  // 1. thud on the ground
  tone(g.ctx, g.master, { type: 'sine', freq: f.thumpStartHz * m, freqEnd: f.thumpEndHz * m, gainDb: f.thumpDb + dbSc, decayMs: f.thumpDecayMs, when: t })
  // 2. bones/joints: low narrow-band noise
  noise(g.ctx, g.master, { filter: 'bandpass', freq: f.crunchHz * m, q: 1.5, gainDb: f.crunchDb + dbSc, decayMs: f.crunchDecayMs, when: t })
  // 3. the "oof": triangle wave with falling pitch, then an exhaled breath (noise filtered ~formant) right after
  const tg = t + f.gruntAtMs / 1000
  tone(g.ctx, g.master, { type: 'triangle', freq: f.grunt1Hz * m, freqEnd: f.grunt2Hz * m, gainDb: f.gruntDb + dbSc, attackMs: 8, decayMs: f.gruntDecayMs, when: tg })
  noise(g.ctx, g.master, { filter: 'bandpass', freq: f.breathHz * m, freqEnd: f.breathHz * m * 0.6, q: 0.8, gainDb: f.breathDb + dbSc, attackMs: 15, decayMs: f.breathDecayMs, when: t + f.breathAtMs / 1000 })
}

// ── Heartbeat at low health ──────────────────────────────────────────────────────
const LOW_HEALTH = 30
const BEAT_PERIOD_MS = 900
let heartTimer = 0

function beat(): void {
  const g = getGraph()
  if (!g) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.master, { type: 'sine', freq: 55, gainDb: -28, decayMs: 110, when: t })
  tone(g.ctx, g.master, { type: 'sine', freq: 55, gainDb: -28, decayMs: 110, when: t + 0.22 })   // 2 beats per cycle
}

/** Called when health changes. Below 30: the heartbeat loops until health is restored/respawn. */
export function setHealthForAudio(hp: number): void {
  const want = settings.heartbeat && hp > 0 && hp < LOW_HEALTH
  if (want && !heartTimer) {
    beat()
    heartTimer = window.setInterval(beat, BEAT_PERIOD_MS)
  } else if (!want && heartTimer) {
    clearInterval(heartTimer)
    heartTimer = 0
  }
}
