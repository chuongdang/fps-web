// Per-gun audio profiles (client only). Starting values follow plan/08-task-gun-audio.md,
// tune by ear with the F8 panel, then paste the JSON here.

export interface LayerDef {
  files: string[]         // picked at random, not repeating the file just played if there are ≥ 2
  gainDb: number
  pitch: number           // base playbackRate
  pitchRand: number       // ± random
  gainRandDb: number      // ± random
  delayMs: number
  synthDecayMs?: number   // length of the fallback synthesized sound (tail only)
  synthTailHz?: number    // synthesized tail: if set → bandpass around this frequency (less bass); otherwise → 1800Hz lowpass
}

export interface ThumpDef {   // synthesized bass layer
  gainDb: number
  startHz: number
  endHz: number
  durationMs: number
}

export type ReloadSynth = 'magout' | 'magin' | 'bolt' | 'shells' | 'insert'
export interface ReloadStep { file: string; at: number; synth: ReloadSynth; emptyOnly?: boolean }
export type ReloadSoundDef =
  // whole: a single full reload file played once instead of the steps; startFrac = fraction of the reload time before it starts playing, speed = minimum playback speed (pulls the chambering sound earlier)
  // (long guns wait for the lower-weapon animation to finish); boltFile plays after the magazine swap sound, when the raise animation starts
  // (boltAtFrac = RELOAD_UP_START of the viewmodel; always waits for the whole file to finish + a BOLT_GAP_MS pause so they stay distinct)
  | { kind: 'mag'; steps: ReloadStep[]; whole?: { file: string; gainDb: number; startFrac: number; speed?: number; boltFile?: string; boltAtFrac?: number } }
  | {
      kind: 'perRound'
      open: ReloadStep; eject: ReloadStep; close: ReloadStep
      insert: { file: string; from: number; to: number; synth: ReloadSynth }
    }

export interface GunSoundProfile {
  folder: string
  layers: { body: LayerDef; mech?: LayerDef; tail?: LayerDef }
  thump: ThumpDef
  eq: { lowShelfHz: number; lowShelfDb: number; highShelfHz: number; highShelfDb: number }
  shell: 'rifle' | 'pistol' | null     // revolver does not eject shells when firing
  shellDelayMs: number
  cockFile?: string                    // hammer cock between shots (~60% fireIntervalMs)
  reload: ReloadSoundDef
  dryfire: { file?: string; kind: 'rifle' | 'pistol' }
  draw: string
  maxVoices: number
  lowAmmoWarning?: boolean              // "tink" low-ammo sound; on by default
}

const rifleReload = (boltFile: string): ReloadSoundDef => ({
  kind: 'mag',
  steps: [
    { file: 'reload_magout', at: 0.15, synth: 'magout' },
    { file: 'reload_magin',  at: 0.55, synth: 'magin' },
    { file: boltFile,       at: 0.85, synth: 'bolt', emptyOnly: true },
  ],
})

/**
 * Synthesized shell casing sound (when shell_* files are missing): a chain of n bouncing "clink" hits, n = gainsDb.length.
 * The gap between hit 1→2 is firstGapMs, later gaps are multiplied by gapMul (bounces get closer together); the ring
 * of hit i = decayMs * decayMul^i. Each hit: a sine at a random frequency in [freqMin, freqMax] + a harmonic
 * at ×partialRatio (offset by partialDb), plus a "click" at clickDb on the first hit.
 */
export interface ShellSynthDef {
  firstGapMs: number; gapMul: number; gainsDb: number[]
  freqMin: number; freqMax: number
  partialRatio: number; partialDb: number
  decayMs: number; decayMul: number; clickDb: number
}
export const SHELL_SYNTH: Record<'rifle' | 'pistol', ShellSynthDef> = {
  rifle:  { firstGapMs: 60, gapMul: 0.55, gainsDb: [-20, -25, -29, -33], freqMin: 4800, freqMax: 6200, partialRatio: 2.4, partialDb: -12, decayMs: 50, decayMul: 0.65, clickDb: -14 },
  pistol: { firstGapMs: 50, gapMul: 0.55, gainsDb: [-23, -28, -32],      freqMin: 5600, freqMax: 7200, partialRatio: 2.4, partialDb: -12, decayMs: 40, decayMul: 0.65, clickDb: -16 },
}

export const GUN_SOUNDS: Record<number, GunSoundProfile> = {
  0: { // AK47 – thick, rumbling, raw
    folder: 'ak47',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03','shot_04'], gainDb: 0,  pitch: 0.95, pitchRand: 0.03, gainRandDb: 1, delayMs: 0 },
      mech: { files: ['mech_01'],                                gainDb: -4, pitch: 0.95, pitchRand: 0.04, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],                                gainDb: -2, pitch: 0.94, pitchRand: 0.02, gainRandDb: 1, delayMs: 40},
    },
    thump: { gainDb: -8, startHz: 130, endHz: 60, durationMs: 70 },
    eq: { lowShelfHz: 200, lowShelfDb: 3, highShelfHz: 4500, highShelfDb: 2 },
    shell: 'rifle', shellDelayMs: 420,
    reload: { kind: 'mag', whole: { file: 'reload_mag', gainDb: -3, startFrac: 0.14, boltFile: 'reload_bolt', boltAtFrac: 0.8 }, steps: [
      { file: 'reload_magout', at: 0.15, synth: 'magout' },
      { file: 'reload_magin',  at: 0.55, synth: 'magin' },
      { file: 'reload_bolt',   at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 8, lowAmmoWarning: false,
  },
  1: { // M16 – thin, sharp, tight
    folder: 'm16',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03','shot_04'], gainDb: 0,  pitch: 1.10, pitchRand: 0.03, gainRandDb: 1, delayMs: 0 },
      mech: { files: ['mech_01'],                                gainDb: -2, pitch: 1.15, pitchRand: 0.04, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],                                gainDb: -8, pitch: 1.08, pitchRand: 0.02, gainRandDb: 1, delayMs: 25 },
    },
    thump: { gainDb: -16, startHz: 180, endHz: 100, durationMs: 35 },
    eq: { lowShelfHz: 150, lowShelfDb: -4, highShelfHz: 2500, highShelfDb: 7 },
    shell: 'rifle', shellDelayMs: 400,
    reload: { kind: 'mag', whole: { file: 'reload_mag', gainDb: -3, startFrac: 0.14, boltFile: 'reload_bolt', boltAtFrac: 0.8 }, steps: [
      { file: 'reload_magout', at: 0.15, synth: 'magout' },
      { file: 'reload_magin',  at: 0.55, synth: 'magin' },
      { file: 'reload_bolt',   at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 8, lowAmmoWarning: false,
  },
  2: { // Colt – short pop, dry
    folder: 'colt',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03'], gainDb: -1, pitch: 1.06, pitchRand: 0.03, gainRandDb: 1, delayMs: 0 },
      mech: { files: ['mech_01'],                     gainDb: -6, pitch: 1.10, pitchRand: 0.04, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],                     gainDb: -6, pitch: 1.05, pitchRand: 0.02, gainRandDb: 1, delayMs: 25 },
    },
    thump: { gainDb: -12, startHz: 170, endHz: 85, durationMs: 45 },
    eq: { lowShelfHz: 250, lowShelfDb: -1, highShelfHz: 4000, highShelfDb: 3 },
    shell: 'pistol', shellDelayMs: 380,
    reload: { kind: 'mag', whole: { file: 'reload_mag', gainDb: -3, startFrac: 0, speed: 0.5, boltFile: 'reload_bolt', boltAtFrac: 0.6 }, steps: [
      { file: 'reload_magout', at: 0.2,  synth: 'magout' },
      { file: 'reload_magin',  at: 0.6,  synth: 'magin' },
      { file: 'reload_slide',  at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 4,
  },
  3: { // Revolver – close to the Colt, slightly more reverb
    folder: 'rulo',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03'], gainDb: -1, pitch: 1.0, pitchRand: 0.03, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],                     gainDb: -4, pitch: 1.0, pitchRand: 0.02, gainRandDb: 1, delayMs: 35, synthDecayMs: 550 },
    },
    thump: { gainDb: -10, startHz: 160, endHz: 80, durationMs: 60 },
    eq: { lowShelfHz: 250, lowShelfDb: -1, highShelfHz: 4000, highShelfDb: 3 },
    shell: null, shellDelayMs: 0,
    reload: { kind: 'perRound',
      open:   { file: 'reload_open',   at: 0.08, synth: 'magout' },
      eject:  { file: 'reload_eject',  at: 0.22, synth: 'shells' },
      insert: { file: 'reload_insert', from: 0.35, to: 0.8, synth: 'insert' },
      close:  { file: 'reload_close',  at: 0.88, synth: 'magin' },
    },
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 4,
  },
  4: { // Sniper – deep boom, long tail, bolt pull after each shot (no dedicated file yet: uses synthesized sound)
    folder: 'sniper',
    layers: {
      body: { files: ['shot_01','shot_02'], gainDb: 0,  pitch: 0.8, pitchRand: 0.02, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],           gainDb: -2, pitch: 0.8, pitchRand: 0.02, gainRandDb: 1, delayMs: 50, synthDecayMs: 900 },
    },
    thump: { gainDb: -4, startHz: 120, endHz: 50, durationMs: 110 },
    eq: { lowShelfHz: 180, lowShelfDb: 3, highShelfHz: 3500, highShelfDb: 1 },
    shell: 'rifle', shellDelayMs: 700,
    cockFile: 'cock',
    reload: { kind: 'mag', whole: { file: 'reload_mag', gainDb: -3, startFrac: 0.14, boltFile: 'reload_bolt', boltAtFrac: 0.85 }, steps: [
      { file: 'reload_magout', at: 0.15, synth: 'magout' },
      { file: 'reload_magin',  at: 0.55, synth: 'magin' },
      { file: 'reload_bolt',   at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 4, lowAmmoWarning: false,
  },
  7: { // SMG – tight, rapid, dry (no dedicated file yet: uses synthesized sound)
    folder: 'smg',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03'], gainDb: -2, pitch: 1.2, pitchRand: 0.04, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],                     gainDb: -10, pitch: 1.2, pitchRand: 0.02, gainRandDb: 1, delayMs: 20 },
    },
    thump: { gainDb: -16, startHz: 190, endHz: 110, durationMs: 30 },
    eq: { lowShelfHz: 180, lowShelfDb: -3, highShelfHz: 3000, highShelfDb: 5 },
    shell: 'pistol', shellDelayMs: 380,
    reload: rifleReload('reload_bolt'),
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 8, lowAmmoWarning: false,
  },
  5: { // Shotgun – loud, raw boom, short tail; pump action between shots (no dedicated file yet: uses synthesized sound)
    folder: 'shotgun',
    layers: {
      body: { files: ['shot_01','shot_02'], gainDb: 0,  pitch: 0.85, pitchRand: 0.03, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],           gainDb: -4, pitch: 0.85, pitchRand: 0.02, gainRandDb: 1, delayMs: 35, synthDecayMs: 500 },
    },
    thump: { gainDb: -3, startHz: 150, endHz: 60, durationMs: 90 },
    eq: { lowShelfHz: 200, lowShelfDb: 3, highShelfHz: 3000, highShelfDb: 0 },
    shell: null, shellDelayMs: 0,
    cockFile: 'pump',
    reload: { kind: 'perRound',
      open:   { file: 'reload_open',   at: 0.05, synth: 'magout' },
      eject:  { file: 'reload_eject',  at: 0.10, synth: 'shells' },
      insert: { file: 'reload_insert', from: 0.2, to: 0.8, synth: 'insert' },
      close:  { file: 'reload_close',  at: 0.9, synth: 'bolt' },
    },
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 4, lowAmmoWarning: false,
  },
};

/** Every file (key, no extension) the profiles + common sounds may use — for preloading. */
export function allGunSoundKeys(gunKey: (f: string, n: string) => string, commonKey: (n: string) => string): string[] {
  const keys: string[] = []
  for (const p of Object.values(GUN_SOUNDS)) {
    for (const l of [p.layers.body, p.layers.mech, p.layers.tail]) {
      if (l) for (const f of l.files) keys.push(gunKey(p.folder, f))
    }
    if (p.reload.kind === 'mag') {
      for (const s of p.reload.steps) keys.push(gunKey(p.folder, s.file))
    } else {
      const r = p.reload
      for (const f of [r.open.file, r.eject.file, r.close.file, r.insert.file]) keys.push(gunKey(p.folder, f))
    }
    if (p.dryfire.file) keys.push(gunKey(p.folder, p.dryfire.file))
    if (p.cockFile) keys.push(gunKey(p.folder, p.cockFile))
    keys.push(gunKey(p.folder, p.draw))
  }
  keys.push(commonKey('reload_mag'), commonKey('reload_bolt'))
  for (const n of ['dryfire_rifle', 'dryfire_pistol', 'lowammo']) keys.push(commonKey(n))
  for (const kind of ['rifle', 'pistol']) for (let i = 1; i <= 3; i++) keys.push(commonKey(`shell_${kind}_0${i}`))
  return keys
}
