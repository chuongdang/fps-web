# Phase 1 – Moving around solo (offline)

Goal: running, jumping and sliding in the "Two Citadels" map feels great. **All movement logic lives in `shared/`**, because in phase 3 the server will run exactly the same code.

---

## Data types (used throughout the project)

```ts
// shared/src/movement.ts
export const Btn = {
  Forward: 1 << 0, Back: 1 << 1, Left: 1 << 2, Right: 1 << 3,
  Jump: 1 << 4, Crouch: 1 << 5, Fire: 1 << 6, Reload: 1 << 7,
} as const;

export interface InputCmd {
  seq: number;        // increments by 1 per tick on the client
  buttons: number;    // Btn bitmask
  yaw: number;
  pitch: number;
  weapon: number;     // weapon slot (phase 2)
  fireRenderTime?: number; // phase 4, only present while firing
}

export interface PlayerState {
  pos: [number, number, number];  // the character's feet (bottom of the capsule)
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouching: boolean;
  slideTimer: number;     // > 0 = sliding
  slideCooldown: number;
}
```

Main function signature:

```ts
export function stepMovement(
  state: PlayerState,       // do NOT mutate directly, return a new state
  input: InputCmd,
  world: CollisionWorld,    // wrapper around Rapier, see below
  cfg: MovementConfig,
  dt: number,
): PlayerState;
```

`CollisionWorld` (in `shared/src/physics/world.ts`) provides exactly 2 things:
- `moveCharacter(pos, desiredDelta, crouching) → { pos, grounded, hitCeiling }`
- `canStand(pos) → boolean` (is there enough room to stand up)

`stepMovement` **must not** read real time, `Math.random`, global variables, or the DOM.

---

## Task 1.1 – Pointer lock + mouse look

Do (`client/src/input.ts`):
- Click the canvas → `requestPointerLock()`. Esc exits (the browser handles it), show the overlay "Click to play".
- `mousemove`: `yaw -= movementX * sens`, `pitch -= movementY * sens`, clamp pitch to ±89° (±1.553 rad). `sens` defaults to 0.0022 rad/pixel, saved in localStorage.
- Keys: hold state for WASD, Space, Ctrl/C (crouch), R, left mouse button (fire). Export a function `sampleButtons(): number`.
- Camera: `camera.rotation.order = 'YXZ'`, set `rotation.y = yaw`, `rotation.x = pitch` **every frame** (do not wait for the tick, so mouse look has no lag).

Acceptance:
- [ ] Mouse right → look right. Mouse up → look up. No flipping upside down when dragging to the limit.
- [ ] Mouse rotation is smooth on a 144Hz display (does not stutter to the 60 tick).
- [ ] Ctrl+W does not close the tab while the mouse is locked (use C as the default crouch key, Ctrl as secondary).

Pitfall:
- Some browsers occasionally return a huge spike in `movementX` right when the pointer lock starts → ignore values with |movementX| > 300 in the first frame.

---

## Task 1.2 – Fixed timestep loop

Do (`client/src/loop.ts`):

```ts
let acc = 0, last = performance.now();
function frame(now: number) {
  acc += Math.min((now - last) / 1000, 0.25); // clamp when the tab was hung
  last = now;
  while (acc >= DT) {
    prevState = currState;
    const cmd = buildInputCmd();          // seq++, buttons, yaw, pitch
    currState = stepMovement(currState, cmd, world, cfg, DT);
    acc -= DT;
  }
  const alpha = acc / DT;
  renderPlayerAt(lerpState(prevState, currState, alpha)); // camera position
  requestAnimationFrame(frame);
}
```

- Camera position = interpolation between `prevState` and `currState` by `alpha`. The view angle is **not** interpolated; use the latest yaw/pitch from the mouse.

Acceptance:
- [ ] Set the display to 60Hz and 144Hz: run speed is the same (measure by the time to run along a wall).
- [ ] Switch tabs for 10 seconds then come back: the character is not "shot" far away.

---

## Task 1.3 – stepMovement: walking, friction, gravity, jumping ⚠️

Default `MovementConfig` (Krunker feel, tune later):

```ts
export const defaultMovement = {
  runSpeed: 8.5,        // m/s
  crouchSpeed: 4.0,
  groundAccel: 10,      // Quake style: accel * wishSpeed * dt
  airAccel: 12,
  airWishCap: 1.0,      // cap on wishSpeed while airborne (for air strafe)
  friction: 6,
  stopSpeed: 2.0,
  gravity: 22,
  jumpVelocity: 7.0,    // ~1.1m high
  standHeight: 1.8, crouchHeight: 1.2, radius: 0.4,
  eyeStand: 1.6, eyeCrouch: 1.0,
  slideBoost: 3.0, slideDuration: 0.6, slideFriction: 0.8, slideCooldown: 1.0,
  slideMinSpeed: 6.0,
};
```

Algorithm each tick (in exactly this order):

1. `wishDir` = sum of `forward`/`right` per the pressed keys (using yaw only), normalized; if nothing is pressed then `wishDir = 0`.
2. `wishSpeed = crouching ? crouchSpeed : runSpeed`.
3. If **grounded**:
   - If Jump is held → jump: `vel.y = jumpVelocity`, `grounded = false`, **skip friction this tick**. Holding Space jumps again right as you touch the ground (Krunker-style bunny hop).
   - Otherwise: apply friction then `accelerate(groundAccel)`.
4. If **airborne**: `accelerate(airAccel)` with `wishSpeed = min(wishSpeed, airWishCap)`.
5. `vel.y -= gravity * dt`.
6. Call `world.moveCharacter(pos, vel * dt, crouching)`. If `grounded` and `vel.y < 0` → `vel.y = 0`. If `hitCeiling` and `vel.y > 0` → `vel.y = 0`.
7. Decrease `slideTimer`, `slideCooldown` by dt (task 1.5).

```ts
function accelerate(vel, wishDir, wishSpeed, accel, dt) {
  const current = vel[0] * wishDir[0] + vel[2] * wishDir[2];
  const add = wishSpeed - current;
  if (add <= 0) return;
  const a = Math.min(accel * wishSpeed * dt, add);
  vel[0] += a * wishDir[0];
  vel[2] += a * wishDir[2];
}

function applyFriction(vel, friction, stopSpeed, dt) {
  const speed = Math.hypot(vel[0], vel[2]);
  if (speed < 1e-4) { vel[0] = 0; vel[2] = 0; return; }
  const control = Math.max(speed, stopSpeed);
  const newSpeed = Math.max(speed - control * friction * dt, 0);
  const k = newSpeed / speed;
  vel[0] *= k; vel[2] *= k;
}
```

Implementing `moveCharacter` with Rapier:
- Each character: one capsule collider attached to a kinematic body. `controller = world.createCharacterController(0.02)`.
- `controller.setMaxSlopeClimbAngle(50°)`, `controller.enableSnapToGround(0.3)`, **autostep off** (use ramps).
- `controller.computeColliderMovement(collider, delta, filterFlags, filterGroups)` → `computedMovement()`, `computedGrounded()`.
- `hitCeiling`: delta.y > 0 but the actual movement along y is < 50% of delta.y.
- **Players do not collide with each other**: use collision groups, the player capsule only collides with the map. (Simplifies netcode.)

Acceptance:
- [ ] Running straight reaches ~8.5 m/s (show the speed on the debug overlay, task 1.6).
- [ ] Releasing the keys: stops completely within ~0.3 seconds, no ice-like sliding.
- [ ] Can walk up the ramp onto the citadel wall top, and walking down does not "bounce" off the slope.
- [ ] Standing on the ground, jumping does **not** reach the 4m wall top.
- [ ] Jumping and bumping the head on the underside of a ledge/slot frame drops you straight down, no sticking to the ceiling.
- [ ] Slides along a wall when running diagonally into it (does not get stuck).

Pitfall:
- Apply friction **before** accelerate, and only when grounded.
- Do not normalize vel when computing wishDir; only normalize wishDir.
- If walking down a slope bounces: check that snap-to-ground is on, and that step 6 sets `vel.y = 0` when grounded.

---

## Task 1.4 – Air movement, bunny hop

Do: finish steps 3–4 above if they are not complete, and tune the parameters.

Acceptance:
- [ ] Holding Space continuously while running: jumps again the moment you land, and speed does not drop from friction.
- [ ] While airborne, holding A + dragging the mouse left (air strafe) changes direction and gains slight speed.
- [ ] While airborne, pressing S does not brake as sharply as on the ground.

---

## Task 1.5 – Crouch + slide

Rules:
- Pressing Crouch while grounded and horizontal speed ≥ `slideMinSpeed` and `slideCooldown ≤ 0` → start sliding: add `slideBoost` along the current velocity direction, `slideTimer = slideDuration`, `slideCooldown = slideCooldown`.
- While `slideTimer > 0`: friction uses `slideFriction`, **skip accelerate** (you cannot steer while sliding, only look around), the camera lowers to `eyeCrouch`.
- When the slide ends while Crouch is still held → normal crouch. Releasing Crouch → stand up if `canStand`, otherwise stay crouched.
- Crouch: switch the capsule to `crouchHeight` (keep the feet in place, lower the top of the head).
- Camera: eye height interpolates smoothly over ~0.1s, no snapping.

Acceptance:
- [ ] Run + press C: glides a noticeable distance then slows down.
- [ ] Mashing C does not allow spamming slides (there is a cooldown).
- [ ] Can slide through a low firing slot if the slot is tall enough for the crouched pose (try tuning one slot to 1.3m high to test).
- [ ] Standing up under a low overhang: cannot stand, stays crouched, does not get stuck in the ceiling.

---

## Task 1.6 – Determinism test + debug overlay

Do:
- Test (vitest, running real Rapier): create 2 worlds from the same map, run the same sequence of 600 InputCmd (seeded random: run, jump, slide, turn), compare the state each tick → **must be identical** (compare every number, tolerance 0).
- Test: the input sequence "run straight for 2 seconds" gives a final speed in the range 8.4–8.6.
- Overlay (F3 key), top-left corner, small text: FPS, horizontal speed, `grounded`, `slideTimer`, position, yaw/pitch.
- Parameter tuning panel (F6 key): a slider for every field of `MovementConfig`, applied immediately, with a "copy JSON" button to paste back into the code.

Acceptance:
- [ ] The determinism test passes.
- [ ] Changing `runSpeed` on the panel takes effect immediately.

Pitfall:
- If the determinism test fails: usually because (1) `Math.random`/time is used in `stepMovement`, (2) one world is shared between both runs, (3) colliders are created in a different order between the 2 worlds. Fix the root cause, **do not loosen the test tolerance**.
