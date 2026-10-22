# Phase 4 – Online shooting ⚠️

Goal: hit registration feels right. The golden rule: **the client only reports "when I pulled the trigger and which way I was looking"; the server decides hit or miss.**

## Added messages

```ts
// InputCmd already has: buttons with the Fire bit, weapon, and fireRenderTime
// fireRenderTime = currentRenderTime (task 3.5) at the firing tick; only sent when the Fire bit is on.

// Server → Client
  | { t: 106; damage: number; headshot: boolean; targetId: number }           // HitConfirm (sent only to the shooter)
  | { t: 107; killerId: number; victimId: number; weapon: number; headshot: boolean } // Kill (sent to the whole room)
  | { t: 108; id: number; pos: Vec3; yaw: number }                             // Respawn (sent to the whole room)
  | { t: 109; shooterId: number; origin: Vec3; dir: Vec3; dist: number }       // ShotFx (whole room, to draw tracers/gunshot sounds of other players)
  | { t: 110; origin: Vec3; dir: Vec3; boxes: HitBox[] }                       // DebugShot (only when debug is on)

// NetPlayer adds: hp, alive, weapon, ammo (only needs to be exact for yourself), invulnUntil
```

---

## Task 4.1 – Shooting via InputCmd, server controls ammo/fire rate

Do:
- Client: when the mouse is held, set the Fire bit in the cmd and fill in `fireRenderTime`. The client still runs `tryFire` locally to **show effects immediately** (flash, sound, recoil, ammo deduction on the HUD) — this is prediction, like movement prediction.
- Server: when processing a cmd with the Fire bit → run `tryFire` (the same `shared` function) with `nowMs` = the server's simulation time. A valid shot creates a "shot" (task 4.2). An invalid one is ignored.
- Your own `WeaponState` is sent in the snapshot; the client reconciles ammo/reload the same way it reconciles position.
- `nowMs` in `tryFire` on both sides = the cmd's `seq * 1000 / TICK_RATE` (not the server tick), so client and server compute the fire rate identically.

Acceptance:
- [ ] Temporarily change the client to send Fire every tick with the Pistol: the server accepts exactly 4 shots/second (log).
- [ ] The HUD ammo matches the server after emptying the magazine and reloading (no 1–2 round drift).

Pitfalls:
- If the server tick is used as `nowMs`, then when 2 cmds arrive bunched in one tick the server rejects the 2nd shot even though the client allowed it → ammo drift. Use the cmd's `seq`.
- The server **must** limit `seq` from running much faster than real time (a cheater sending jumping seqs to shoot faster): if the number of cmds received in 1 second > 66, drop the excess.

---

## Task 4.2 – Server hitscan (no lag compensation yet)

Purpose: be correct at 0 ping first, then add time rewind.

Do (`server/src/simulation.ts`):
- Ray origin: the shooter's eye according to the state **right after running that cmd** (`pos + eyeHeight`).
- Direction: from `cmd.yaw`, `cmd.pitch` + recoil + spread (rng seeded with `playerId, shotSeq`) — **the same formula as the client**.
- `wallDist` = Rapier `castRay` against map colliders only, up to `range`.
- For every other living player on a **different team** (phase 5; for now every player except yourself can be shot): `hitboxesFor(current state)`, `rayAabb`, take the nearest hit < `wallDist`.
- Hit: compute damage by body part, and send HitConfirm to the shooter. (Health deduction is in task 4.4.)
- Always send ShotFx to the whole room (except the shooter) to draw tracers + play positional gunshot sounds (PannerNode).

Acceptance (run with `?lat=0`):
- [ ] Tab A stands still, tab B shoots A's head: B gets a red hitmarker.
- [ ] B shoots A through a firing slot: hits. Shooting the wall next to the slot: does not hit.
- [ ] Tab A sees B's tracer and hears B's gunshot from the right direction.

---

## Task 4.3 – Hitbox history + lag compensation ⚠️

Idea: the shooter sees the opponent in the **past** (ping/2 delay + 100ms interpolation). The server has to rewind the opponent to that moment before judging the hit.

Do (`server/src/lagComp.ts`):
- After each server tick, store in a ring buffer: `{ serverTime, players: Map<id, { pos, crouching, alive }> }`. Keep `HITBOX_HISTORY_MS` (60 entries).
- When processing a shot:
  1. `t = clamp(cmd.fireRenderTime, serverNow − MAX_REWIND_MS, serverNow)`.
  2. Find the 2 history entries bracketing `t` and interpolate each player's `pos` (exactly the way the client interpolates in task 3.5). `crouching`, `alive` come from the earlier entry.
  3. Build hitboxes from the rewound positions and raycast as in task 4.2.
  4. **Walls are not rewound** (static map). The shooter is **not rewound** (use their own current position).
- A target who was already dead at time `t` is skipped.
- F7 key (debug): the server sends DebugShot containing the ray and the rewound hitboxes; the client draws the wireframes for 2 seconds. The rewound hitboxes the shooter sees must **coincide** with the character model they saw when firing.

Acceptance:
- [ ] `?lat=100` in tab B, A runs sideways continuously. B aims straight at A (on B's screen) and fires: **hit** (before lag comp it would miss behind A).
- [ ] With F7 on: the rewound hitbox matches the image of A that B sees, with an error < 10cm.
- [ ] A `fireRenderTime` sent older than 250ms (temporarily change the client): the server clamps it and does not rewind beyond the limit.

Pitfalls:
- The rewound hitbox is consistently offset by a fixed amount along the running direction → client and server compute `renderTime` differently: check that `INTERP_DELAY_MS` is the same and that the clock offset (task 3.3) is correct.
- Random offset → the server's interpolation differs from the client's (for example the server takes the nearest snapshot instead of interpolating). It must interpolate identically.
- The history must be stored **by the tick's serverTime**, not by the time the snapshot was sent.

---

## Task 4.4 – Health, death, respawn, invulnerability

Do (server):
- `hp = 100` on spawn. On a hit: `hp −= damage` (not deducted if invulnerable). `hp ≤ 0` → `alive = false`, send Kill, store `respawnAt = now + RESPAWN_DELAY_MS`.
- Dead players: no movement/fire processing, no hitbox.
- Respawn: pick a spawn (your own team's in phase 5; for now any) **farthest from living enemies** (maximize the distance to the nearest enemy), set a new state, `hp = 100`, full ammo, `invulnUntil = now + SPAWN_INVULN_MS`, send Respawn.
- Invulnerability ends early as soon as that player fires their first valid shot.
- Client: on death → gray screen + "Killed by [name]" + countdown. On respawn → teleport (clear `pending`, set the new state, no smoothing). An invulnerable character flickers translucent.

Acceptance:
- [ ] Rifle body shots: 4 shots to kill. Headshot: 1 shot to kill.
- [ ] Dead for 3 seconds then respawn far from the enemy.
- [ ] Just after respawn, getting shot loses no health; after firing one shot, getting shot loses health.
- [ ] Two players kill each other on the same tick: both die (no one "cheats" and survives), and the killfeed shows 2 lines.

---

## Task 4.5 – Hitmarker, killfeed, hit effects

Do (client):
- The hitmarker **only appears on receiving HitConfirm** (no guessing ahead). A "tick" sound on hit, a "ting" on headshot.
- Killfeed in the top-right corner: `Shooter [weapon] Victim`, with an icon for headshots, each line lives 5 seconds, at most 5 lines.
- Getting shot: a red border on the screen edge on the side the bullet came from (computed from a ShotFx that hit you, or add a field to the HitConfirm on the victim's side).
- Floating damage numbers (optional, off by default).

Acceptance (end-of-phase test):
- [ ] 3 tabs with ping 20/80/150, shooting each other for 5 minutes: no case of "clearly aimed on target but not counted" (use F7 to check when in doubt).
- [ ] Killfeed, hitmarker, and respawn work correctly in all 3 tabs.
