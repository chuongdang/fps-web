# 11 – New characters for the 2 teams (rigged models) + using those same hands to hold guns

Source: 2 rigged models in T-pose, ~8,300 triangles, with all 5 fingers:
- `assets/source/characters/Dust2_CT_v2.glb` → **Cops** (team A): special forces, navy shirt, black armor
- `assets/source/characters/Dust2_T_v2.glb` → **Terrorists** (team B): brown jacket, beanie, gun holster on the thigh

Goals:
1. Replace the block-style characters with these 2 models, with walk/run/crouch/jump/death animations.
2. **3rd person:** use the model's real arm bones, with IK bringing both hands onto the anchor points on the gun (replacing the `BlockArm` of task 10), fingers curled closed.
3. **1st person:** cut out **that model's own hands/arms** (brown jacket sleeves / navy sleeves) as the viewmodel arms, also IK-attached to the gun.
4. The gameplay hitbox **does not change** (AABB as before), only adjust the model's proportions to match the hitbox.

Principles kept from task 10: the arms have no animation of their own when holding a gun, **IK attaches to anchor points** (`hand_r`, `hand_l`, `mag`), and all tunable numbers live in `poses.json` + the F9 panel.

Order: C.0 → C.1 → C.2 (the user does Mixamo) → C.3 → C.4 → C.5 → C.6 → C.7 → C.8. Tasks marked ⚠️ should use a stronger model.

---

## Task C.0 – Check the inputs (Claude Code, change nothing)

Extend `tools/blender/gun_tool.py` into `tools/blender/asset_tool.py` (keeping all old modes) and add an `inspect-character` mode:
- Import the glb into an empty scene, print JSON:
  - height (bbox z), feet/top-of-head coordinates, the direction the character faces (estimate: which side the nose/face is on; if unsure, write "needs confirmation")
  - list of meshes, triangle count per mesh, materials, textures (size of each image)
  - armature: names of all bones as a hierarchy, arm bone lengths (upper arm, forearm, hand), whether finger bones exist
  - animations already in the file (if any)
  - the mesh's vertex groups (to know whether the arms can be separated)
- Render 2 quick-look PNG images (workbench, gray background): front view and a 90° side view, saved to `assets/source/characters/_preview/`.

Report to the user:
- [ ] Original height, facing direction, names of the left/right arm and finger bones.
- [ ] Whether the Terrorists' thigh holster is a **separate mesh** or **merged** into the body mesh.
- [ ] Total texture size, with a suggested compression level.

---

## Task C.1 – Normalize + export FBX to upload to Mixamo (Claude Code)

The two models have their own skeletons with unusual bone names. The neatest way to get an **animation set shared by both teams** is to have Mixamo **re-rig** both (Mixamo attaches the standard `mixamorig:*` skeleton itself), then download the animations once and use them for both.

Do (`asset_tool.py`, `prep-mixamo` mode):
- Import the glb, **delete the old armature** (keep the meshes), apply all transforms.
- Scale to **height = 1.80m** (top of head, including the hat), put the feet at `z = 0`, horizontally centered at the origin, **face toward Blender's −Y** (Mixamo needs the character looking straight forward).
- Merge the body meshes into 1 object (except accessories that must stay separate: the thigh holster if it is a separate mesh).
- Make sure textures are packed (`pack_all`) then export **FBX** (`path_mode='COPY'`, `embed_textures=True`) to:
  - `assets/source/characters/mixamo_in/cop.fbx`
  - `assets/source/characters/mixamo_in/robber.fbx`

Acceptance:
- [ ] Re-import the FBX into an empty Blender: 1.80m tall, standing on the ground, facing −Y, textured.

---

## Task C.2 – Mixamo (the USER does this by hand, ~20 minutes)

Claude Code cannot log in to Mixamo, so you do this step in the browser (mixamo.com, a free Adobe account).

### Rig the 2 characters

1. Upload `cop.fbx` → Mixamo asks you to place markers: chin, 2 wrists, 2 elbows, 2 knees, groin. Choose **Skeleton LOD: Standard Skeleton (65)** (it includes the finger bones).
2. Preview any animation, and if it looks fine, **Download**: Format `FBX Binary`, Skin `With Skin`, Pose `T-pose`. Save as `mixamo_out/cop_rigged.fbx`.
3. Do the same with `robber.fbx` → `mixamo_out/robber_rigged.fbx`.

### Download animations (only needed for 1 character, e.g. cop)

For each animation below: search by the keyword, tick **In Place** (if that option exists), Download: `FBX Binary`, Skin **Without Skin**, Frames per Second `30`. Name the file exactly as in the "Save as" column:

| Save as | Search keyword on Mixamo | Notes |
|---|---|---|
| `rifle_idle.fbx` | rifle aiming idle | standing, aiming a rifle |
| `rifle_walk_f.fbx` | rifle walk forward | |
| `rifle_walk_b.fbx` | rifle walk backward | |
| `rifle_walk_l.fbx` | rifle strafe left / walk left | |
| `rifle_walk_r.fbx` | rifle strafe right / walk right | |
| `rifle_run_f.fbx` | rifle run | |
| `rifle_crouch_idle.fbx` | rifle crouch idle / crouching aim | |
| `rifle_crouch_walk.fbx` | rifle crouch walk | |
| `pistol_idle.fbx` | pistol idle | for pistols and the knife |
| `pistol_walk_f.fbx` | pistol walk | |
| `pistol_run_f.fbx` | pistol run | |
| `jump.fbx` | jump / rifle jump | choose the version with the least torso movement |
| `slide.fbx` | baseball slide / slide | for the slide move; skip if none is found |
| `death_1.fbx`, `death_2.fbx` | dying / death from front / death from back | 2 death styles |

Put all the files in `assets/source/characters/mixamo_out/anims/`. If you cannot find one, skip it and note its name to tell Claude Code.

---

## Task C.3 – Combine animations + export glb for the game (Claude Code) ⚠️

Do (`asset_tool.py`, `build-character` mode):
- Import `<team>_rigged.fbx`. For each file in `anims/`: import it, take the action out, **rename the action to the file name** (without `.fbx`), assign it to the character's armature (same `mixamorig:*` bone names so it matches directly), delete the temporary armature.
- Any action that still **drifts the root position** (root motion, since Mixamo had no In Place option): delete the X/Y position keyframes of the `mixamorig:Hips` bone (keep the Z axis so the bobbing up and down remains).
- Push every action into the NLA (one strip per action, all muted) so the glTF exporter exports all of them.
- Compress textures: images > 2048px are reduced to 2048; face/body images stay 2048, accessories 1024.
- Export `client/public/models/characters/cop.glb`, `robber.glb` (`export_animations=True`, `export_nla_strips=True`, `export_yup=True`).
- Then run `gltf-transform optimize` (webp textures), as with the guns.

Acceptance:
- [ ] `inspect-character` on the exported glb: 1.80m tall, has all actions named by file name, each file ≤ 8MB.
- [ ] Viewer (`client/viewer.html?model=characters/cop`) gets an animation dropdown: every animation plays correctly, and the character **stays in place** (does not drift away).
- [ ] Both characters share the same animation list.

Pitfalls:
- Bone names in three.js **have no colon**: `mixamorig:LeftArm` becomes `mixamorigLeftArm`. Everywhere in the code that looks up bones uses the colon-less name.
- Mixamo exports centimeter units in the FBX, and importing into Blender may produce a 0.01 scale on the armature. Check with the height after import, and apply the scale before exporting.

---

## Task C.4 – Characters in the game: lower-body animation, upper body aims by pitch

Do (`client/src/render/characterRig.ts`):
- Load `cop.glb` / `robber.glb` once, and for each player `SkeletonUtils.clone()` a copy (you must use `SkeletonUtils.clone`, not plain `.clone()`, otherwise the skeletons are shared).
- One `AnimationMixer` per character. Lower-body state machine, chosen by **interpolated velocity** (not by input):
  - `grounded` + speed < 0.3 m/s → idle (or crouch idle)
  - walking: blend 4 directions (`walk_f/b/l/r`) by the velocity direction **in the character's space**, weighted by the cosine of the angle; speed > 6 m/s uses `run_f` (playback faster/slower by actual speed)
  - crouching + moving → `crouch_walk`
  - in the air → `jump` (hold at the middle frame while falling)
  - sliding → `slide` (if present), otherwise `crouch_idle` + lower the torso
  - state transitions use `crossFadeTo` 0.15s
- Rifles (`third.hold = twoHand`) use the `rifle_*` set; pistols and the knife use the `pistol_*` set.
- **Aiming by pitch:** after `mixer.update`, add a rotation around the horizontal axis to `mixamorigSpine`, `Spine1`, `Spine2` (split the pitch evenly across the 3 bones, limited to ±60°), and a portion to `Head`.
- Size matches the hitbox: the model is 1.80m tall; when crouching, the top of the head must lower to about `crouchHeight` (1.2m). If the crouch animation is taller, lower the whole model further to match (`poses.json: character.crouchDrop`).
- Team A uses `cop.glb`, team B uses `robber.glb`. Changing teams changes the model.
- Remove the old block-style character (keep the code under `?blocky=1` for comparison when debugging).

Acceptance:
- [ ] Other players running in all directions: the feet step in the direction of travel, without obvious ice-skating foot slide.
- [ ] Looking up/down: the upper body and head rotate along.
- [ ] Turn on F7 (hitbox debug): the head box hugs the model's head, the body box hugs the torso, both standing and crouching.
- [ ] 10 characters at once still reach ≥ 60 FPS on an office machine.

---

## Task C.5 – 3rd person: real hands attach to the gun (replacing BlockArm) ⚠️

Do (`client/src/render/skeletonArm.ts`), with the same interface as `BlockArm` so the task 10 code can be reused:

```ts
export class SkeletonArm {
  constructor(upper: THREE.Bone, fore: THREE.Bone, hand: THREE.Bone, fingers: FingerBones, side: 'L' | 'R');
  solve(target: THREE.Vector3, targetQuat: THREE.Quaternion, pole: THREE.Vector3, weight: number): { reached: boolean };
}
```

- Shoulder = the world position of the `upper` bone (`mixamorigRightArm` / `LeftArm`), **no longer** taken from the JSON. Upper arm and forearm lengths are measured from the bones at load time.
- Reuse the `solveTwoBone` function (task P.2) to get the desired elbow and hand positions, then **rotate the bones** to match:
  1. For `upper`: compute the current direction (shoulder → current elbow) and the desired direction (shoulder → new elbow), take the quaternion rotating between the 2 directions in **world space**, convert to the parent's space, and multiply into `upper.quaternion`. Update matrixWorld.
  2. Do the same for `fore` (elbow → wrist).
  3. `hand`: set the world orientation = `targetQuat` (the orientation of the anchor Empty on the gun) multiplied by `handRotOffsetDeg` from the JSON, converted to the parent's space.
- `weight` (0..1) blends between the animation pose and IK (used when switching guns or dying: drops to 0 over 0.15s).
- **Fingers gripping the gun:** set fixed bend angles for each finger segment (`Index1..3`, `Middle1..3`, `Ring1..3`, `Pinky1..3`, `Thumb1..3`) per `poses.json: grip`. On the right hand the index finger bends less (placed on the trigger).
- Per-frame order (required): `mixer.update` → rotate the spine by pitch → `updateMatrixWorld` → place the gun per `third.gunPos` (attached to `aimPivot`, a child of `mixamorigSpine2`) → `updateMatrixWorld` → read the anchors → `armR.solve` → `armL.solve` → fingers.
- Pistol / knife (`oneHand`): attach the gun to `mixamorigRightHand`, the right hand follows the `pistol_*` animation, IK applies only to the left hand if `third.leftSupport = true` (default false).

Add to `poses.json`:

```json
"character": {
  "crouchDrop": 0.0,
  "aimPivotBone": "mixamorigSpine2",
  "spinePitchBones": ["mixamorigSpine", "mixamorigSpine1", "mixamorigSpine2"],
  "spinePitchLimitDeg": 60,
  "headPitchShare": 0.3,
  "poleR": [0.35, -0.6, 0.3],
  "poleL": [-0.35, -0.6, 0.1],
  "handRotOffsetDegR": [0, 0, 0],
  "handRotOffsetDegL": [0, 0, 0]
},
"grip": {
  "R": { "thumb": [10, 20, 15], "index": [15, 20, 10], "middle": [55, 70, 40], "ring": [60, 75, 45], "pinky": [65, 75, 45] },
  "L": { "thumb": [15, 25, 20], "index": [45, 55, 35], "middle": [55, 65, 40], "ring": [60, 70, 45], "pinky": [65, 70, 45] },
  "axis": "x"
}
```

- `grip.*.<finger>` = 3 bend angles (degrees) for segments 1, 2, 3. `axis` = the bend axis of the finger bones (Mixamo is usually the local X axis; if the fingers bend sideways instead of curling into the palm → switch to `z` and check again, flip the sign if they bend the wrong way).
- `weapons.<key>.third.gunPos/gunRotDeg` keep their meaning but are now measured from `aimPivotBone`. The old values from task 10 will need to be re-tuned with F9 + F10.

Acceptance (F10):
- [ ] Cops and Terrorists holding AK47/M16/Sniper/Shotgun/SMG: right hand grips the handle, left hand supports the front handguard, fingers curled around the gun.
- [ ] Walking, running, crouching, looking up/down: both hands stay on the gun, no twisted wrists, no backward-folded elbows.
- [ ] Firing: the gun recoils, the hands follow.
- [ ] Switching rifle ↔ pistol: smooth 0.15s transition, no frame with contorted hands.
- [ ] The F9 panel tabs `Character` and `Grip` can tune every new field.

Pitfalls:
- Wrists/elbows twisted like rope → bones are being rotated in the wrong coordinate space (world vs parent). Always: desired world quaternion → `parentWorldQuat.invert() * desiredWorldQuat`.
- Hands jerk 1 frame behind the gun → wrong update order, see the order list above.
- A `SkinnedMesh` gets clipped when close to the camera (frustum culling is wrong because of the T-pose bbox) → `mesh.frustumCulled = false` for characters.

---

## Task C.6 – 1st person: cut the model's arms out as viewmodel arms ⚠️

### C.6.1 Separate the arms (Blender, `asset_tool.py`, `build-fp-arms` mode)

- From `<team>_rigged.fbx` (which already has the Mixamo skeleton):
  - Keep the vertices whose total skin weight on the **arm** bones is ≥ 0.5: `LeftArm`, `LeftForeArm`, `LeftHand*`, `RightArm`, `RightForeArm`, `RightHand*` (including all finger bones). Delete the remaining vertices.
  - Additionally cut off the part of the upper arm near the shoulder (vertices with `LeftArm`/`RightArm` weight > 0.8 **and** less than 40% of the upper-arm length from the shoulder) so the cut edge does not get into the screen. Parameter `--keep-upper=0.6` (keep the 60% of the upper arm on the elbow side).
  - Keep the armature, delete all actions.
  - Export `client/public/models/characters/cop_fparms.glb`, `robber_fparms.glb`.
- Sleeves are automatically right for each team: Cops navy sleeves + gloves (if the model has them), Terrorists brown jacket sleeves.

Acceptance:
- [ ] Viewer: only 2 arms remain (upper arm to hand), no floating torso/shoulder fragments, a tidy cut edge.
- [ ] Each file ≤ 2MB.

### C.6.2 Use in the viewmodel

- Replace the 2 `BlockArm`s in `viewmodel.ts` with 2 `SkeletonArm`s on the `<team>_fparms.glb` model (a child of `viewScene`).
- Shoulder position: place the **armature root** so that the `RightArm`/`LeftArm` bones sit at `first.shoulderR/L` (the two may not coincide exactly at once: place the root at the midpoint of the two shoulders, rotate it to the camera's viewing direction, then tune `first.armsRootOffset` / `first.armsRootRotDeg` in the JSON).
- IK, fingers, left-hand reload (`reloadLeftHand`): **use exactly the same** logic as task 10 / C.5.
- `mesh.frustumCulled = false`; keep the `viewScene` lighting as in task P.5.
- Changing teams changes the arm model.
- Keep `BlockArm` as a fallback when the `_fparms.glb` file fails to load (log a warning).

Add to `poses.json` → `first`:

```json
"armsRootOffset": [0.0, -0.35, 0.10],
"armsRootRotDeg": [0, 0, 0],
"armsScale": 1.0
```

Acceptance:
- [ ] Terrorists: see 2 brown jacket sleeves, human skin hands, fingers wrapped around the gun. Cops: navy sleeves.
- [ ] No cut edge visible, no shoulder in frame at FOV 54 while standing, running, firing, reloading.
- [ ] Reloading: the left hand holds the magazine, pulls it down, inserts it again, fingers still gripping.

---

## Task C.7 – Death, team change, cleanup

- Death: stop IK (weight → 0), play `death_1`/`death_2` at random (no repeat, hold the last frame), the gun detaches from the hand and falls to the ground (simple physics: falls straight down + rotation, stops when it touches the floor), fades out 3 seconds later. Replaces the "flying apart blocks" effect of task 6.2 when using a rigged model.
- Respawn: reset the mixer, IK weight returns to 1 over 0.15s.
- Team change / leaving the room: `dispose` the clone's geometry, material, texture (shared textures are **not** disposed), no memory leak (check `renderer.info.memory` before and after 20 joins/leaves).

Acceptance:
- [ ] Shot dead: falls in one of 2 styles, the gun drops.
- [ ] 20 room joins/leaves: `renderer.info.memory.geometries/textures` does not keep growing.

---

## Task C.8 – Copyright note (the user checks)

- Check the license of the 2 models in the library where you cloned them (Community). Internal use is usually fine; if you ever make the game public you must be sure the license allows it, and **rename the files/display names** away from "Dust2", "T", "CT" (names tied to Counter-Strike), using `cop`/`robber` as in the plan.

---

## Notes for the user

- The Terrorists' thigh holster: if C.0 reports it as a separate mesh, keeping or dropping it is up to you (keeping it suits the "robber" look quite well). If it is merged into the body mesh, just leave it, it is not worth the effort to separate.
- 8,300 triangles per character is fine for desktop machines; it is only a worry if you later play on phones.
- The style is now **real people + Krunker-style movement** (sliding, bunny hop). Seeing a real person jump constantly may look a little funny; if it looks odd, tweak the `jump`/`slide` animations or lower the speed in `MovementConfig`.
