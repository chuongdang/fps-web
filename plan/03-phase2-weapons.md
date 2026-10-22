# Phase 2 – Guns (offline, shooting targets)

Goal: shooting targets feels great. The gun logic (ammo, fire rate, spread) is written in `shared/` so the phase 4 server can reuse it.

---

## Gun stats (`shared/src/weapons.ts`)

```ts
export interface WeaponDef {
  id: number;
  name: string;
  auto: boolean;            // holding the mouse button fires continuously
  damage: number;
  headMult: number;
  legMult: number;
  fireIntervalMs: number;
  magSize: number;
  reloadMs: number;
  range: number;            // m
  spreadDeg: { stand: number; move: number; air: number; crouch: number };
  recoilPitchDeg: number;   // muzzle climb per shot
  recoilYawDeg: number;     // random horizontal deviation ± this value
  recoilRecoverDegPerSec: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: 0, name: 'Rifle', auto: true, damage: 25, headMult: 4, legMult: 0.75,
    fireIntervalMs: 100, magSize: 30, reloadMs: 2000, range: 200,
    spreadDeg: { stand: 0.4, move: 1.5, air: 4, crouch: 0.2 },
    recoilPitchDeg: 0.6, recoilYawDeg: 0.3, recoilRecoverDegPerSec: 8 },
  { id: 1, name: 'Pistol', auto: false, damage: 34, headMult: 3, legMult: 0.75,
    fireIntervalMs: 250, magSize: 12, reloadMs: 1400, range: 120,
    spreadDeg: { stand: 0.3, move: 1.0, air: 3, crouch: 0.2 },
    recoilPitchDeg: 1.2, recoilYawDeg: 0.2, recoilRecoverDegPerSec: 10 },
];
```

The player's weapon state:

```ts
export interface WeaponState {
  current: number;           // id of the gun being held
  ammo: number[];            // rounds in the magazine per gun id
  reloadEndMs: number;       // 0 = not reloading
  nextFireMs: number;
  shotSeq: number;           // increments per shot, used as the spread seed
  triggerHeld: boolean;      // for semi-automatic guns
}
```

Time in the gun logic is measured in **simulation ms** (`tick * 1000 / TICK_RATE`), not `performance.now()`, so client and server compute the same results.

---

## Task 2.1 – Viewmodel + separate render pass

Do (`client/src/render/viewmodel.ts`):
- A separate scene `viewScene` + a separate camera `viewCam` (fixed FOV 60, near 0.01).
- The gun `.glb` is placed in `viewScene`, with a starting position of about `(0.25, −0.22, −0.5)`.
- Render every frame:
  ```ts
  renderer.autoClear = false;
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(viewScene, viewCam);
  ```
- If the gun file does not exist yet: use a long gray box as a temporary gun.
- Keys 1/2 switch Rifle/Pistol (with a simple animation: the gun lowers then raises, 0.3s).

Acceptance:
- [ ] Standing right against a wall, the gun is not hidden by the wall.
- [ ] Changing the main camera FOV (the task 1.1 setting) does not distort the gun.

---

## Task 2.2 – Hitscan + targets

Do:
- Targets: a few human-shaped boxes (1.8m tall) placed in the mid-field, with the head as a separate block. Targets use the **same hitbox function** that will be used for players (`shared/src/hitbox.ts`):
  ```ts
  interface HitBox { min: Vec3; max: Vec3; part: 'head' | 'body' | 'legs'; }
  function hitboxesFor(state: PlayerState, cfg): HitBox[];  // AABB, does not rotate with yaw
  function rayAabb(origin, dir, box, maxDist): number | null; // slab test, returns the distance
  ```
  Standing: legs 0–0.8m, body 0.8–1.45m, head 1.45–1.8m (widths 0.6/0.6/0.35). Crouching: scale down proportionally by `crouchHeight`.
- Shooting: a ray from the eye (`pos + eyeHeight`) along the view direction (+ spread). Compute `wallDist` with Rapier `castRay` against the map only; hit the nearest hitbox whose distance is < `wallDist`.
- Hit: show a hitmarker (white X, red for head) for 150ms, the target flashes red. Miss: a small bullet-hole decal on the wall (max 50, the oldest is removed).

Acceptance:
- [ ] Shooting a target through a firing slot in the wall: hits. Shooting the wall next to the slot: does not hit the target behind it.
- [ ] Aiming at the head → red hitmarker; aiming at the body → white.
- [ ] Test: `rayAabb` with a ray passing through the middle of the box, a ray grazing outside, and a ray starting inside the box (returns 0).

Pitfall:
- View direction from yaw/pitch: `dir = (−sin(yaw)·cos(pitch), sin(pitch), −cos(yaw)·cos(pitch))`. Write a test for this function.
- Using a non-rotating AABB for the hitbox is deliberate (box characters, simpler for netcode).

---

## Task 2.3 – Gun logic

Write `shared/src/weaponLogic.ts`:

```ts
function tryFire(ws: WeaponState, def: WeaponDef, nowMs: number, triggerDown: boolean): boolean
```
- Does not fire if: reloading, `nowMs < nextFireMs`, out of ammo, or the gun is semi-automatic and `triggerHeld` from the previous tick.
- Firing: `ammo--`, `nextFireMs = nowMs + fireIntervalMs`, `shotSeq++`.
- Out of ammo but still pulling the trigger → auto reload (and play a "click" sound once).
- Reload (R or automatic): `reloadEndMs = nowMs + reloadMs`; when done, refill the magazine. Switching guns midway → cancels the reload.

Spread:
- Pick the level by state: air > move (horizontal speed > 1 m/s) > crouch > stand.
- Deviate the ray using **seeded** random: `rng = mulberry32(hashSeed(playerId, shotSeq))`, taking a random angle within a cone of `spreadDeg`.

Recoil:
- Each shot: add `recoilPitchDeg` to a separate `recoilPitch` variable (do not modify the mouse pitch directly), add a random horizontal amount (same seeded rng).
- The actual fire direction = view angle + recoil. Recoil gradually returns to 0 at `recoilRecoverDegPerSec` when not firing.
- The camera also displays the recoil (the player sees the crosshair jump up).

Acceptance:
- [ ] Rifle with the mouse held: fires steadily at 10 shots/second, the ammo count is exact, and after 30 it auto-reloads for 2 seconds.
- [ ] Pistol with the mouse held: fires only 1 shot; fast clicking is limited to 4 shots/second.
- [ ] Shooting while jumping spreads noticeably more than while standing (look at the decals on the wall).
- [ ] Test: the same `playerId` + `shotSeq` always gives the same deviation direction.

---

## Task 2.4 – Effects, sound, HUD

Do:
- Code-driven effects on the viewmodel (no animation files needed):
  - Fire: kick the gun back 4cm + tilt up 3° then return like a spring (~80ms).
  - Walking: sway the gun in a figure-8, amplitude proportional to speed.
  - Reload: tip the gun down 35° and lower it 15cm during 40% of the time, hold, then bring it back up.
  - Muzzle flash: a sprite at the `muzzle` point (an Empty in the glb file, or fixed coordinates if using the temporary gun), shown for 1 frame, randomly rotated.
- Sound (`client/src/audio.ts`, Web Audio API):
  - Preload all files into `AudioBuffer`. Each play creates a new `AudioBufferSourceNode`.
  - Resume the `AudioContext` in the pointer-lock click event.
  - Sounds: fire (per gun), reload, empty click, footsteps (by distance walked, ~every 2.2m), hitmarker, headshot.
- HUD (HTML/CSS over the canvas): 4-line crosshair (spreads out per the current spread), health, ammo `25 / 30`, gun name, hitmarker.

Acceptance:
- [ ] Spraying the Rifle: the sound is not cut off and not distorted.
- [ ] The crosshair spreads when running/jumping and tightens when standing.
- [ ] No sound plays before the player's first click (no console errors).
