# Phase 6 – Polish (pick individual tasks)

Each task is independent; do any task, in any order. **No task may change the logic of `shared/movement.ts` or the netcode.**

## 6.1 Box models for Cops & Terrorists
- Build in code from BoxGeometry parts (head, torso, 2 arms, 2 legs) or a box-style `.glb` file.
- Cops: blue torso, kepi-style cap (flat box + brim). Terrorists: black striped torso, face scarf, money bag on the back.
- Sizes match the hitboxes (the head exactly in the head zone) so that when a player aims at the head, they hit the head.
- Acceptance: shooting the model's head always gives a headshot (turn on F7 to compare).

## 6.2 Procedural animation
- No animation files needed: arms and legs swing with a sine of the distance walked, crouching lowers the torso, sliding leans the body back, jumping tucks the legs.
- The upper body rotates with pitch (looking up/down), and the whole body rotates with yaw.
- Run animation follows the **interpolated velocity**, not the input.
- Death: the blocks break apart, drift gently, then fade out (cheaper than a ragdoll, fits the box style).

## 6.3 Guns in other players' hands
- Attach the gun mesh to the right-arm block, switching with `weapon` in NetPlayer.
- The muzzle flash shows when a ShotFx is received.

## 6.4 New guns
- Sniper: 1 shot per 1.2s, damage 90, headMult 2, with a scope (hold right mouse to zoom to FOV 30, blacking out the screen outside a circle), very large spread when not scoped.
- Shotgun: 8 rays per shot (spread seeded by `shotSeq` and the ray index), damage falls off with distance.
- Only add to `WEAPONS` + effects; reuse the firing logic.

## 6.5 Map visuals
- Real textures replace the grid (brick for the citadel wall, wood for crates), a skybox, light fog.
- Shadows: only 1 directional light, 2048 shadow map, only the map casts shadows, characters do not cast shadows (or use a fake round shadow under the feet).
- Acceptance: still ≥ 60 FPS on an office laptop.

## 6.6 Settings
- Sensitivity, FOV, master volume / gun volume, crosshair color and style. Saved to localStorage.

## 6.7 (Optional) geckos.io transport
- Only change the `Transport` implementation (task 3.1). If anything outside the transport has to be edited → stop and report back.
