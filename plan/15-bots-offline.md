# 15 – Bots in offline mode (Medium / Hard)

Goals:
- Offline mode has **+ Medium bot** and **+ Hard bot** buttons in the top-left corner. Bots default to the **enemy team**.
- **Medium bot:** moves little, slow reactions, slow to aim.
- **Hard bot:** moves actively, knows how to take cover, looks for chances to close in, flanks, aims faster — **but never hits every shot**.
- Offline allows **switching teams** and buying normally with **infinite money**.

Golden rule: **a bot is a normal player**. A bot only produces an `InputCmd` each tick (keys + yaw/pitch), which goes through exactly the same `stepMovement`, `tryFire`, spread, and recoil as a real player. A bot is **not** allowed to set its position, edit health, or land hits directly. Bots miss because of spread, recoil, and aim error — naturally, like a human.

Order: B.0 → B.1 → B.2 → B.3 → B.4 → B.5 → B.6 → B.7 → B.8. Tasks marked ⚠️ should use a strong model.

---

## Task B.0 – Offline runs on the same server Room code ⚠️

Check first: how offline mode currently runs. Report to the user before doing the work.

- **If offline currently connects to a local server over WebSocket** (a private room): keep it as is, bots run on the server. Skip the rest of B.0.
- **If offline only runs on the client** (no Room): switch to running the **actual `server/src/room.ts` code inside a browser Web Worker**:
  - Split the Node-independent part of the server (`room`, `simulation`, `modes`, `lagComp`, `bots`) from the Node-only part (`ws`, `http`). The shared part must not import `ws`, `fs`, `process`.
  - `LocalTransport` (implementing the `Transport` interface from task 3.1) talks via `postMessage` between the main thread and the worker, still encoding/decoding msgpack as on a real network.
  - Rapier runs in the worker (call `init()` inside the worker).
  - Offline becomes "a room with just you + bots", and every feature (buying, grenades, game modes) runs exactly as online.

Acceptance:
- [ ] Offline starts, you can walk around and shoot targets as before, without running a Node server.
- [ ] Netsim (`?lat=`) does not apply to offline (ping = 0).

---

## Task B.1 – Navigation grid (nav grid) + pathfinding ⚠️

Create `server/src/bots/nav.ts`, generated automatically when the map loads (the user does not need to draw anything by hand):

1. **Sample standing points:** a 1m × 1m grid covering the whole map; at each cell raycast from high above downward (map colliders only) to find **every standable surface** (ground, wall-top surface, tower top, ramp surface). A surface with normal y ≥ 0.7 and enough room for a standing capsule (`canStand` check) becomes a **node**.
2. **Connect edges:** a node connects to its 8 neighbors if: height difference ≤ 0.45m (a walkable step/ramp) **and** sweeping the capsule from this node to the other does not hit a wall (`castShape`). Up/down ramp edges connect naturally thanks to the small height difference between cells.
3. **Drop-down edges:** from the edge of a wall ledge/tower, connect **one-way** down to the ground node right below if the height difference ≤ 4.5m (bots may jump down, but not climb up).
4. **Cover points:** for each ground node, raycast horizontally at height 1.0m in 8 directions, 1.2m long. If a direction hits a wall at least 1.2m high, the node is cover for that direction. Store `coverDirs` (8-direction bitmask).
5. **Zones:** assign each node to `baseA` / `baseB` / `wallA` / `wallB` / `mid` / `towerA` / `towerB` by coordinates (used for behaviors).
6. **A\***: `findPath(from, to, costFn?)`, Euclidean distance heuristic. `costFn` allows extra cost (B.6 uses it to avoid enemy line of sight). The result is smoothed by dropping intermediate nodes when a straight walk is possible (string pulling with `castShape`).
7. Cache the result by map name (generated once per startup).

Debug **F11**: draw nodes (green dots, cover nodes as yellow dots with a tick showing the wall direction), edges (thin lines), and the current path of each bot (red line).

Acceptance:
- [ ] "Two Citadels" map: there are nodes on the ground, on the wall-top surface, and on the tower top; ramps connect the ground to the wall-top surface.
- [ ] Test: `findPath` from base A to base B exists, goes through the flanking passage at the edge or through the middle area, and does not pass through walls.
- [ ] Test: from the ground to the top of tower A: the path goes up the ramp to the wall ledge and then up to the tower.
- [ ] Grid generation takes < 1 second.

---

## Task B.2 – Bot infrastructure

`server/src/bots/`:

```ts
type BotDifficulty = 'medium' | 'hard';

class BotController {
  constructor(player: Player, difficulty: BotDifficulty, params: BotParams);
  think(room: Room, nowMs: number): void;        // 10 times/second: perception, behavior choice, pathfinding
  makeInput(room: Room, seq: number): InputCmd;  // every tick: produce keys + yaw/pitch from the current behavior
}
```

- A bot is a normal `Player` in the `Room`, with an `isBot` flag and **no** transport (it sends nothing). Each tick the server calls `makeInput` and feeds the cmd through exactly the same processing path as real player input.
- **Following a path:** from the desired direction of travel (toward the next waypoint) and the bot's current yaw (where it is looking), project onto `forward`/`right` and pick the nearest W/A/S/D key combination (8 directions). When close to a waypoint (< 0.6m), move on to the next one. Stuck (no progress for 1.5s) → re-path; stuck a second time → jump once, then re-path.
- **Buying** (when respawning in the buy zone): follow `params.buy` (B.8). Offline money is infinite, so bots buy freely too.
- **Bot names:** picked at random without repeats from the list `["Teo", "Ti", "Tun", "Bin", "Bon", "Mit", "Xoai", "Bo", "Sua", "Com", "Bap", "Gao"]`, displayed as `[BOT] Teo` (the scoreboard and killfeed add a small `MED` or `HARD` label).
- Add/remove bots: functions `room.addBot(difficulty, team)` / `room.removeBot(id)` / `room.removeAllBots()`.
- Limit: total players + bots ≤ the room's `maxPlayers` (offline default 10).
- Performance: `think` at 10Hz, spread evenly by id (not letting every bot think on the same tick), at most ~20 rays per bot per think.

Acceptance:
- [ ] Add 1 bot: it appears at the enemy base and follows a path to the middle area without getting stuck on walls.
- [ ] 8 bots at once: the server tick still runs at 60/second, and client FPS does not visibly drop.

---

## Task B.3 – Perception: see, hear, remember

On each `think`:
- **Sees** an enemy when: within `fovDeg` around the bot's look direction, within 80m, and a raycast (map only) from the bot's eye to the enemy's **head or chest** is not blocked. An enemy crouching behind a low wall exposing only the head can still be seen by the head.
- **Reaction:** the first time it sees an enemy (or sees them again after losing track for > 1s) → wait `reactionMs` (random within a range) before it may aim/fire. This is the most important source of "slow like a human".
- **Hearing:** gunshots within `hearingRadius`, running footsteps within 15m (hard bots only) → record "suspect an enemy at position X" (does not know exactly who), and the bot turns its head toward that direction.
- **Getting hit:** knows the direction the bullet came from (from the shooter's position plus a random error of ±20°) and turns toward that direction.
- **Memory:** the last seen position of each enemy is kept for `memoryMs`; after that it is forgotten.
- A bot **never** knows an enemy's position through walls except via the sources above.

Acceptance:
- [ ] Standing behind a wall without shooting: the bot does not look straight at your spot through the wall.
- [ ] Fire one shot from behind the bot: the bot turns around after the reaction time.
- [ ] A medium bot visibly reacts more slowly than a hard bot (measured with the F11 overlay, see B.8).

---

## Task B.4 – Human-like aiming and shooting ⚠️

Do not use "rotate straight to the target". The model:

1. **Aim point:** chosen each time an engagement starts: chest (default) or head with probability `headChance`. Follows the enemy position with a **lag** of `trackingLagMs` (the bot aims at where the enemy just was, and does not predict the running direction) → if the enemy runs sideways fast, the bot easily shoots behind them.
2. **Aim error:** when it starts aiming at a target, add a **random offset** `aimErrorDeg` (random direction). The offset decays over time (`aimErrorDecayPerSec`) but never reaches exactly 0: there is always a slight random `aimJitterDeg` tremor (smooth noise, changing direction every 150–300ms).
3. **Mouse turning:** the bot's angle approaches the target angle with a speed-limited motion (`aimSpeedDegPerSec`) and with inertia (a damped spring), so flicking the crosshair far overshoots slightly and then corrects, like a human hand.
4. **Fire decision:** pull the trigger only when the angle between the look direction and the aim point < `fireThresholdDeg` **and** the reaction time has passed.
5. **Burst fire:** automatic guns fire a `burst` of rounds then pause `burstPauseMs` (so bloom recovers), and do not hold the trigger for the whole magazine. Semi-automatic guns: a random click rhythm 20–60% slower than the gun's maximum rate.
6. **Recoil control:** the bot only compensates `recoilCompensation` percent of the recoil (medium 30%, hard 60%); the rest makes the crosshair climb like a person who cannot hold it down.
7. **Spread, bloom, and recoil apply exactly as for a player** (the bot sends its cmd through the shared `tryFire`).
8. Long range: beyond 40m a medium bot does not fire automatic guns continuously, only single shots.

Acceptance (automated test, `npm run bot-bench`, runs offline with no UI):
- [ ] Bot vs a **stationary** human-sized target at 20m, AK47, 300 rounds: hit rate **medium 25–40%**, **hard 40–55%**; headshot rate among hits: medium ≤ 15%, hard ≤ 30%.
- [ ] Bot vs a target **running back and forth** at 6 m/s at 20m: medium 10–20%, hard 20–35%.
- [ ] Time from seeing to the first shot (stationary target, suddenly peeking out): medium 700–1100ms, hard 300–550ms.
- [ ] The bot never lands 10 consecutive headshots.
- If the measurements fall outside the range: tune `bots.json`, **do not** edit the aiming code to force the result.

---

## Task B.5 – Medium bot behavior

A simple state machine:

| State | What it does |
|---|---|
| `Patrol` | Walks slowly (keeps ~50% speed, like walking) to a random node in its half of the map or the middle area, stands there 3–8 seconds looking around, then moves on. |
| `Engage` | Sees an enemy → **stands still** (occasionally crouches, probability `crouchChance`), aims and fires per B.4. Occasionally (every 3–5s) steps sideways 1–2 steps and stands still again. |
| `Search` | Lost track → walks slowly to the last remembered position, looks around, and after `memoryMs` returns to `Patrol`. |
| `Reload` | Out of ammo → reloads in place (does not look for cover). |

- Does not flank, does not deliberately close in, does not throw grenades.

Acceptance:
- [ ] A medium bot often stands in one spot for quite a while, shoots from a distance, and is easy to flank from behind.
- [ ] An average player beats a medium bot 1v1 most of the time.

---

## Task B.6 – Hard bot behavior ⚠️

Add these states and skills:

| State | What it does |
|---|---|
| `Hunt` | Sees no one: moves to a remembered/heard enemy position, or to the middle area, **leapfrogging from one cover spot to another** (picks paths with many cover nodes), running at full speed. |
| `Engage` | Sees an enemy: **strafes left and right** (A–D) at a speed ≤ `accurateSpeed` so it still shoots accurately (knows the spread rules), changing direction randomly every 0.3–0.8s. Occasionally crouches mid-burst. |
| `TakeCover` | When: health < 50, reloading, or losing the gunfight (hit ≥ 2 times within 1s without landing a hit back) → finds the nearest cover node (≤ 12m) **that the enemy cannot see** (raycast from the remembered enemy position to the node), runs there, and reloads there. |
| `Peek` | While in cover, once reloaded → peeks out sideways 1–1.5m (or stands up if behind a low wall), fires a burst, and steps back; repeats at most 3 times, then switches cover spot. |
| `Flank` | The enemy stays in one spot > 4s (for example camping on a tower/wall ledge) → finds a path close to the enemy with a **high cost for nodes the enemy can see** (using A*'s `costFn`), going around through the map-edge passage. |
| `Push` | Closes in when there is an opportunity: the enemy is reloading (hears the reload sound within 20m), the enemy has low health (already took ≥ 60 damage), or it has a shotgun/SMG → runs straight in, and may slide (crouch while running) into close range. |

- Choose behavior with utility scores, not a long if/else tree: each behavior has a scoring function 0..1 based on the situation, the highest wins, with "stickiness" (the current behavior gets +0.15) so the bot does not change its mind constantly.
- (Optional) grenades: the enemy is behind cover and the bot has seen the enemy within the last 3s → throw a grenade to land behind the cover (use `throwInitial` + simulate `stepGrenade` to choose the throw angle that lands nearest the enemy, trying 5 pitch angles). At most 1 grenade every 20s.
- The hard bot **still** uses B.4 with hard parameters: faster reactions, faster aiming, but still with error, still affected by recoil, still misses.

Acceptance:
- [ ] Shoot a hard bot to below half health: it runs to cover, reloads, and peeks out to shoot back.
- [ ] Camping on a tower: the hard bot flanks through the map edge to get close instead of standing in the middle shooting up.
- [ ] Reload while a hard bot is nearby: it rushes in.
- [ ] A good player can beat a hard bot 1v1 but must play seriously; 1 vs 3 hard bots is very difficult.
- [ ] The hard bot does not "lock its crosshair onto" heads: in F11 its crosshair still drifts, shakes, and overshoots.

---

## Task B.7 – Offline UI

**Top-left corner** (offline mode only), a small panel with a semi-transparent dark background:

```
[ + Medium bot ]  [ + Hard bot ]
[ Swap team: Cops ⇄ Terrorists ]   [ Remove all bots ]
Bots: Teo (MED) ✕ · Mit (HARD) ✕ · ...
Infinite money ☑
```

- A new bot joins the player's **enemy team**. Holding **Shift** while clicking the button → adds a bot on **your team** (teammate).
- **Swap team**: the player moves to the other team and respawns at the new base; **all bots on the old enemy team move to the new enemy team** (still enemies to you), and teammate bots swap too (still teammates). Swapping teams resets the loadout to the default of the new team.
- ✕ next to a name: removes that bot.
- Hotkeys (usable even while the mouse is locked): `[` adds a medium bot, `]` adds a hard bot, `\` removes all bots, `` ` `` + `T` swaps team. Show small text under the buttons.
- Buttons are clickable when the mouse is free (Esc to release the mouse), like the shopping cart.
- **Infinite money** (on by default): the money HUD shows `$ ∞`, buying does not deduct money (for bots too). When turned off, it returns to the normal economy with $16000 each respawn. The buy zone and the one-gun-per-row rule **stay unchanged** (buy normally as required).
- Offline game mode: **unlimited Team Deathmatch** (no lives limit, no time limit), the scoreboard still runs. (Later we can allow choosing Elimination with bots; since bots are normal players, the Elimination rules work as is.)

Acceptance:
- [ ] Click "+ Hard bot" 3 times: 3 enemy-team bots appear, with different names and the HARD label.
- [ ] Swap team: you move to the other base, the bots are still enemies, you can shoot them, and they shoot you.
- [ ] Shift + "+ Medium bot": you get a bot teammate, and your bullets do not hurt it.
- [ ] Infinite money: buying a Sniper repeatedly does not deduct money; turn it off and money is deducted as normal.

---

## Task B.8 – Parameter file + debug

`server/src/bots/bots.json` (hot-reload in dev):

```json
{
  "medium": {
    "reactionMs": [700, 1100],
    "fovDeg": 90,
    "hearingRadius": 25,
    "memoryMs": 2500,
    "aimSpeedDegPerSec": 180,
    "aimErrorDeg": [3.0, 6.0],
    "aimErrorDecayPerSec": 2.5,
    "aimJitterDeg": 0.6,
    "trackingLagMs": 180,
    "headChance": 0.1,
    "fireThresholdDeg": 1.6,
    "burst": [3, 5],
    "burstPauseMs": [350, 600],
    "recoilCompensation": 0.3,
    "moveSpeedMul": 0.5,
    "crouchChance": 0.25,
    "skills": { "strafe": false, "cover": false, "peek": false, "flank": false, "push": false, "grenade": false },
    "buy": { "long": ["ak47", "m16"], "pistol": ["colt", "rulo"], "mid": [], "grenades": 0 }
  },
  "hard": {
    "reactionMs": [300, 500],
    "fovDeg": 110,
    "hearingRadius": 40,
    "memoryMs": 6000,
    "aimSpeedDegPerSec": 360,
    "aimErrorDeg": [1.5, 3.5],
    "aimErrorDecayPerSec": 4.0,
    "aimJitterDeg": 0.35,
    "trackingLagMs": 90,
    "headChance": 0.3,
    "fireThresholdDeg": 1.0,
    "burst": [4, 7],
    "burstPauseMs": [150, 320],
    "recoilCompensation": 0.6,
    "moveSpeedMul": 1.0,
    "crouchChance": 0.3,
    "skills": { "strafe": true, "cover": true, "peek": true, "flank": true, "push": true, "grenade": true },
    "buy": { "long": ["ak47", "m16", "sniper"], "pistol": ["rulo"], "mid": ["smg", "shotgun"], "grenades": 1 }
  }
}
```

- `buy.long/mid/pistol`: lists the bot picks from at random when buying; an empty list = keep the default gun. A hard bot picks `mid` or `long` at random (with the `Push` behavior when holding `mid`).
- Every `[min, max]` range is sampled uniformly at random each time it is used.

Debug **F11** (added to the nav drawing from B.1), shown above each bot:
- Name + difficulty + current state (`Engage`, `TakeCover`, ...).
- A line from the bot's eye to the **point it is currently aiming at** (green) and to the **point it intends to aim at** (red) — the offset is clearly visible.
- The path it is following.

Acceptance:
- [ ] Edit `bots.json` while playing: bots change how they play immediately (dev).
- [ ] `npm run bot-bench` prints a table of hit rates / reaction times for both difficulties, to compare against the ranges in B.4.

---

## Notes for the user

- To make a hard bot "gentler": raise `reactionMs`, `aimErrorDeg`, and lower `recoilCompensation`. To make a medium bot "dumber": lower `fovDeg` (easier to ambush), raise `trackingLagMs` (if you run sideways it shoots behind you).
- The hit rate of an ordinary FPS player is about 20–30%, a good one about 35–45%. The target ranges in B.4 follow that, so a hard bot is on par with a decent player, not a cheater.
- Bots also work online: later the room host can add bots to an online room to fill it up (only a button is needed; the logic already exists).
