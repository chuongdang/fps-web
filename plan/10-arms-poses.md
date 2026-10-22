# 10 – Character arms: two-handed gun hold (3rd person) and arms in 1st person

Goals:
- **Other players' view (3rd person):** for two-handed weapons (AK47, M16, Sniper, Shotgun, SMG) **both hands come together holding the gun**: the right hand on the grip, the left hand supporting the front handguard. Pistols and the knife stay **as they are now**.
- **Your own view (1st person):** draw **two block-style arms** (right hand grips the gun, left hand supports it) so the gun can be pushed farther out and takes up less of the screen.
- **All numbers live in one JSON file** (`client/src/render/poses.json`), with an F9 tuning panel; after tuning, press "Copy JSON" and paste it back.

General idea: **no hand animation**. The gun is placed according to the JSON, and the two hands **automatically attach to anchor points on the gun** using 2-bone IK (shoulder → elbow → hand). When the gun recoils, sways, or reloads, the hands follow on their own.

Task order: P.1 → P.2 → P.3 → P.4 → P.5 → P.6. Tasks marked ⚠️ should use a stronger model.

---

## Coordinate conventions (required reading)

- **Anchor points on the gun:** measured in the gun's coordinate system after normalization (task `tools-blend-to-glb.md`): origin = grip, barrel points **−Z**, up is **+Y**.
  - `hand_r`: where the right hand grips (usually `[0,0,0]` because the origin is already at the grip)
  - `hand_l`: where the left hand supports (handguard / foregrip). Pistol: just below and in front of the right hand.
  - `mag`: center of the magazine (used when reloading)
- **3rd person:** measured from the character's **feet**, the character faces **−Z**, the right side is **+X**.
- **1st person:** measured in the **viewmodel camera** space (camera at the origin, looking −Z, right +X, up +Y).
- Angles in the JSON are in **degrees**, rotation order `XYZ`.

---

## Task P.1 – Anchor points on the gun

Do:
- Extend `tools/blender/gun_tool.py`: params accept an additional `"anchors": { "hand_r": [...], "hand_l": [...], "mag": [...] }` (coordinates in the **file's original space**, like `muzzle`). Each anchor becomes an Empty of the same name in the glb.
- How to estimate when reading the `inspect` result:
  - `hand_l`: the center of the object whose name contains `handguard`, `foregrip`, `fore`, `pump` (shotgun). If none -> a point **55–60%** of the way from the grip to the muzzle, lowered to the bottom edge of the gun body.
  - `mag`: the center of the `mag` object (renamed in the normalization step).
  - If unsure -> ask the user, do not guess.
- Client: when loading a gun, read the anchors from the glb (`getObjectByName`). **Prefer the anchor in the JSON** if the JSON has one (so the user can tune by hand), and only use the glb anchor when it does not.

Acceptance:
- [ ] With the F9 debug on (task P.6): each gun shows 3 colored dots at `hand_r` (red), `hand_l` (blue), `mag` (yellow), sitting at the right place on the model.

---

## Task P.2 – Block arms + 2-bone IK ⚠️

Create `client/src/render/blockArm.ts`:

```ts
export interface ArmStyle { upperLen: number; foreLen: number; thickness: number; handSize: number; }

export class BlockArm {
  constructor(style: ArmStyle, sleeveColor: number, skinColor: number);
  readonly root: THREE.Object3D;   // add to the scene/parent
  // shoulder, target, pole: coordinates in the space of root's parent
  solve(shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3): { reached: boolean };
  setVisible(v: boolean): void;
  dispose(): void;
}
```

- Construction: **upper arm** (box, sleeve color), **forearm** (box, sleeve color or skin color depending on `sleeveToElbow`), **hand** (cube of size `handSize`, skin color). Boxes are long along the **local Z axis**, and the box origin is placed at the joint end (use `geometry.translate(0, 0, -len/2)` once at creation).
- Analytic IK, **no allocation** in `solve` (use the class's scratch variables):

```ts
// a = upper arm length, b = forearm length
const toT = target - shoulder;
let d = |toT|;
const dir = toT / d;
d = clamp(d, |a - b| + 1e-4, a + b - 1e-4);      // if out of reach, extend straight
const x = (a*a - b*b + d*d) / (2*d);              // distance from the shoulder to the elbow's projection
const h = sqrt(max(a*a - x*x, 0));
const p = pole - shoulder;
const perp = normalize(p - dir * dot(p, dir));    // elbow direction, perpendicular to dir
const elbow = shoulder + dir * x + perp * h;
const hand  = shoulder + dir * d;                 // = target if reachable
// upper arm: placed at shoulder, lookAt(elbow); forearm: placed at elbow, lookAt(hand); hand: at hand, same direction as the forearm
reached = (|toT| <= a + b);
```

- `lookAt` needs an up axis: use `perp` as up so the arm does not twist when rotating.
- When `perp` is near 0 (the pole lies on the shoulder–hand line): use the default up axis `(0,1,0)`, or `(1,0,0)` if it is collinear.

Acceptance:
- [ ] Test (vitest, math only, split out as the pure function `solveTwoBone`): target within reach → `|elbow − shoulder| = a`, `|hand − elbow| = b`, `hand = target` (error 1e-6).
- [ ] Test: target too far → the hand lies on the shoulder–target line, at distance `a + b` from the shoulder, `reached = false`.
- [ ] Test: the elbow always lies on the same side as the pole.
- [ ] Profiler: 10 characters on screen, `solve` creates no new objects (check with a heap snapshot or by counting `new` in the code).

---

## Task P.3 – Pose JSON file

- Copy `plan/10-poses.default.json` to `client/src/render/poses.json`.
- Create the matching TypeScript types (`poses.ts`) and a `loadPoses()` function with **validation**: for a missing field, take the default value and `console.warn` once, do not crash. Ignore the `_doc` field.
- Dev mode: editing the JSON file makes Vite hot-reload the poses immediately, without reloading the page (use `import.meta.hot`).

Meaning of the fields:

| Field | Meaning |
|---|---|
| `style.third/first` | upper arm length, forearm length, thickness, hand size for each viewpoint |
| `style.sleeveColor.A/B` | sleeve color per team (A = Cops, B = Terrorists) |
| `third.shoulderR/L` | shoulder position, measured from the character's feet |
| `third.aimPivot` | the pivot point for pitch (looking up/down) of the upper body + gun |
| `third.poleR/L`, `first.poleR/L` | the direction the elbow points out, **relative to the shoulder** |
| `first.fov` | FOV of the viewmodel camera |
| `first.shoulderR/L` | shoulder in camera space (usually below and slightly behind the camera, off screen) |
| `weapons.<key>.anchors` | anchor points on the gun (override the anchors in the glb) |
| `weapons.<key>.third.hold` | `twoHand` or `oneHand` (oneHand = keep the current code) |
| `weapons.<key>.third.gunPos/gunRotDeg` | position of the gun's grip measured from `aimPivot` |
| `weapons.<key>.first.hold` | `twoHand`, `pistolSupport` (left hand cups under the right hand), `oneHand` (hide the left hand) |
| `weapons.<key>.first.gunPos/gunRotDeg/scale` | position of the gun's grip in camera space |
| `reloadLeftHand` | the left hand's path during reload (task P.5) |

---

## Task P.4 – 3rd person: both hands hold the gun

Do (`client/src/render/players.ts`):
- Each character has an `aimPivot` node (placed at `third.aimPivot`), rotated by that player's **pitch** (interpolated, task 3.5). The whole character rotates by yaw as before.
- Weapon with `third.hold = twoHand`:
  1. **Detach the gun from the right hand bone/block** (old code), and attach the gun as a child of `aimPivot` at `gunPos`, `gunRotDeg`.
  2. Every frame: take the world coordinates of `hand_r`, `hand_l` on the gun → convert to the character's space → `armR.solve(shoulderR, hand_r, shoulderR + poleR)`, `armL.solve(shoulderL, hand_l, shoulderL + poleL)`.
  3. Hide the model's old arm blocks, use the 2 new `BlockArm`s (style `third`, sleeve color by team).
- Weapon `oneHand` (pistol, knife): **keep the current code**, show the old arm blocks again, hide the `BlockArm`s.
- Switching guns: switch mode within the frame of the switch, with no frame where the gun floats without hands.
- Existing effects (muzzle flash, ShotFx) still take the gun's `muzzle` position as before.
- A character that is **dead** (blocks flying apart, task 6.2): turn off IK and let the arms fall with the effect.

Acceptance (use the F10 debug camera, task P.6):
- [ ] Holding AK47/M16/Sniper/Shotgun/SMG: both hands come together, the right hand on the grip, the left hand on the front handguard, with no arm stiffly straight or poking through the torso.
- [ ] Looking up/down: the gun and both hands rotate along, the hands stay on the gun.
- [ ] Holding Colt/Rulo/Knife: identical to before this task.
- [ ] Switching constantly 1–4: no jerking, no frame with the gun missing hands.
- [ ] Both teams: the sleeves are the right team color.

Pitfalls:
- Right hand "out of reach" (`reached = false`, debug shows red) → increase `upperLen/foreLen` or pull `gunPos` closer to the shoulder, **do not** change the IK code.
- Elbow folded backward into the torso → `pole` on the wrong side: the right arm's pole has **positive** x, the left arm's **negative** x.

---

## Task P.5 – 1st person: two arms + pushing the gun out ⚠️

Do (`client/src/render/viewmodel.ts`):
- Add `vmRoot` (child of `viewScene`) — **all existing effects** (walk sway, spring recoil, lowering on switch, gun dip on reload) are now applied to `vmRoot` or to the gun, **not** to the shoulder. The shoulder stays still in camera space → the arms flex and extend along with the gun and look natural.
- The gun is a child of `vmRoot`, placed according to `weapons.<key>.first.gunPos/gunRotDeg/scale`.
- `viewCam.fov = first.fov` (default 54). Replace the old FOV number.
- Two `BlockArm`s (style `first`, sleeve color by team), solving IK every frame **after** all effects have been applied to the gun:
  - `twoHand`: right hand → `hand_r`, left hand → `hand_l`.
  - `pistolSupport`: right hand → `hand_r`, left hand → `hand_l` (the pistol anchor sits just below the right hand, producing a two-handed grip pose).
  - `oneHand` (knife): right hand only; left hand hidden.
- Lights for `viewScene`: its own 1 hemisphere + 1 directional (so the arms are not flat-colored like the current screenshot).
- Hide the whole viewmodel (gun + arms) while aiming the Sniper (already exists), when dead, and when the F10 debug camera is on.

### Reloading with the left hand (`reloadLeftHand`)

- `t = reload progress (0..1)` based on the actual reload time (`reloadMs` or `reloadEmptyMs`).
- `keys`: a list of keyframes `{ t, to, offset? }`. `to` is the anchor name (`hand_l` or `mag`), `offset` is added in **camera space** (to pull the hand down off screen). Between 2 keyframes: interpolate the target position with `smoothstep` easing.
- Magazine: from `magDetachT` to `magAttachT` the `mag` mesh **follows the left hand** (reparent to the hand, keeping its world coordinates at the time of the switch); after that range it is reattached to the gun at its original position. The part where the hand is off screen is the moment of "fitting a new magazine".
- `gunTiltDeg`: the gun tilts `roll`/`pitch` during `inT..outT` (smoothstep 0.1 in/out). Replaces the old "tip the gun down" style for guns with `hold = twoHand`.
- Guns with no `mag` mesh (or the Rulo): skip the magazine-carrying part, the left hand just follows `keys`.
- Sync with audio: the `at` marks in the audio profile (task A.6) should match the `t` marks here; the code is not required to sync them automatically, just note it in the F9 panel.

Acceptance:
- [ ] Holding the AK47: both arms are visible rising from the bottom edge of the screen, the gun sits farther out than before, and most of the gun body is visible.
- [ ] Firing: the gun recoils, both hands recoil with it, neither hand slips off the gun.
- [ ] Walking/running: the gun sways, the hands sway with it, the shoulder does not poke into the screen.
- [ ] Reloading the AK47: the left hand goes to the magazine, pulls it down off screen, brings it back up to insert it, and returns to the front handguard.
- [ ] Colt/Rulo: both hands cup the grip. Knife: right hand only.
- [ ] Standing against a wall: the gun and hands are not hidden by the wall (still rendered in a separate pass).
- [ ] Sleeves are the right team color.

Pitfalls:
- Shoulder slipping into frame → push `first.shoulderR/L` down (more negative y) or back (more positive z), or reduce `first.fov`.
- Left hand cannot reach the front handguard when the gun is pushed far out → increase `first.upperLen/foreLen`, do not pull the gun back in.
- The per-frame update order **must** be: gun effects → update the gun's matrixWorld (`updateMatrixWorld(true)`) → read the anchors → solve IK. The wrong order makes the hands lag the gun by 1 frame, looking like hands stuck in slow glue.

---

## Task P.6 – F9 pose tuning panel + F10 debug camera

### F9 – Pose editor

- Choose a gun (dropdown), choose a tab `First` / `Third` / `Anchors` / `Style` / `Reload`.
- Every number in the JSON has a slider + a numeric input. Dragging shows the result immediately.
- Debug dots: `hand_r` red, `hand_l` blue, `mag` yellow, shoulder white, elbow purple; any arm with `reached = false` is painted **red**.
- Reload tab: a `t` slider (0..1) to **freeze** at a moment in the reload and tune each keyframe; a "Play test reload" button.
- Buttons **"Copy JSON"** (copies the whole file), **"Copy this gun"** (only the `weapons.<key>` entry), **"Reset to file"**.
- While F9 is open: release the mouse lock so sliders can be dragged; after closing F9, click again to play.

### F10 – Camera looking at yourself

- An orbit camera around your own character (drag the mouse to rotate, wheel to zoom), showing **your own 3rd person model** holding the current gun. Used to tune the `Third` tab without opening a second tab.
- Turning F10 on hides the viewmodel; turning it off returns to normal.

Acceptance:
- [ ] Dragging `first.gunPos.z` moves the gun forward/back, and the hands flex/extend with it right away.
- [ ] Copy JSON → paste into `poses.json` → reload the page: the pose is preserved.
- [ ] F10 orbiting around the character clearly shows both hands holding the AK47.

---

## Notes for the user

- The file `10-poses.default.json` holds **starting values guessed from common proportions**; the size of your actual character and guns may differ, so you will definitely need to tune with F9. The easiest tuning order: `anchors` (so the dots are in the right place on the gun) → `first.gunPos` (put the gun where it pleases the eye) → `first.shoulderR/L` + arm lengths (so the hands reach and the shoulders do not get into frame) → `pole` (nice elbows) → the `Third` tab with F10.
- To push the gun out even farther: increase `|gunPos.z|` (more negative) **and** increase `first.foreLen` at the same time.
- For chunkier, rougher arms like Krunker: raise `first.thickness` to 0.09–0.1.
