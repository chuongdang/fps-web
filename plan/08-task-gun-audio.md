# Standalone task – New gun set + per-gun audio

Do this after Phase 2 is finished (task 2.4). It can be done before or after Phase 3 and does not touch netcode.

Gun set: **AK47**, **M16**, **Colt** (semi-automatic pistol), **Rulo** (revolver).

Order of work: A.1 → A.2 → A.3 → A.4 → A.5 (tuning panel) → A.6 (reload) → A.7 (out of ammo) → A.8 (hit sounds). A.6–A.8 share the synth module from A.4, so A.4 must be done first.

---

## Task A.1 – Replace the gun set in `shared/src/weapons.ts`

Replace `WEAPONS` (the old Rifle/Pistol) with the 4 guns below. Add a `slot` field: 1 = primary weapon, 2 = secondary weapon. Keys 1–4 select a gun in id order (temporary, there is no loadout selection system yet).

```ts
export const WEAPONS: WeaponDef[] = [
  { id: 0, name: 'AK47', slot: 1, auto: true,
    damage: 30, headMult: 3.5, legMult: 0.75,
    fireIntervalMs: 100, magSize: 30, reloadMs: 2300, range: 200,
    spreadDeg: { stand: 0.5, move: 1.8, air: 4.5, crouch: 0.3 },
    recoilPitchDeg: 0.85, recoilYawDeg: 0.45, recoilRecoverDegPerSec: 7 },

  { id: 1, name: 'M16', slot: 1, auto: true,
    damage: 24, headMult: 4, legMult: 0.75,
    fireIntervalMs: 85, magSize: 30, reloadMs: 2000, range: 220,
    spreadDeg: { stand: 0.3, move: 1.4, air: 4, crouch: 0.2 },
    recoilPitchDeg: 0.5, recoilYawDeg: 0.2, recoilRecoverDegPerSec: 9 },

  { id: 2, name: 'Colt', slot: 2, auto: false,
    damage: 34, headMult: 3, legMult: 0.75,
    fireIntervalMs: 220, magSize: 7, reloadMs: 1500, range: 120,
    spreadDeg: { stand: 0.3, move: 1.0, air: 3, crouch: 0.2 },
    recoilPitchDeg: 1.4, recoilYawDeg: 0.25, recoilRecoverDegPerSec: 10 },

  { id: 3, name: 'Rulo', slot: 2, auto: false,
    damage: 55, headMult: 2, legMult: 0.8,
    fireIntervalMs: 450, magSize: 6, reloadMs: 2600, range: 140,
    spreadDeg: { stand: 0.2, move: 1.6, air: 4, crouch: 0.15 },
    recoilPitchDeg: 3.0, recoilYawDeg: 0.4, recoilRecoverDegPerSec: 8 },
];
```

Character of each gun (so later tuning of the numbers does not drift off course):
- **AK47:** powerful, heavy recoil, 4 body shots to kill, one-shot headshot. Rewards the player who can control recoil.
- **M16:** fast fire rate, light recoil, accurate, but needs 5 body shots. Easy to use.
- **Colt:** standard secondary weapon, moderate fire rate, small magazine.
- **Rulo:** slow, 2 body shots to kill, one-shot headshot, very heavy recoil, long reload. A "showoff" gun.

Acceptance:
- [ ] The old `weaponLogic` tests in `npm test` still pass (fix a test if it is tied to the old names/stats; do not change the logic).
- [ ] Keys 1–4 switch to the correct gun, the HUD shows the right name and ammo count.

---

## Audio: principles

One shot = **multiple sound layers played at the same time**, each layer with its own pitch, volume and delay, passing through a **per-gun EQ**, then into a **master compressor**.

| Layer | Role | Source |
|---|---|---|
| `mech` | mechanical "click", bolt/slide | file |
| `body` | main bang | file (3–4 variants) |
| `thump` | low-end "thump" punch | **synthesized in code** (no file needed) |
| `tail` | echo after the shot | file |
| `shell` | shell casing clinking on the ground, ~300ms delay | shared file |

Desired sound character:

| Gun | Feel | Tuning direction |
|---|---|---|
| AK47 | heavy, dull, "rumbling" | slightly low pitch, more bass, strong thump, medium tail |
| M16 | tight, sharp, "crisp" | slightly high pitch, more treble, light thump, short tail |
| Colt | solid, "pop" | medium pitch, full mids, medium thump |
| Rulo | loud bang, "boom", longest echo | low pitch, very strong thump, longest tail |

---

## Task A.2 – Audio file structure

The user prepares files following this convention (`.ogg`, with a same-named `.mp3` if Safari support is needed):

```
client/public/sounds/
  guns/
    ak47/   shot_01..04.ogg  mech_01.ogg  tail_01.ogg  reload_magout.ogg  reload_magin.ogg  reload_bolt.ogg  draw.ogg
    m16/    shot_01..04.ogg  mech_01.ogg  tail_01.ogg  reload_magout.ogg  reload_magin.ogg  reload_bolt.ogg  draw.ogg
    colt/   shot_01..03.ogg  mech_01.ogg  tail_01.ogg  reload_magout.ogg  reload_magin.ogg  reload_slide.ogg draw.ogg
    rulo/   shot_01..03.ogg  tail_01.ogg  cock.ogg     reload_open.ogg    reload_eject.ogg  reload_insert.ogg reload_close.ogg draw.ogg
    (each gun may have its own dryfire.ogg; if absent, use common/dryfire_rifle or dryfire_pistol)
  common/
    dryfire_rifle.ogg  dryfire_pistol.ogg  lowammo.ogg
    shell_rifle_01..03.ogg  shell_pistol_01..03.ogg
    hit_body_01..03.ogg  hit_head_01..02.ogg  kill.ogg  kill_head.ogg  hurt_01..03.ogg
```

**Every sound in the list has a synthesized fallback in code** (A.6–A.8), so missing files still produce sound. If a file exists, use it, or mix both (see each task).

Do:
- The loader reads the file list from the profile (task A.3); **for any missing file, skip that layer and log a warning once**, do not crash. (So the user can try files one at a time.)
- Check browser ogg support with `new Audio().canPlayType('audio/ogg; codecs="vorbis"')`; if unsupported, use `.mp3`.

Acceptance:
- [ ] Temporarily delete one `shot_02.ogg` file: the game still runs, the console warns exactly once, the gun uses the remaining variants.

---

## Task A.3 – Per-gun audio profile

Create `client/src/audio/gunProfiles.ts` (client only, not in `shared/`):

```ts
export interface LayerDef {
  files: string[];        // pick at random, do not repeat the file just played if there are ≥ 2
  gainDb: number;
  pitch: number;          // base playbackRate
  pitchRand: number;      // ± random
  gainRandDb: number;     // ± random
  delayMs: number;
}

export interface ThumpDef {   // synthesized bass layer
  gainDb: number;
  startHz: number;        // start frequency
  endHz: number;          // end frequency
  durationMs: number;
}

export interface GunSoundProfile {
  folder: string;
  layers: { body: LayerDef; mech?: LayerDef; tail?: LayerDef };
  thump: ThumpDef;
  eq: { lowShelfHz: number; lowShelfDb: number; highShelfHz: number; highShelfDb: number };
  shell: 'rifle' | 'pistol' | null;    // the revolver does not eject casings when firing
  shellDelayMs: number;
  reload: ReloadSoundDef;                 // see A.6
  dryfire: { file?: string; kind: 'rifle' | 'pistol' };  // see A.7
  draw: string;
  maxVoices: number;
}
```

Starting values (tune by ear later in task A.5):

```ts
export const GUN_SOUNDS: Record<number, GunSoundProfile> = {
  0: { // AK47
    folder: 'ak47',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03','shot_04'], gainDb: 0,  pitch: 0.96, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                                gainDb: -8, pitch: 1.0,  pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                                gainDb: -6, pitch: 0.97, pitchRand: 0.03, gainRandDb: 1,   delayMs: 20 },
    },
    thump: { gainDb: -3, startHz: 110, endHz: 45, durationMs: 140 },
    eq: { lowShelfHz: 150, lowShelfDb: 4, highShelfHz: 5000, highShelfDb: -2 },
    shell: 'rifle', shellDelayMs: 320,
    reload: { kind: 'mag', steps: [
      { file: 'reload_magout', at: 0.15, synth: 'magout' },
      { file: 'reload_magin',  at: 0.55, synth: 'magin' },
      { file: 'reload_bolt',   at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 8,
  },
  1: { // M16
    folder: 'm16',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03','shot_04'], gainDb: 0,  pitch: 1.05, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                                gainDb: -6, pitch: 1.1,  pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                                gainDb: -9, pitch: 1.0,  pitchRand: 0.03, gainRandDb: 1,   delayMs: 15 },
    },
    thump: { gainDb: -8, startHz: 130, endHz: 60, durationMs: 90 },
    eq: { lowShelfHz: 150, lowShelfDb: 0, highShelfHz: 4000, highShelfDb: 3 },
    shell: 'rifle', shellDelayMs: 300,
    reload: { kind: 'mag', steps: [
      { file: 'reload_magout', at: 0.15, synth: 'magout' },
      { file: 'reload_magin',  at: 0.55, synth: 'magin' },
      { file: 'reload_bolt',   at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 8,
  },
  2: { // Colt
    folder: 'colt',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03'], gainDb: -1, pitch: 1.0, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                     gainDb: -7, pitch: 1.0, pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                     gainDb: -7, pitch: 1.0, pitchRand: 0.03, gainRandDb: 1,   delayMs: 20 },
    },
    thump: { gainDb: -5, startHz: 120, endHz: 55, durationMs: 110 },
    eq: { lowShelfHz: 200, lowShelfDb: 2, highShelfHz: 5000, highShelfDb: 0 },
    shell: 'pistol', shellDelayMs: 280,
    reload: { kind: 'mag', steps: [
      { file: 'reload_magout', at: 0.2,  synth: 'magout' },
      { file: 'reload_magin',  at: 0.6,  synth: 'magin' },
      { file: 'reload_slide',  at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 4,
  },
  3: { // Rulo (revolver)
    folder: 'rulo',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03'], gainDb: 1,  pitch: 0.92, pitchRand: 0.03, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],                     gainDb: -3, pitch: 0.95, pitchRand: 0.03, gainRandDb: 1, delayMs: 25 },
    },
    thump: { gainDb: 0, startHz: 95, endHz: 38, durationMs: 200 },
    eq: { lowShelfHz: 140, lowShelfDb: 5, highShelfHz: 5000, highShelfDb: -1 },
    shell: null, shellDelayMs: 0,
    reload: { kind: 'perRound',
      open:   { file: 'reload_open',   at: 0.08, synth: 'magout' },
      eject:  { file: 'reload_eject',  at: 0.22, synth: 'shells' },
      insert: { file: 'reload_insert', from: 0.35, to: 0.8, synth: 'insert' },  // repeats per round fired
      close:  { file: 'reload_close',  at: 0.88, synth: 'magin' },
    },
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 4,
  },
};
```

Extra for the Rulo: play `cock.ogg` **between two shots** (about 60% of `fireIntervalMs` after each shot) for the feel of cocking the hammer.

---

## Task A.4 – Audio graph (Web Audio)

```
each layer: AudioBufferSource ─► Gain(layer) ─┐
thump (Oscillator)  ─► Gain(envelope) ────────┼─► [gun bus] LowShelf ─► HighShelf ─► ┬─► (own gun) ─────────────► Master
                                              │                                      └─► (others) Lowpass ─► Panner ─► Master
Master: Gain ─► DynamicsCompressor ─► destination
```

Do (`client/src/audio/gunAudio.ts`):

1. **Master** (created once): `DynamicsCompressorNode` with `threshold −18dB`, `knee 6`, `ratio 4`, `attack 0.003`, `release 0.15`. Overall gain follows the volume setting.
2. **Gun bus**: each gun gets one `BiquadFilter lowshelf` → `highshelf` chain created **once** from the profile's `eq`, shared by every shot of that gun (own shots). For other players: each shot creates its own chain with an extra `lowpass` + `PannerNode`.
3. **Playing a layer**: pick a random file (avoid repeating the file just used), `playbackRate = pitch + rand(±pitchRand)`, gain = `dbToGain(gainDb + rand(±gainRandDb))`, `start(ctx.currentTime + delayMs/1000)`.
4. **Synthesized thump**:
   ```ts
   function playThump(ctx: AudioContext, dest: AudioNode, t: ThumpDef, when: number) {
     const osc = ctx.createOscillator();
     const g = ctx.createGain();
     osc.type = 'sine';
     osc.frequency.setValueAtTime(t.startHz, when);
     osc.frequency.exponentialRampToValueAtTime(t.endHz, when + t.durationMs / 1000);
     const peak = dbToGain(t.gainDb);
     g.gain.setValueAtTime(0.0001, when);
     g.gain.exponentialRampToValueAtTime(peak, when + 0.004);
     g.gain.exponentialRampToValueAtTime(0.0001, when + t.durationMs / 1000);
     osc.connect(g).connect(dest);
     osc.start(when);
     osc.stop(when + t.durationMs / 1000 + 0.02);
   }
   ```
5. **Voice limit**: each gun keeps a list of currently playing sources; when `maxVoices` is exceeded, stop the oldest source (10ms fade, no hard cut).
6. **Shell casings**: after `shellDelayMs`, play a random `shell_rifle_*`/`shell_pistol_*` file at −14dB gain, only for your own gun and for other players within 15m.
7. **Reload**: done in task A.6.
8. **Out of ammo**: done in task A.7.
9. **Other players' guns (from ShotFx, phase 4)**:
   - `PannerNode`: `panningModel 'equalpower'`, `distanceModel 'inverse'`, `refDistance 4`, `rolloffFactor 1.2`, position = the shot's `origin`. The listener is updated from the camera every frame.
   - `lowpass` cutoff by distance `d`: `cutoff = 18000 * Math.pow(0.5, d / 15)`, clamped to a minimum of 1500Hz (the farther away, the duller).
   - Do not play the `mech` layer for other players (the mechanical sound is only audible close to the hands).
   - Other players' `tail` is 3dB louder than your own (at a distance the echo is heard more than the bang).

10. **Synth module** `client/src/audio/synth.ts`, used for the thump and the fallback sounds in A.6–A.8:
    - Create **once** a 1-second white-noise `AudioBuffer`; every "noise burst" sound reuses this buffer (set a random `offset` on `start`).
    - Common functions:
      ```ts
      tone(dest, { type, freq, freqEnd?, gainDb, attackMs, decayMs, when })
      noise(dest, { filter: 'bandpass' | 'highpass' | 'lowpass', freq, q, gainDb, attackMs, decayMs, when })
      ```
    - All envelopes use `exponentialRampToValueAtTime` from/to 0.0001.

Acceptance:
- [ ] With eyes closed, you can tell the 4 guns apart.
- [ ] Empty a full AK47 magazine: no crackle, no distortion, no sound cut off midway.
- [ ] Open 8 bots/tabs all firing at once: no distortion (the compressor works), FPS does not drop.
- [ ] Another player's gunfire from 50m away sounds dull and quiet, from 3m sounds clear; turning your head you can hear the left/right direction.
- [ ] Switching guns mid-reload: the reload sound stops immediately.
- [ ] The Rulo has a hammer-cock sound between 2 shots.

Pitfalls:
- `exponentialRampToValueAtTime` **does not accept the value 0**, use 0.0001.
- Do not create a new `BiquadFilter` for each of your own shots (use the shared bus); only create new ones for other players' guns because each shot has a different position.
- An `AudioBufferSourceNode` is single-use, remember to `disconnect()` in `onended` so memory does not leak.
- Use `ctx.currentTime` for timing, not `setTimeout`, for layers within the same shot (a timing offset is immediately audible). `setTimeout` may only be used to schedule shell casings and reload.

---

## Task A.5 – Sound tuning panel (F8)

Do:
- The F8 key opens a panel: choose a gun, sliders for every field in the profile (gain, pitch, rand per layer; thump; EQ; tail delay).
- A **"Test shot"** button (plays 1 shot) and a **"Fire for 1 second"** button (plays at `fireIntervalMs` for 1 second) so you can hear changes immediately without going into the game to shoot.
- A **"Copy JSON"** button exports the current profile to paste into `gunProfiles.ts`.
- A level (peak) meter at the master output: use an `AnalyserNode`, show red if it exceeds −1dBFS.

Acceptance:
- [ ] Drag the AK47 thump slider up, press "Test shot": it sounds different right away.
- [ ] Copy JSON, paste into the code, reload the page: the sound stays exactly as tuned.


## Task A.6 – Reload sounds

### A.6.1 Quick reload vs empty reload (logic change in `shared/`)

Add to `WeaponDef`: `reloadEmptyMs` (reload after the magazine is fully emptied; the bolt must be pulled so it takes longer). The current `reloadMs` becomes the quick reload (rounds still in the magazine).

| Gun | reloadMs (rounds left) | reloadEmptyMs (empty) |
|---|---|---|
| AK47 | 2000 | 2600 |
| M16 | 1800 | 2300 |
| Colt | 1300 | 1700 |
| Rulo | 2600 | 2600 (reloads per round, see below) |

- Add `reloadEmpty: boolean` to `WeaponState` (records which type of reload it was when the reload started).
- This is **shared** logic, used by both client and server. Update the `weaponLogic` tests: reloading with 5 rounds left takes `reloadMs`, reloading at 0 rounds takes `reloadEmptyMs`.

### A.6.2 Audio

```ts
type ReloadSynth = 'magout' | 'magin' | 'bolt' | 'shells' | 'insert';
interface ReloadStep { file: string; at: number; synth: ReloadSynth; emptyOnly?: boolean }
type ReloadSoundDef =
  | { kind: 'mag'; steps: ReloadStep[] }
  | { kind: 'perRound';
      open: ReloadStep; eject: ReloadStep; close: ReloadStep;
      insert: { file: string; from: number; to: number; synth: ReloadSynth } };
```

- `at` is a 0..1 ratio of the **actual reload time** (`reloadMs` or `reloadEmptyMs` depending on the type).
- A step with `emptyOnly: true` (pulling the bolt) only plays on an empty reload.
- **Rulo** (`perRound`): the number of rounds to load is `n = magSize − ammo`. Play `insert` exactly `n` times, spread evenly over `from..to`. Each time, vary the pitch by ±4% so it does not sound like a machine. Fire 1 round then reload -> hear 1 round-insert sound; fire all 6 -> hear 6.
- Schedule with `setTimeout` when the reload starts, keep the list of ids; if the reload is cancelled (weapon switch, death) -> `clearTimeout` all of them and stop every reload source that is playing (20ms fade).
- **Your own** reload sound: −4dB, bypasses the gun's EQ (goes straight into master). **Other players'**: only played within 12m, through the panner, −10dB (so you can hear "that guy is reloading" when standing near).

Synthesized fallback sounds (when files are missing):

| synth | How to create it |
|---|---|
| `magout` | noise bandpass 1800Hz q=3, decay 40ms, −10dB + tone sine 320→220Hz decay 60ms, −14dB |
| `magin` | two "clicks": noise bandpass 2500Hz q=4 decay 25ms −8dB at t and t+45ms; plus tone sine 180Hz decay 70ms −12dB at t+45ms |
| `bolt` | noise bandpass sweeping 1200→3500Hz over 90ms (pull) −12dB, then noise bandpass 3000Hz q=5 decay 30ms −6dB at t+120ms (release) |
| `shells` | 6 random tone sine hits 3500–5200Hz, decay 80ms, −18dB, scattered randomly within 250ms (casings falling) |
| `insert` | noise bandpass 2800Hz q=6 decay 20ms −10dB + tone sine 1400Hz decay 35ms −16dB |

Acceptance:
- [ ] AK47 fires 10 rounds then R: hear the magazine drop, magazine insert, **no** bolt pull; HUD is full exactly at 2.0s.
- [ ] AK47 fires the entire magazine: reloads automatically, has the bolt pull, takes 2.6s.
- [ ] Rulo fires 2 rounds then R: hear exactly 2 round-insert sounds. Fire all 6: hear 6.
- [ ] Switching guns while reloading: silent immediately, no leftover sounds.
- [ ] Delete all reload files: you still hear the synthesized sounds, and can tell the steps apart.

---

## Task A.7 – Out-of-ammo "click" + low-ammo warning

### Out of ammo (dry fire)

- Play on **trigger pull** when the magazine is empty (rising edge of left mouse button), once per press. Holding the mouse does not repeat it.
- Right after that, reload automatically (existing logic from task 2.3) — meaning the player hears the "click" and then the magazine-drop sound, just like real life.
- If auto-reload no longer exists (for example a future mode with no reserve ammo) then every press makes the "click".
- File: `guns/<gun>/dryfire.ogg` if present, otherwise `common/dryfire_rifle|pistol.ogg`, and if that is also missing, synthesize:
  - Rifle: noise highpass 2500Hz decay 15ms −6dB + tone square 1100Hz decay 25ms −18dB (dry click, heavy metal).
  - Pistol: noise highpass 3500Hz decay 10ms −6dB + tone square 1700Hz decay 18ms −18dB (a smaller, tighter tick).
- Only played for yourself, not sent over the network.

### Low-ammo warning

- When firing with remaining ammo ≤ 25% of the magazine: play an extra small "tink" **at the same time** as the shot, with pitch rising as ammo gets lower:
  `pitchFactor = 1 + 0.6 * (1 − ammoLeft / (magSize * 0.25))`
- File `common/lowammo.ogg`, otherwise synthesize: tone sine 2600Hz × `pitchFactor`, decay 60ms, −20dB.
- Last round: the "tink" is 4dB louder (signals the "click" is coming).
- Rulo (6 rounds): the warning turns on from the 5th round.
- Has an on/off setting (default on).

Acceptance:
- [ ] Hold the mouse and empty the AK47: the last 8 rounds play a rising "tink", the last round clearer, then the "click", then the reload sound.
- [ ] Click the mouse repeatedly while reloading: no "click" plays (reloading is not an empty magazine).
- [ ] Rifle and pistol "clicks" sound different.

---

## Task A.8 – Hit sound (hitmarker), kill, being hit

Goal: a hit must sound **crisp, clear, and "sweet"**, a headshot must sound completely different, and a kill has its own "finisher" sound. All are played from the server's `HitConfirm`/`Kill` (task 4.5), never predicted ahead.

### Sound construction (synthesized, used as the default)

| Event | Layer | Parameters |
|---|---|---|
| **Body hit** | crisp "tick" | noise bandpass 3200Hz q=2, attack 1ms, decay 30ms, −6dB |
|  | tonal body | tone triangle 1250Hz, decay 70ms, −12dB |
|  | thickness | tone sine 220→120Hz, decay 60ms, −14dB |
| **Head hit** | same as body hit, plus: | |
|  | metallic "ting" | 3 tone sines at 2100Hz, 2100×2.76Hz, 2100×5.4Hz (bell ratios), gain −10/−16/−22dB, decay 380/250/150ms |
|  | sharper "tick" | noise bandpass raised to 4500Hz |
| **Kill** | finisher "thump" | tone sine 160→55Hz, decay 180ms, −6dB |
|  | 2 rising notes | tone triangle 880Hz decay 120ms −12dB at t; 1320Hz decay 220ms −12dB at t+70ms |
| **Headshot kill** | kill + the head-hit "ting", the second note changed to 1760Hz | |

If files exist (`hit_body_*`, `hit_head_*`, `kill`, `kill_head`): the profile has a `mode: 'file' | 'synth' | 'both'` option per event. The default is `'both'` when files exist: play the file + the synthesized "thickness" layer (downloaded files are usually thin and lack bass — that is why they sound "flat").

### Making it "sweet"

- **Pitch combo:** consecutive hits within 400ms raise the pitch 3% each time (max +15%); if no hit lands for more than 400ms it resets. Spraying an AK with continuous hits gives a climbing "tick tick tick", very satisfying.
- **No stacked sounds:** multiple HitConfirms arriving within the same 30ms (hitting several people, or bunched-up network packets) -> play only once, taking the "heaviest" event (kill > head > body).
- **Slight randomness:** pitch ±2%, gain ±1dB each time.
- **Straight into master**, not through the gun EQ, not through the panner (it is a UI sound, always heard clearly in the center).
- **Ducking:** while the kill sound plays, lower your own gunfire volume by −4dB for 150ms then restore it (use a dedicated `GainNode` for the gunfire group) so the "finisher" stands out.
- The visual hitmarker and the sound must land on the same frame.

### Being hit (victim side)

- The victim hears a deep "thud": noise lowpass 900Hz decay 80ms −8dB + tone sine 140→70Hz decay 120ms −10dB, played from the direction the shot came from (panner placed 1m from the player toward the shooter).
- File `hurt_*` if present replaces the noise layer.
- Health below 30: add a small looping heartbeat sound (tone sine 55Hz, 2 beats every 0.9s, −20dB) until respawn. Has a setting to turn it off.

### F8 tuning panel (addition to A.5)

- "Hit" tab: sliders for each layer of body hit, head hit, kill; buttons "Test body hit", "Test head hit", "Test 6-hit combo", "Test kill", "Test headshot kill"; choose `mode` file/synth/both.

Acceptance:
- [ ] With eyes closed you can tell apart: body hit, head hit, kill, headshot kill.
- [ ] Spray an AK with continuous hits on a target: the sound climbs in pitch; stop for 0.5s then fire again and it returns to the base pitch.
- [ ] One shot hitting 2 people standing in a line (if bullets penetrate) or bunched-up hits: only 1 sound is heard.
- [ ] With no files at all: it still sounds crisp, with bass, not "flat".
- [ ] The victim hears the hit sound from exactly the shooter's direction.

---

## Notes for the user

- It works even with no files: the thump is synthesized, so just a single `shot_01` file already gives a sound with punch.
- Prioritize finding files in this order: `shot` (most important) → `tail` → `reload` → `mech` → `shell`. For hit, out-of-ammo and low-ammo warning sounds the synthesized versions are already decent; replace them only when you have nice files.
- Search keywords for freesound/OpenGameArt: `rifle magazine reload`, `pistol slide`, `revolver cylinder`, `bullet insert`, `gun dry fire click`, `hitmarker`, `bullet impact flesh`, `metal ping`.
- Tune by ear with F8 both with headphones **and** with laptop speakers, because bass that sounds great on headphones can disappear completely on laptop speakers.
