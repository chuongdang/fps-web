# 14 – New spread (speed-based + bloom), dynamic crosshair, aim down sights (optional)

Current problem: spread only has 4 hard levels (`stand/move/air/crouch`); once speed exceeds 1 m/s it jumps straight to the `move` level -> a slight nudge spreads as much as running at full speed.

Goals:
- Spread **grows gradually with speed**; walking slowly (<= 3 m/s) is almost unpenalized.
- **First shot is accurate**, sustained fire spreads progressively (**bloom**), and bloom recovers once you stop firing.
- Sliding shoots as accurately as crouching (rewards the slide-out-and-shoot move).
- Shift part of the "penalty" into recoil (controllable) instead of random spread.
- The crosshair displays the **true** spread.
- (Optional, ADS part) right mouse button aims down sights for every gun.

Order: S.1 → S.2 → S.3 → S.4 → S.5. The ADS part (D.1 → D.3) comes later and can be skipped.

---

## Task S.1 – New spread model (shared) ⚠️

### New fields in `WeaponDef` (replacing the old `spreadDeg`)

```ts
interface SpreadDef {
  standDeg: number;       // standing still, no bloom
  crouchDeg: number;      // crouching or sliding
  moveDeg: number;        // added when running at full speed (runSpeed)
  accurateSpeed: number;  // m/s, below this speed there is no movement penalty
  airDeg: number;         // added while airborne (replaces moveDeg)
  bloomPerShotDeg: number;
  bloomMaxDeg: number;
  bloomRecoverDegPerSec: number;
  bloomRecoverDelayMs: number; // how long after you stop firing before bloom starts to recover
}
interface WeaponDef { /* ... */ spread: SpreadDef; }
```

Starting values:

| key | standDeg | crouchDeg | moveDeg | accurateSpeed | airDeg | bloomPerShot | bloomMax | bloomRecover | recoverDelayMs |
|---|---|---|---|---|---|---|---|---|---|
| ak47 | 0.35 | 0.20 | 1.0 | 3.0 | 3.0 | 0.25 | 2.0 | 6 | 150 |
| m16 | 0.25 | 0.15 | 0.8 | 3.0 | 2.5 | 0.18 | 1.5 | 7 | 150 |
| smg | 0.60 | 0.40 | 0.5 | 3.0 | 2.5 | 0.15 | 1.5 | 8 | 120 |
| shotgun | 0.0 | 0.0 | 0.6 | 3.0 | 2.0 | 0.0 | 0.0 | 0 | 0 |
| colt | 0.25 | 0.15 | 0.6 | 3.0 | 2.0 | 0.40 | 1.6 | 5 | 250 |
| rulo | 0.15 | 0.10 | 1.0 | 3.0 | 3.0 | 0.80 | 2.4 | 4 | 500 |
| sniper | see below | | | | | | | | |

`recoverDelayMs` must be **greater than the interval between two shots** of automatic guns (AK 100ms, M16 85ms, SMG 70ms); otherwise bloom recovers between two shots and sustained fire never spreads any further. For semi-automatic guns, set the delay so that clicking as fast as possible still builds up a little bloom.

- **Shotgun**: add `pelletConeDeg: 4.5` (a fixed cone for the pellets, not changed by movement). The movement spread in the table above **shifts the center** of the whole pattern; it does not make the pattern bigger.
- **Sniper**: keep the scope mechanic from task H.1: aiming -> `scope.spreadDeg` (0.05) + `moveDeg 3.0` by speed + `airDeg 10`; not aiming -> fixed `unscopedSpreadDeg` (8). No bloom (each shot is followed by working the bolt).
- **Knife, grenades**: no `spread`.

### Bloom state in `WeaponState`

```ts
interface WeaponState {
  // ...
  bloomDeg: number;       // bloom value right after the most recent shot
  lastShotMs: number;     // simulation time of the most recent shot (from seq, as in task 4.1)
}
```

### Calculation functions (`shared/src/spread.ts`), pure, never reading real time

```ts
export function currentBloom(ws: WeaponState, def: WeaponDef, nowMs: number): number {
  const dt = Math.max(0, (nowMs - ws.lastShotMs - def.spread.bloomRecoverDelayMs) / 1000);
  return Math.max(0, ws.bloomDeg - def.spread.bloomRecoverDegPerSec * dt);
}

export function computeSpreadDeg(p: PlayerState, ws: WeaponState, def: WeaponDef, cfg: MovementConfig, nowMs: number): number {
  const s = def.spread;
  const lowStance = p.crouching || p.slideTimer > 0;
  let deg = lowStance ? s.crouchDeg : s.standDeg;
  if (!p.grounded) {
    deg += s.airDeg;
  } else {
    const speed = Math.hypot(p.vel[0], p.vel[2]);
    const t = clamp01((speed - s.accurateSpeed) / (cfg.runSpeed - s.accurateSpeed));
    deg += s.moveDeg * smoothstep(t);   // smoothstep(t) = t*t*(3-2t)
  }
  deg += currentBloom(ws, def, nowMs);
  return deg;
}

export function onShotBloom(ws: WeaponState, def: WeaponDef, nowMs: number): void {
  // call AFTER the spread for this shot has been taken -> the first shot is not affected by its own bloom
  ws.bloomDeg = Math.min(def.spread.bloomMaxDeg, currentBloom(ws, def, nowMs) + def.spread.bloomPerShotDeg);
  ws.lastShotMs = nowMs;
}
```

- Order in `tryFire` (client and server): compute `spread = computeSpreadDeg(...)` → build the bullet direction with the rng seed as before → `onShotBloom`.
- Switching weapons / reloading: **do not** reset bloom (it recovers by itself over time). Each gun keeps its own bloom.
- `runSpeed` is used **after** multiplying by the gun's `moveSpeedMul` (task H.1), so that running at full speed with any gun gives `t = 1`.
- Remove every use of the old `spreadDeg.stand/move/air/crouch`.

Acceptance (vitest):
- [ ] AK47 standing still, not yet fired: 0.35°. Walking at 2.5 m/s: still 0.35°. Running at full speed: 1.35°. Airborne: 3.35°. Sliding: 0.20° + the movement part.
- [ ] AK47 standing still, firing continuously (100ms/shot): shot 1 = 0.35°, shot 2 = 0.60°, shot 3 = 0.85°, ... from shot 9 onward it stays at 2.35° (bloom hits the 2.0° cap).
- [ ] Stop firing for 0.5s: bloom drops by (0.5 − 0.15) × 6 = 2.1° → back to 0.
- [ ] Stop firing for 0.1s then fire again: bloom has **not** recovered (still within `recoverDelayMs`).
- [ ] Shotgun while running: the pattern center is offset, but the angle between each pellet and the pattern center is still <= 4.5°.
- [ ] Given the same InputCmd sequence, client and server compute the **same bullet direction** for every shot (the test runs the shared functions twice with two separate copies of the state).

---

## Task S.2 – Adjust recoil

Increase `recoilPitchDeg` by about 12% for automatic guns (to compensate for the reduced spread, so that sustained fire still requires pulling the mouse down):

| key | old recoilPitchDeg | new |
|---|---|---|
| ak47 | 0.85 | 0.95 |
| m16 | 0.50 | 0.56 |
| smg | 0.40 | 0.45 |

Semi-automatic guns stay unchanged. Do not change `recoilYawDeg` or `recoilRecoverDegPerSec`.

Acceptance:
- [ ] Spray 30 AK47 rounds at a wall 15m away without pulling the mouse: the bullet marks clearly climb; pulling the mouse down steadily groups them into a cluster.

---

## Task S.3 – Dynamic crosshair matching the true spread

- Every frame the client computes the current `spreadDeg` using the **same function** `computeSpreadDeg` (own predicted state, `nowMs` = current simulation time).
- Gap from the center to each crosshair line (pixels):
  ```ts
  const halfH = canvas.clientHeight / 2;
  const gapPx = Math.tan(deg2rad(spreadDeg)) * halfH / Math.tan(deg2rad(camera.fov / 2));
  ```
  plus a minimum gap of 3px (so the crosshair does not collapse together when spread ≈ 0).
- Smooth the display: interpolate toward the new value with a 30ms time constant (cosmetic only, does not affect bullets).
- Shotgun: additionally draw a faint **circle** whose radius corresponds to `pelletConeDeg` + the current spread.
- Sniper not aiming: hide the 4 lines and show only a small dot (unscoped fire is a gamble). While aiming: hide the HUD crosshair (the scope frame already exists).
- Setting: "Dynamic crosshair" on/off (when off the lines stay still, with a fixed gap of 6px).

Acceptance:
- [ ] Standing and firing single shots at a wall: bullet marks always land **inside** the ring formed by the 4 lines.
- [ ] Run then stop: the lines contract smoothly as speed decreases, without jerking.
- [ ] Change the FOV in settings: the gap still matches the bullet marks.

---

## Task S.4 – Tuning panel + testing tools

- F6 panel: add a **Spread** tab, pick a gun, sliders for every field of `SpreadDef` and `recoilPitchDeg`, and a "Copy JSON for this gun" button.
- F3 overlay gets an extra line: `spread 0.54° = base 0.35 + move 0.00 + air 0.00 + bloom 0.19`.
- `?dummies=1`: add a **shooting-range target**: a 2×2m board with concentric circles at 10m, 20m, 40m in the middle area; the R key + holding Shift (dev) clears all bullet marks on the board.

Acceptance:
- [ ] Drag the AK's `moveDeg` slider to 0: running and shooting adds no extra spread (visible right away on the range board).

---

## Task S.5 – Online sync check

- Re-run the final acceptance of phase 4 (3 tabs, ping 20/80/150, shooting each other for 5 minutes) with the new spread.
- F7 (server shot ray debug): server rays and client bullet marks **point the same way**, both while running and during sustained fire.

Acceptance:
- [ ] No case where the client bullet mark is in one place and the server ray in another.

---

# Optional part: aim down sights (ADS)

Do this once S.1–S.5 are stable and you want a more Krunker/CoD feel. The sniper already has a scope; this part extends it to every gun.

## Task D.1 – ADS logic (shared) ⚠️

- Rename the `Btn.Scope` bit to `Btn.Aim` (right mouse button). When holding a grenade, right mouse button is still the low throw (task G.3) and is not affected.
- Add to `WeaponDef`:
  ```ts
  ads?: {
    spreadMult: number;   // multiplies all spread when fully aimed (for example 0.25)
    moveMult: number;     // multiplies run speed while aiming (for example 0.7)
    fovMult: number;      // main camera FOV while aiming (for example 0.8 = slight zoom)
    inMs: number;         // time to enter ADS
    outMs: number;
  };
  ```
  Suggested values: AK47/M16 `{0.25, 0.7, 0.8, 180, 120}`; SMG `{0.35, 0.8, 0.85, 140, 100}`; Colt/Rulo `{0.4, 0.85, 0.88, 120, 90}`; Shotgun `{0.7, 0.8, 0.9, 160, 120}` (only shrinks the pattern slightly). The sniper moves its old scope mechanic over to `ads` (`spreadMult` brings spread down to 0.05°, `fovMult` = 25/FOV).
- `PlayerState` gets `adsT` (0..1): each tick it increases by `DT×1000/inMs` while Aim is held and decreases by `DT×1000/outMs` when released. This is **movement** state (since it changes run speed) → it lives in `stepMovement`, is sent in the snapshot, and has a determinism test.
- Effect by `adsT`: `spread × lerp(1, spreadMult, adsT)`, `runSpeed × lerp(1, moveMult, adsT)`.
- Cannot aim while: reloading, sliding, airborne (adsT decreases on its own), switching weapons.

Acceptance:
- [ ] The movement determinism test still passes with Aim randomly toggled on and off.
- [ ] AK47 fully aimed while standing: spread 0.09°; aiming while running: you run slower, and spread is clearly smaller than running without aiming.

## Task D.2 – Viewmodel and camera while aiming

- Each gun needs an extra `sight` anchor point (the aiming point, on the rear sight / front sight bead) — add it to the params of `gun_tool.py` (task P.1).
- `poses.json → weapons.<key>.first` gets `adsEyeDist` (distance from the eye to `sight`, for example 0.12m) and `adsRotDeg` (usually `[0,0,0]`). The gun position while aiming is computed so that `sight` lies exactly on the **camera's center axis** at `(0, 0, −adsEyeDist)`; interpolate between the normal position and the aimed position by `adsT` (smoothstep).
- While aiming: the hands still follow the gun via IK (task 10/11), walking sway is reduced by 70%, and the visual recoil (gun kickback) by 50%.
- Main camera FOV: `lerp(fov, fov × fovMult, adsT)`; sensitivity is scaled by `tan(currentFov/2) / tan(fov/2)` so the mouse feel stays the same.
- The HUD crosshair fades out with `adsT` (fully aimed it is hidden, you look through the gun's sights).
- Sniper: when `adsT > 0.9` switch to the black scope frame as before and hide the viewmodel.

Acceptance:
- [ ] Hold right mouse button with the AK47: the gun moves to the center, the sight lines up with the screen center, and the bullet lands exactly where the sight points.
- [ ] The F9 panel has `adsEyeDist` and `adsRotDeg` sliders, and a debug dot at `sight`.

## Task D.3 – Other players see you aiming

- `NetPlayer` sends `adsT` (rounded to 0.1).
- Third person: when `adsT > 0.5`, raise the gun higher and bring it close to the cheek (`poses.json → weapons.<key>.third.adsGunPos/adsGunRotDeg`); the IK hands follow automatically.

Acceptance:
- [ ] F10: you see the character raise the gun to the cheek when aiming.

---

## Notes for the user

- Tune in this order: `standDeg` (first-shot accuracy) → `bloomPerShot` + `bloomRecover` + `recoverDelayMs` (how hard sustained fire is, and how much short bursts are rewarded) → `moveDeg` + `accurateSpeed` (how much run-and-gun is penalized) → `airDeg`.
- For a more CS-like feel: raise `moveDeg` to 3–5° and lower `accurateSpeed` to 2. For a more Krunker-like feel: build the ADS part and keep `moveDeg` low.
- Once ADS exists you can slightly increase the spread when not aiming (hip fire for close range, ADS for long range), like CoD.
