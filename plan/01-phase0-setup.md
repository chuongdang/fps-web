# Phase 0 – Project skeleton

Goal: the repo runs, the "Two Citadels" map shows up in the browser, and a free-fly camera lets you look around.

---

## Task 0.1 – Monorepo + scripts

Do:
- npm workspaces with 3 packages `shared`, `server`, `client`. `server` and `client` import `shared` by package name (for example `@fps/shared`).
- `tsconfig` in strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- Scripts at the root:
  - `npm run dev` → run the server (tsx watch) + client (vite) at the same time
  - `npm run typecheck` → `tsc --noEmit` for all 3 packages
  - `npm test` → vitest
- Server defaults to port 8080, client to 5173.

Acceptance:
- [ ] `npm run dev` opens a blank page with the text "FPS Web", and the server console prints "listening 8080".
- [ ] `npm run typecheck` and `npm test` (with a dummy test) pass.
- [ ] Changing a constant in `shared` makes both client and server see the new value without a manual build.

Pitfall:
- Vite must be configured to handle workspace packages as TypeScript source (not pre-built). If imports fail, check that `exports`/`main` in `shared/package.json` point to `src/index.ts`.

---

## Task 0.2 – Constants, conventions, empty protocol

Do:
- `shared/src/constants.ts` per `00-overview.md`.
- `shared/src/math.ts`:
  - `forwardFromYaw(yaw, out)`, `rightFromYaw(yaw, out)` following the conventions in CLAUDE.md
  - `lerp(a, b, t)`, `lerpAngle(a, b, t)` (takes the shortest path across ±π)
  - `mulberry32(seed)` returns a random function over [0,1)
  - `hashSeed(...nums)` combines several numbers into a 32-bit seed
- `shared/src/protocol.ts`: declare empty message types (to be filled in gradually), and `encode(msg)` / `decode(buf)` functions using msgpack. Every message has a field `t` (a small number, for example `1 = Input`) used to classify it.

Acceptance:
- [ ] Test: `forwardFromYaw(0)` = (0,0,−1); `forwardFromYaw(π/2)` = (−1,0,0); `rightFromYaw(0)` = (1,0,0).
- [ ] Test: `lerpAngle(3.0, −3.0, 0.5)` gives a result close to ±π (not 0).
- [ ] Test: `mulberry32(42)` called 3 times gives the same sequence on every run.
- [ ] Test: encoding then decoding an object yields the original object.

---

## Task 0.3 – Map format + loader + mirror

Data types (`shared/src/map/types.ts`):

```ts
type Vec3 = [number, number, number];

interface MapBox {
  pos: Vec3;          // center of the block
  size: Vec3;         // full size (not half-extent)
  texture: string;    // "wall" | "floor" | "crate" ...
  noMirror?: boolean; // block lies on the center axis, do not duplicate
}

interface MapRamp {
  from: Vec3;   // midpoint of the bottom edge
  to: Vec3;     // midpoint of the top edge
  width: number;
  noMirror?: boolean;
}

interface MapSpawn { pos: Vec3; yaw: number; }

interface MapFile {
  name: string;
  mirrorX: boolean;
  boxes: MapBox[];
  ramps: MapRamp[];
  spawnsA: MapSpawn[];   // only declare team A when mirrorX = true
}

interface LoadedMap {
  name: string;
  boxes: MapBox[];
  ramps: MapRamp[];
  spawns: { A: MapSpawn[]; B: MapSpawn[] };
}
```

Mirror rules (`loadMap.ts`), when `mirrorX = true`:
- Every box/ramp without `noMirror`: add a copy with `x → −x` (for `pos`, `from`, `to`). `size` stays unchanged.
- Every team A spawn → a team B spawn with `x → −x` and **`yaw → −yaw`**.
- Validation: no box (except `noMirror` ones) may cross `x = 0`; if one does, throw a clear error.

Acceptance:
- [ ] Test: a box at x = −5 produces a box at x = 5.
- [ ] Test: spawn A at x = −25, yaw = −π/2 (facing +X, i.e. toward the enemy) → spawn B at x = 25, yaw = π/2 (facing −X). Check with `forwardFromYaw`: the two directions have opposite x signs.
- [ ] Test: a box with `noMirror` is not duplicated.
- [ ] Test: a box crossing x = 0 without `noMirror` → throws.

Pitfall:
- This is the easiest place to go wrong in phase 0: forgetting to flip yaw, or flipping it as `π − yaw`. With this project's conventions, flipping the X axis is equivalent to **`yaw → −yaw`**.

---

## Task 0.4 – Build the "Two Citadels" map + static render

Do:
- Write `assets/maps/hai-thanh.json` following the table in `00-overview.md` (only the negative-x half + the `noMirror` blocks).
- `shared/src/physics/world.ts`: `createWorld(map: LoadedMap)` creates the Rapier world; each box is a static cuboid collider, each ramp is a cuboid rotated to the slope. This function is **shared by client and server**.
- Firing slots: a wall with slots is assembled from several boxes (the segment below the slot, the segment above it, and the segments on both sides), **without boolean CSG**.
- Client: `render/mapMesh.ts` builds meshes from the same data (BoxGeometry, ramps are rotated boxes), grid prototype texture (can temporarily generate the grid with a canvas if no texture file exists yet).
- Free-fly camera (WASD + mouse, Q/E up/down) to look at the map. Lighting: 1 hemisphere + 1 directional.

Acceptance:
- [ ] The map shows everything: outer wall, 2 bases, 2 citadel walls with slots, 2 ramps, 2 towers, mid-field.
- [ ] The two halves are symmetric (fly up high and look down to compare).
- [ ] Debug mode (F4 key) draws Rapier collider wireframes over the meshes: colliders match the meshes, ramps included.
- [ ] Spawns show as small arrows pointing along yaw; the arrows of both teams point toward the mid-field.

Pitfall:
- Ramp: a Rapier cuboid is rotated with a quaternion about the axis perpendicular to the slope direction. Compute the angle as `atan2(to.y − from.y, horizontal distance)`. Verify with the wireframe; do not trust your eyes on the mesh.
- A grid texture gets stretched on long blocks: adjust `texture.repeat` per face size, or use UVs based on world coordinates.
