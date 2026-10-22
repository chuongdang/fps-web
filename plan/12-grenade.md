# 12 – M67 grenade: buy, hold, pull the pin, throw, bounce, explode

Do this after task 09 (shop) and 11 (rigged characters). It touches `shared/`, the server, and the client.

Order: G.0 → G.1 → G.2 → G.3 → G.4 → G.5 → G.6 → G.7 → G.8 → G.9. Tasks marked ⚠️ should use a stronger model.

---

## Rules

- The grenade is **slot 5** (key **5**), not counted among the 4 weapon categories. Carry at most **2**, price **$300 each**, bought one at a time until you have 2. **No resale.**
- Dying loses the grenades (per `keepLoadoutOnDeath = false` from task 09). Not part of the default set.
- Controls:
  - Key **5**: equip the grenade. Key **G**: equip and go straight into the throwing stance (quick throw), release G to throw.
  - **Hold left mouse button**: pull the pin, raise the arm → **release to throw hard** (long distance, high arc).
  - **Hold right mouse button**: pull the pin → release for a **low throw/roll** (short distance, rolls around corners).
  - You must hold for at least 0.35s to finish pulling the pin; releasing before then cancels, no throw.
  - **No "cooking" the grenade** (first version): the fuse starts burning **when it leaves the hand**, exploding after **3 seconds**.
- Explosion: maximum damage **98** at the center (a full-health player hit at the feet survives with 2 health, CS style), decreasing to 0 at a radius of **7m**. If **blocked by a wall**, damage is reduced in proportion to the fraction of the body covered. No friendly fire; **self-damage is 50%**. Kills by grenade still earn money as usual (including the $1000 bounty).
- Grenades **do not collide with players**, they only bounce off the map (simple for netcode, see G.2).

---

## Config (`shared/src/grenade.ts`)

```ts
export const GRENADE = {
  key: 'm67',
  price: 300,
  maxCarry: 2,
  pinPullMs: 350,          // minimum mouse hold to pull the pin
  fuseMs: 3000,            // counted from leaving the hand
  throwSpeed: { strong: 16, lob: 7 },   // m/s
  throwUpDeg: { strong: 6, lob: 2 },    // added to pitch
  inheritVelocity: 0.5,    // add 50% of the thrower's velocity
  radius: 0.045,           // m, spherical collision
  gravity: 22,             // same gravity as MovementConfig
  restitution: 0.35,       // bounciness
  friction: 0.6,           // tangential friction per contact
  rollDrag: 2.5,           // m/s² deceleration when rolling on the floor
  restSpeed: 0.25,         // below this speed it lies still
  damageMax: 98,
  innerRadius: 1.0,        // within this radius: full damage
  outerRadius: 7.0,
  selfDamageMult: 0.5,
  knockback: 3.0,          // m/s pushing away from the blast center (0 = off)
  shakeRadius: 15,
  warnRadius: 8,           // show the nearby-grenade warning
  autoSwitchBackMs: 450,   // after throwing the last one, auto-switch back to the previous gun
};
```

---

## Task G.0 – Prepare the grenade model (Claude Code + Blender)

File the user downloaded: `assets/source/grenades/m67.glb`, containing **1 complete grenade** and **1 disassembled set**.

Do (`asset_tool.py`, the existing `inspect` mode, then the new `build-grenade` mode):
1. **Inspect**: list every object, position, size, triangle count. Determine:
   - Which object is the complete grenade, which belong to the disassembled set (usually the disassembled set has many small objects lying far apart).
   - The parts: **body** (round shell), **fuze head**, **safety lever / spoon**, **pin + pull ring**, **safety clip** (if any).
   - If unsure which part is which → ask the user (with preview renders of each object), do not guess.
2. **Choose the source to export**, in priority order:
   - (a) The complete grenade **already has** the pin and spoon split out as separate objects → use it directly.
   - (b) The complete grenade is **one solid piece** → use the **disassembled set**: assemble the parts back into their fitted positions (matching the complete grenade's bbox: body on body, fuze on top, spoon pressed against the body, pin through the fuze). Render comparison images against the complete grenade for the user to approve.
   - (c) Cannot be assembled → use the complete grenade and **drop the flying pin/spoon effect** (state this clearly in the report).
3. Normalize: height **0.09m** (a real M67 is about 9cm tall, 6.4cm in diameter), origin at the **center of the body**, fuze pointing **+Y** in three.js.
4. Name the nodes: `body` (body + fuze), `spoon`, `pin` (pin + ring), `clip` (if any). Add Empties: `hand_r` (the right palm wrapping the body, the spoon under the palm), `pin_pull` (center of the pull ring, for the left hand).
5. Export `client/public/models/grenades/m67.glb` (≤ 1MB, textures ≤ 1024px).
6. Render a white silhouette icon (task H.5): `client/public/icons/weapons/m67.png`.

Acceptance:
- [ ] Viewer: one fully assembled grenade, standing upright, exactly 9cm against the ruler.
- [ ] Hiding the `pin` node, then `spoon`, in turn: exactly that part disappears.
- [ ] White icon with transparent background.

---

## Task G.1 – Loadout, shop, economy (shared)

- `CATEGORY` adds `'grenade'`, slot **4** (index 4, key 5). `Loadout.slots` becomes **5 elements**; the grenade slot stores `{ key: 'm67', count: number }`.
- `economy.ts`:
  - `quoteBuy` for consumables: no trade-in, `refund = 0`; at `maxCarry` → `reason: 'max_carry'`.
  - `applyBuy`: `count + 1`.
  - New function `consumeGrenade(loadout)`: `count − 1`, at 0 the slot becomes empty.
- Add an `m67` entry to `WEAPONS` (`category: 'grenade'`, `price: 300`, `buyable: true`, `moveSpeedMul: 1.0`, firing fields set to 0 / unused).

Acceptance (vitest):
- [ ] $2000 buys a grenade: $1700, count 1. Buy again: $1400, count 2. A third purchase: `max_carry`.
- [ ] `consumeGrenade` twice → slot empty.
- [ ] The old task 09 tests still pass (fix the tests only where the slot count changed 4 → 5).

---

## Task G.2 – Grenade physics (shared, deterministic) ⚠️

`shared/src/grenadePhysics.ts`:

```ts
export interface GrenadeState {
  id: number; ownerId: number; team: TeamId;
  pos: Vec3; vel: Vec3;
  spawnTick: number;        // server tick when it left the hand
  resting: boolean;
}
export function throwInitial(owner: PlayerState, mode: 'strong' | 'lob', world: CollisionWorld): { pos: Vec3; vel: Vec3 };
export function stepGrenade(g: GrenadeState, world: CollisionWorld, dt: number): GrenadeEvent | null; // 'bounce' with the impact speed, or null
```

- `throwInitial`:
  - Start point = eye + `right × 0.15` + `forward × 0.3` − `up × 0.05`. Raycast from the eye to that point: if a wall blocks it, start right at the eye (do not let the grenade slip through the wall when standing against a wall).
  - Direction = from `yaw`, `pitch + throwUpDeg[mode]`. Velocity = direction × `throwSpeed[mode]` + thrower's velocity × `inheritVelocity`.
- `stepGrenade` each tick (dt = 1/60), **collides only with map colliders** (its own collision group):
  1. `resting` → do nothing.
  2. `vel.y −= gravity × dt`.
  3. `castShape` a sphere of radius `radius` from `pos` along `vel × dt`. No hit → `pos += vel × dt`.
  4. Hit: move to the contact point (back off 1mm along the normal), split the velocity into normal `vn` and tangential `vt`: `vel = −vn × restitution + vt × (1 − friction)`. Emit a `bounce` event if `|vn| > 1 m/s`. For the remaining time of the tick: repeat at most 3 times.
  5. Rolling on the floor (floor contact normal y > 0.7, small `|vn|`): reduce tangential speed by `rollDrag × dt`. Speed < `restSpeed` and on the floor → `resting = true`, `vel = 0`.
- Orientation (tumbling in flight) is **not** here, the client draws it by itself (G.4).

Acceptance (vitest, running real Rapier on the "Two Walls" map):
- [ ] Hard throw from the base, pitch 20°: flies over the city wall (4m high) and lands in the middle area.
- [ ] Throw straight at a wall 2m away: bounces back, does not pass through the wall.
- [ ] Dropped from 2m: bounces a few times with decreasing height then lies still in < 2 seconds.
- [ ] Determinism: 2 separate worlds, same inputs, 300 ticks → identical positions down to every digit.
- [ ] Throw into a firing slit (1.2m wide) in the middle: passes through.

Pitfalls:
- The grenade is small and fast → if you only check overlap each tick it will **tunnel through walls**. You must use `castShape` along the tick's travel (continuous), not intersection.
- Jitter stuck in a wall corner: if there is still a collision after 3 iterations, set `vel = 0` for that tick.

---

## Task G.3 – Server: hold, pull the pin, throw, explode ⚠️

### Input

- Use existing bits: `Fire` (left mouse) = hard throw, `Scope` (right mouse) = low throw. Add a `QuickNade` bit (G key).
- The player's throw state (shared, also runs on the client for prediction):
  ```ts
  interface ThrowState { phase: 'idle' | 'pulling' | 'ready'; mode: 'strong' | 'lob'; pressSeq: number; }
  ```
  - `idle` + pressing Fire/Scope (rising edge) while holding a grenade → `pulling`, record `pressSeq`, `mode`.
  - `pulling` → `ready` when `seq − pressSeq ≥ pinPullMs` (converted to ticks).
  - Release the button: if `ready` → **throw** (this tick); if `pulling` → cancel, back to `idle`.
  - Switching guns / dying while `pulling`: cancel. Dying while `ready`: **the grenade drops in place** (velocity = the dead player's velocity), still explodes after `fuseMs` — like CS, it can kill others and yourself.
  - `QuickNade`: pressing G → automatically switches to the grenade slot and enters `pulling` (mode strong); releasing G → throws if `ready`, then automatically switches back to the previous gun.

### Throw and explosion

- Throw: `throwInitial`, create a `GrenadeState` with an increasing id, `consumeGrenade`, send `GrenadeSpawn` to the whole room.
- Each tick: `stepGrenade` for every grenade in flight. After `fuseMs` → **explode**:
  1. For each living player on a team different from the thrower's (or the thrower themselves): distance `d` from the blast center to the **chest**.
  2. `base = damageMax` if `d ≤ innerRadius`; 0 if `d ≥ outerRadius`; linearly decreasing in between.
  3. Cover: raycast (map only) from the blast center (raised 0.1m) to 3 points **head, chest, feet**; `exposure = number of unblocked points / 3`. `damage = round(base × exposure)` (× `selfDamageMult` if it is the thrower).
  4. Apply damage like a bullet (skipping invulnerable players); a kill -> Kill with `weapon: 'm67'`, with the normal money reward.
  5. Knockback: if `knockback > 0` and `damage > 0`: add to that player's velocity `direction(center → chest) × knockback × (base/damageMax)`, with a y component ≥ 1 m/s.
  6. Send `GrenadeExplode` to the whole room, delete the grenade.
- If the thrower leaves the room: the grenade still explodes, still deals damage, but **nobody** gets a money reward.

### Messages

```ts
// S2C
  | { t: 116; id: number; ownerId: number; mode: 'strong' | 'lob'; pos: Vec3; vel: Vec3; spawnTick: number; throwSeq: number } // GrenadeSpawn
  | { t: 117; id: number; pos: Vec3; hits: { id: number; damage: number }[] }                                                  // GrenadeExplode
  | { t: 118; playerId: number; phase: 'pulling' | 'throw' | 'cancel' }                                                         // GrenadeAnim (so others see the motion)
// NetPlayer for the player themselves adds: throwPhase, grenadeCount
```

Acceptance:
- [ ] Throw at the feet of a full-health enemy: about 2–10 health left, not dead.
- [ ] Throw behind a thick wall, the enemy fully in cover: no health lost. Enemy peeking out half their body: loses about 1/3–2/3.
- [ ] A teammate standing right next to the blast: no health lost. Yourself standing right next to it: lose about 49.
- [ ] Shot dead after pulling the pin: the grenade drops in place and explodes after 3 seconds.
- [ ] Hold the mouse for 0.2s then release: no throw, you still have all your grenades.
- [ ] Kill a player with a streak of 3 using a grenade: +$1000.
- [ ] Spam throws (temporarily modify the client to send Fire continuously): never throws more grenades than you have.

---

## Task G.4 – Client: simulate and draw grenades

- Because `stepGrenade` is deterministic and grenades do not touch players: the client **simulates every grenade itself** from `GrenadeSpawn`, and the server does not need to send grenade positions in the snapshot.
  - Receiving another player's `GrenadeSpawn`: create the grenade, **fast-forward** from `spawnTick` to the current tick (running `stepGrenade` many times), then draw it delayed by `INTERP_DELAY_MS` like other players so the visuals match.
  - **Your own** grenade: create it immediately when the client predicts the throw (without waiting for the server), tagged with `throwSeq`. When `GrenadeSpawn` comes back with the same `throwSeq`: if the position differs by < 0.2m keep it and just take the id; if it differs more, blend toward the server trajectory over 0.2s. If the server does not confirm within 500ms (rejected) → delete the predicted grenade.
  - `GrenadeExplode` is the **source of truth**: it explodes at exactly the position the server sent, deleting the local grenade even if the local one has not reached its time.
- Drawing: the `m67.glb` model (with `spoon` and `pin` already separate). Tumbling in flight: rotate around the axis perpendicular to the velocity, with a spin rate proportional to flight speed; when rolling on the floor: rotate along the roll direction (`ω = v / radius`); lying still means no rotation.
- Effect on leaving the hand: the `spoon` separates and flies diagonally up and backward (small random velocity), spins, falls to the floor, and disappears after 5 seconds. The `pin` is already in the left hand from the time the pin was pulled (G.5), and leaves the left hand on throwing.

Acceptance:
- [ ] Two tabs: tab B sees the grenade tab A threw fly along the right path, bounce in the right places, and explode in the right place.
- [ ] Throwing at `?lat=150`: the grenade leaves the hand right when the mouse is released, with no delay.
- [ ] The spoon is seen flying off on throwing.

---

## Task G.5 – 1st person: hold, pull the pin, throw (viewmodel)

Reuse the IK system + `poses.json` from tasks 10/11. Add to `poses.json → weapons.m67`:

```json
"m67": {
  "anchors": { "hand_r": [0, 0, 0], "pin_pull": [0.025, 0.045, 0] },
  "first": {
    "hold": "grenade",
    "idlePos": [0.16, -0.18, -0.38], "idleRotDeg": [0, 10, 0],
    "pullLeftHandPath": [
      { "t": 0.0, "to": "rest" },
      { "t": 0.45, "to": "pin_pull" },
      { "t": 0.75, "to": "pin_pull", "offset": [-0.10, 0.02, 0.05] },
      { "t": 1.0, "to": "rest", "offset": [-0.18, -0.05, -0.10] }
    ],
    "leftRest": [-0.25, -0.40, -0.30],
    "readyPos": { "strong": [0.20, -0.02, -0.18], "lob": [0.10, -0.30, -0.42] },
    "readyRotDeg": { "strong": [-20, 15, 10], "lob": [30, 5, 0] },
    "throwPos": { "strong": [0.02, -0.05, -0.75], "lob": [0.05, -0.35, -0.70] },
    "windupMs": 120, "throwMs": 110, "recoverMs": 250
  },
  "third": { "hold": "grenade" }
}
```

- `hold: 'grenade'`: the right hand grips the grenade (IK to `hand_r`), the left hand is at `leftRest` (off screen or at the bottom edge).
- **Pulling the pin** (the `pulling` phase, lasting `pinPullMs`): the left hand follows `pullLeftHandPath`. At the t = 0.75 mark: the `pin` node is reparented to the left hand (keeping its world position), with a "tink" pin sound. At the same time the right hand brings the grenade from `idlePos` to `readyPos[mode]` (smoothstep).
- **Holding** in `ready`: the grenade sways slightly with a breathing rhythm, the left hand is held out in front (for `strong`, like an aiming hand) — use the end point of `pullLeftHandPath`.
- **Throw** (on releasing the button): `windupMs` pulls back a further 5cm → `throwMs` swings to `throwPos[mode]`; **exactly when `throwMs` starts** hide the grenade in the hand (the real grenade is created in G.4); `recoverMs` both hands lower off screen.
- Grenades remain: the hand brings up a new one (like the draw-gun animation). None left: after `autoSwitchBackMs` automatically switch back to the previous gun.
- **Predicted trajectory** (a setting, on by default): when `ready`, draw a chain of faint white dots along the `throwInitial` + `stepGrenade` trajectory (at most 2 seconds, stopping at the first bounce), with the last dot a small circle on the surface it lands on.

Acceptance:
- [ ] Hold left mouse: the left hand pulls the pin (the pin ring is seen leaving with the left hand), the right hand raises the grenade back over the shoulder.
- [ ] Release: the arm swings, and the grenade flies out from exactly the hand's position (no "teleporting" to somewhere else).
- [ ] Right mouse: low stance, rolling throw.
- [ ] The predicted trajectory matches the real flight path (try 10 times, landing-point error < 0.3m when standing still).

---

## Task G.6 – 3rd person: others see you throw

**The user downloads more on Mixamo** (like C.2, Without Skin, 30fps, In Place):

| Save as | Keyword | |
|---|---|---|
| `grenade_throw.fbx` | throw grenade / grenade throw | hard throw, arm over the shoulder |
| `grenade_toss.fbx` | underhand toss / toss | low throw (if none, share `grenade_throw`) |

Claude Code re-runs `build-character` (task C.3) to add the 2 actions to `cop.glb` / `robber.glb`.

Do:
- Holding a grenade: use the `pistol_*` animation set for the lower body; the grenade is attached to `mixamorigRightHand` (per the `hand_r` anchor), the left hand follows the animation.
- Receiving `GrenadeAnim`:
  - `pulling`: the left hand IKs to touch the pin ring (reuse `SkeletonArm`), 0.3s then lets go.
  - `throw`: play `grenade_throw` or `grenade_toss` **on the upper body only** (mask: bones from `mixamorigSpine` upward, including both arms), blended with the running legs. Hide the grenade in the hand at about 40% of the animation (tuned by `poses.json: weapons.m67.third.releaseT`).
  - `cancel`: back to the holding pose.

Acceptance:
- [ ] F10 or a second tab: see the character pull the pin and swing the arm to throw, with the legs still running normally.
- [ ] The grenade disappears from the hand exactly when the real grenade appears in the air.

---

## Task G.7 – Explosion effects

All in code (sprites/particles, no files needed):
- **Flash**: a white-yellow additive sprite, 4m → 0 in 80ms; a high-intensity orange `PointLight` fading to 0 in 150ms.
- **Fireball**: 6–8 orange-red additive sprites, expanding from 0.5m → 2.5m in 250ms then fading.
- **Smoke**: 15–20 gray sprites, rising slowly, gradually expanding, fully faded in 2.5s (cap the total smoke sprites on the map at 200).
- **Debris/sparks**: 25 small glowing particles thrown in random directions in the upper hemisphere, with gravity, living 0.6s.
- **Scorch mark**: a round black decal 2.5m across on the nearest floor/wall surface (raycast downward), fading after 20s, at most 10 marks.
- **Screen shake**: amplitude by distance (`1 − d/shakeRadius`), 0.4s, without shaking the viewmodel too strongly (main camera only).
- The explosion effect of a grenade **behind a wall**: still drawn (the player sees smoke rising behind the wall), only the flash is naturally blocked.
- All sprite textures are generated with a canvas at startup (round gradients), no file loading.

Acceptance:
- [ ] The explosion looks powerful, with smoke lingering for a few seconds and a scorch mark on the floor.
- [ ] 5 explosions at once: no drop below 60 FPS.

---

## Task G.8 – Grenade audio

Add to the audio system of task 08 (`synth.ts`, master compressor, panner for distant sounds). Optional files in `client/public/sounds/grenade/`; without files, use synthesized sounds:

| Sound | When | Synthesized fallback |
|---|---|---|
| `pin` | pulling the pin (only you hear it, others within 6m hear it quietly) | tone sine 3200Hz decay 120ms −14dB + noise highpass 5000Hz 10ms −16dB |
| `spoon` | the grenade leaves the hand | tone sine 2400→1800Hz decay 200ms −16dB ("boingg") |
| `throw` | arm swing | noise bandpass sweeping 400→1500Hz over 150ms −16dB (wind sound) |
| `bounce` | every bounce (`bounce` event, volume by impact speed) | noise bandpass 1800Hz q=3 decay 40ms + tone sine 900Hz decay 60ms, −10 → −24dB by speed |
| `explode` | explosion | see below |

**Explosion sound** (multiple layers, like gunfire):
- `crack`: noise highpass 1500Hz, decay 60ms, −2dB
- `body`: noise lowpass 900Hz, decay 600ms, 0dB
- `thump`: tone sine 70→30Hz, decay 450ms, 0dB
- `tail`: noise lowpass 400Hz, attack 40ms, decay 2.5s, −10dB (echo)
- `debris`: 8 small random "clatter" sounds within 0.3–1.2s after the explosion, −22dB
- If `explode_01..03.ogg` files exist, play a file in place of `crack` + `body`, still keeping the synthesized `thump` + `tail`.
- Far away: lowpass by distance like other players' gunfire; beyond 40m only `thump` + `tail` remain.

**Tinnitus** when standing within 4m at the time of the explosion (and still alive):
- Tone sine 3500Hz, −18dB, fading out over 2s.
- The master goes through a lowpass, the cutoff dropping to 700Hz then gradually opening back to 20kHz over 2s (all other sounds are "muffled").
- Has a setting to turn off the tinnitus effect.

Acceptance:
- [ ] You can hear the grenade clatter and bounce closer before it explodes.
- [ ] Close explosion: loud, with bass, followed by ringing and all sounds muffled, then returning.
- [ ] Distant explosion behind a wall: only a deep "boom" is heard.
- [ ] The F8 panel has a "Grenade" tab for tuning the layers above.

---

## Task G.9 – HUD, shop, warning

- **The 5th weapon slot** (next to the 4 old slots, same style): the `m67` icon, the number `5` at the bottom-left, a **count badge** `×2` at the top-right. No grenades left: the slot is dimmed.
- While holding a grenade, the ammo area on the right shows `×2` in place of `25 / 30`.
- **Shop**: add a new group at the bottom (rule + small label `Grenade`), row `(8) [icon] M67 Grenade  $300`; when you have 2 it shows `Full (2/2)`, when you have 1 it shows `1/2` next to the price. The footer adds a line: `You can carry at most 2 grenades, no resale.`
- **Nearby-grenade warning**: an **enemy** grenade (or your own) in flight/lying within `warnRadius`: show a red grenade icon in the middle of the screen slightly below the crosshair, with an **arrow** pointing toward the grenade (rotating around the center by the angle relative to the view direction). The closer it is, the more solid it is and the faster it blinks.
- **Killfeed**: a grenade kill shows the grenade icon instead of the gun icon.
- The G and 5 keys appear in the key-guide screen (if there is one).

Acceptance:
- [ ] Buy 2: slot 5 shows `×2`. Throw 1: `×1`. Throw all: slot dimmed, automatically back to the previous gun.
- [ ] An enemy throws a grenade that lands behind you: the arrow points backward.
- [ ] Shop: buying a 3rd is rejected, the row shows `Full (2/2)`.

---

## Notes for the user

- You need to do 2 things by hand: **download the 2 throw animations** on Mixamo (G.6) and (optionally) find real **explosion sound files** (`explosion`, `grenade explosion` on freesound / Sonniss). Without explosion files, the synthesized sound is still a decent "boom".
- To make the grenade harsher/gentler: tune `damageMax`, `outerRadius`, `fuseMs` in `GRENADE`. If you want "cooking the grenade" (holding it longer for an earlier explosion), let us know, it is a separate task because it touches the fuse logic and the warning.
