# 00 – Overview: FPS Web "Cops vs Terrorists"

## How to use this plan set (for the user)

- Copy the whole `plan/` folder and the `CLAUDE.md` file into the root of the new repo.
- **Give each Claude Code session only one task** (for example "do task 1.3"). Sample prompt:
  > Read CLAUDE.md, plan/00-overview.md and plan/02-phase1-movement.md. Do task 1.3. When done, report using the template in CLAUDE.md.
- After each task, **test by hand using that task's checklist** before handing out the next task. Do not hand out 3 tasks at once.
- Tasks marked ⚠️ are hard tasks. Use the strongest model you have for these.
- If Claude fails to fix a bug after 2 attempts: open a new session, paste the bug description + the debug overlay output, and do not continue the old session (its context has become tangled).
- The MOBA sub-repo has a netcode that reconciles by input replay and already works well. At task 3.6, fill in the path here so Claude can read it for reference: `MOBA_REPO = <fill in path>`

## Goal

A browser FPS for internal play. Two-team Team Deathmatch, **Cops** and **Terrorists**, Krunker-style box characters, fast movement (slide, bunny hop), handless guns, hitscan shooting, fast respawn.

Principle: nail the gameplay feel first, make it pretty later.

## Theme

- Fictional factions. **Do not use real uniforms, badges, or ranks** of any force.
- Cops: blue, kepi-style cap. Terrorists: black/striped, face scarf, money bag on the back.
- Names and team colors live in `shared/src/teams.ts`, so changing the pair of factions later only requires editing config.

## Stack (use only these libraries)

| Purpose | Library |
|---|---|
| Language / runtime | TypeScript, Node 24 |
| Client build | Vite |
| Rendering | `three` |
| Physics / collision | `@dimforge/rapier3d-compat` (client **and** server) |
| Networking | `ws` (server), browser WebSocket (client) |
| Message encoding | `@msgpack/msgpack` |
| Testing | `vitest` |
| Running the dev server | `tsx` |

Pin exact versions in `package.json` (no `^`), and client and server use **the same Rapier version**.

## Repo structure

```
fps-web/
  CLAUDE.md
  plan/
  package.json            # npm workspaces
  shared/src/
    constants.ts          # tick rate, interp delay...
    math.ts               # vec helpers, angle lerp, seeded rng
    movement.ts           # stepMovement (pure)
    movementConfig.ts
    weapons.ts            # gun stats
    teams.ts
    protocol.ts           # message types + encode/decode
    map/types.ts
    map/loadMap.ts        # read JSON, handle mirror
    physics/world.ts      # build the Rapier world from a map (shared)
    hitbox.ts             # hitbox from PlayerState, ray-AABB
  server/src/
    main.ts
    transport.ts
    room.ts
    simulation.ts
    lagComp.ts
    match.ts              # TDM rules
  client/src/
    main.ts
    input.ts
    loop.ts
    net/transport.ts
    net/clock.ts
    net/prediction.ts
    net/interpolation.ts
    render/scene.ts
    render/mapMesh.ts
    render/players.ts
    render/viewmodel.ts
    hud/  (HTML/CSS)
    audio.ts
    debug/overlay.ts
  assets/
    maps/hai-thanh.json
    models/  textures/  sounds/
```

## Main constants (`shared/src/constants.ts`)

```ts
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3;      // 20 snapshots/second
export const INTERP_DELAY_MS = 100;
export const MAX_REWIND_MS = 250;
export const HITBOX_HISTORY_MS = 1000;
export const MAX_INPUT_QUEUE = 10;
export const MAX_INPUTS_PER_TICK = 2;
export const RESPAWN_DELAY_MS = 3000;
export const SPAWN_INVULN_MS = 2000;
```

## Map 1 "Two Citadels" (file `hai-thanh.json`)

The two teams are split along the **X** axis: team A (Cops) on the **negative x** side, team B (Terrorists) on the **positive x** side. The plane of symmetry is `x = 0`. The map is 60m wide (x: −30..30) × 40m deep (z: −20..20).

Layout of one half (x from −30 to 0). The numbers are **starting values**; playtest, then tune:

| Component | Suggested position / size |
|---|---|
| Outer wall | 8m high around the whole map |
| Base A (spawn) | x −30..−20, 6–8 spawn points scattered in this area |
| Citadel wall A | center x = −19, 1.5m thick, 4m high, running z −16..16 (open at both ends to leave flanking routes) |
| Firing slots | 3–4 slots in the citadel wall, 1.2m wide, bottom 1.0m above the ground, 1.0m tall |
| Wall-top ledge | the top of the wall is walkable; 0.8m low parapet on the mid-field side |
| Stairs up to the ledge | ramp from the ground to the wall top (4m), ~8m long, hugging the wall on the base side |
| Tower A | 4×4m block, top at 6m, near the base corner; **a single way up**: a ramp from the wall ledge up to the tower top |
| Mid-field | x −18..0: a few low walls 1.2–2m high, one large block in the center (x = 0, marked `noMirror`) |

Rules to keep when tuning the map:
- The tower is open on all sides and can be shot at from the opposing wall ledge.
- Spawns are **not in line of sight** of the other team's firing slots, wall ledge, or tower.
- The flanking routes along the two z edges are always passable.
- Players **cannot jump from the ground onto the wall top** (4m) — they can only get up via the ramp.

## Phases

| File | Content |
|---|---|
| `01-phase0-setup.md` | Project skeleton, map, static rendering |
| `02-phase1-movement.md` | Offline movement |
| `03-phase2-weapons.md` | Offline guns |
| `04-phase3-netcode-move.md` ⚠️ | Multiplayer movement |
| `05-phase4-netcode-shoot.md` ⚠️ | Online shooting, lag compensation |
| `06-phase5-tdm.md` | Team Deathmatch rules |
| `07-phase6-polish.md` | Polish (pick and choose) |
| `08-task-gun-audio.md` | Gun set + per-gun audio |
| `09-hud-shop-economy.md` ⚠️ | New HUD, 4 weapon slots, shop, economy |
| `tools-blend-to-glb.md` | Convert .blend models to .glb |
| `11-characters.md` ⚠️ | Rigged characters for both factions, real hand IK, viewmodel arms cut from the model |
| `12-grenade.md` ⚠️ | M67 grenade: buy, pull the pin, throw, bounce, explode |
| `13-game-modes.md` ⚠️ | Elimination (round-based) / Team Deathmatch (respawn) modes, room creation |
| `14-spread-ads.md` ⚠️ | Speed-based spread + bloom, dynamic crosshair, optional ADS |
| `15-bots-offline.md` ⚠️ | Medium/Hard bots, nav grid, add-bot button, offline team switching |
| `16-zombie-infection.md` ⚠️ | Zombie foundation (shared) + Infection mode |
| `17-zombie-defense.md` ⚠️ | Defense mode: wave-based zombie defense, boss |
| `18-packaging.md` ⚠️ | Package runnable files for Windows/Mac, recipients do not need to install Node |

## Definition of "done" for the first version

4–6 players split into 2 teams on "Two Citadels", smooth running, jumping and sliding, able to climb onto the ledge and shoot through the slots, shooting each other feels right on hit registration, no friendly fire, die – respawn at base – match ends – scoreboard – swap sides.
