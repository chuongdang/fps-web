# 17 – The **Defense** mode: everyone on the same team holding the fortress against zombie waves

| Display name | Code |
|---|---|
| **Defense** | `defense` |

Summary: all players are on the same team, holding **base A** of the "Two Citadels" map. Zombies (bots) come in **10 waves**, each wave bigger and stronger, with many different zombie types, and wave 10 is a **boss**. Between waves you can buy gear and respawn teammates. Holding out all 10 waves wins; the whole team dying at once loses.

Prerequisites:
- File 16, **part ZF** (zombie foundation) is done. Part I (Infection) is not required.
- File 15: **B.0, B.1, B.2** (offline runs a Room, nav grid, bot infrastructure).
- File 13: `MatchMode`, room creation.

Order: T.1 → T.2 → T.3 → T.4 → T.5 → T.6 → T.7 → T.8 → T.9. Tasks marked ⚠️ should use a strong model.

---

## Room settings

```ts
export interface DefenseSettings {
  mode: 'defense';
  difficulty: 'easy' | 'normal' | 'hard';   // 'normal'
  waves: number;                              // 10
  intermissionSec: number;                    // 25
  lighting: 'day' | 'night';                  // 'night'
}
```
`MODE_LABEL.defense = 'Defense'`. Playable with 1–6 players (offline, mainly 1 player).

---

## Task T.1 – The `DefenseMode` class (server) ⚠️

Phases:

```
WARMUP ──(host presses Start / offline starts automatically)──► PREP (30s) ──► WAVE 1 ──► INTERMISSION ──► WAVE 2 ... ──► WAVE 10 (boss) ──► VICTORY
                                                                   │                                                     
                                                         (all players dead at the same time) ──► DEFEAT
VICTORY / DEFEAT ──(20s)──► WARMUP
```

- All players are on team A (Cops or Terrorists depending on their choice, just a skin) and spawn in **base A**. Zombies are separate entities (not players), see T.4.
- **PREP / INTERMISSION**: buy gear in the base A buy zone; dead teammates are **respawned** at the base with the guns they already had, full health. A large countdown is shown.
- **WAVE n**: spawn zombies per `waves.json` (T.3). The wave ends once everything has been spawned and **all zombies of the wave are dead**. Wave-clear bonus is awarded.
- **Player dies during a wave**: does not respawn until INTERMISSION; switches to spectating teammates (reusing M.5). Can be **rescued** (T.6).
- **DEFEAT**: all players are dead (or downed awaiting rescue) at the same time.
- **VICTORY**: the wave 10 boss and all remaining zombies are downed.
- **Economy** (`ECONOMY_DEFENSE`):
  ```ts
  { startMoney: 1500, maxMoney: 16000, waveClearBonus: 800, waveClearPerWave: 100, // wave n rewards 800 + 100×n
    keepLoadoutOnDeath: true, infiniteReserve: true, sellRatio: 0.8 }
  ```
  Money for killing a zombie depends on its type (T.2). No wanted bounty.
- No friendly fire. Your own grenade exploding on you still costs 50% (rule G.3).

Additional messages:

```ts
  | { t: 140; phase: string; wave: number; waves: number; phaseEndsAt: number; zombiesLeft: number }  // DefenseState
  | { t: 141; wave: number; title: string; hint: string }                                          // WaveStart ("WAVE 4", "Watch out for leaping zombies!")
  | { t: 142; wave: number; bonus: number }                                                        // WaveClear
  | { t: 143; result: 'victory' | 'defeat'; wave: number; stats: { id: number; kills: number; damage: number; revives: number }[] } // DefenseEnd
```

Acceptance:
- [ ] Offline 1 player: PREP 30s → wave 1 → no zombies left → INTERMISSION → wave 2...
- [ ] Dying mid-wave: spectate teammates (if any), respawn at INTERMISSION; dying while playing alone is DEFEAT.
- [ ] Debug commands: `/wave 9` jumps to wave 9, `/clearwave` kills all zombies of the current wave.

---

## Task T.2 – Zombie types (`shared/src/zombieTypes.json`)

```json
{
  "walker":   { "name": "Walker",        "hp": 150, "runSpeed": 4.5, "clawDamage": 15, "attackMs": 900,  "knockbackResist": 0.0, "reward": 50,
                "scale": 1.0,  "tintOverride": null,      "abilities": [] },
  "runner":   { "name": "Runner",        "hp": 90,  "runSpeed": 9.0, "clawDamage": 10, "attackMs": 600,  "knockbackResist": 0.0, "reward": 75,
                "scale": 0.92, "tintOverride": "#c9b28a", "abilities": [] },
  "crawler":  { "name": "Crawler",       "hp": 110, "runSpeed": 5.0, "clawDamage": 12, "attackMs": 800,  "knockbackResist": 0.0, "reward": 75,
                "scale": 0.95, "tintOverride": "#8f9f8a", "abilities": ["crawl_holes"] },
  "leaper":   { "name": "Leaper",        "hp": 160, "runSpeed": 7.0, "clawDamage": 18, "attackMs": 850,  "knockbackResist": 0.1, "reward": 100,
                "scale": 1.0,  "tintOverride": "#9a8fb0", "abilities": ["leap"] },
  "brute":    { "name": "Brute",         "hp": 900, "runSpeed": 3.8, "clawDamage": 40, "attackMs": 1400, "knockbackResist": 0.8, "reward": 300,
                "scale": 1.35, "tintOverride": "#a87a6a", "abilities": ["shove"] },
  "screamer": { "name": "Screamer",      "hp": 250, "runSpeed": 5.0, "clawDamage": 10, "attackMs": 1000, "knockbackResist": 0.2, "reward": 200,
                "scale": 1.05, "tintOverride": "#b0a060", "abilities": ["rally"] },
  "boss":     { "name": "Zombie Kingpin", "hp": 12000, "runSpeed": 4.2, "clawDamage": 60, "attackMs": 1600, "knockbackResist": 0.95, "reward": 3000,
                "scale": 2.2,  "tintOverride": "#7a5050", "abilities": ["slam", "summon", "charge"], "headMult": 3 }
}
```

- `hp` is the health at `normal` difficulty with 1 player. Multiply by the factors in T.3.
- `crawl_holes`: may use the path through loopholes (a special nav edge, T.4). Every other zombie does **not** use hole paths.
- `leap`: uses the E high-leap ability from ZF.2 to get onto the wall ledge (the leap-up nav edge, T.4).
- `shove`: a claw hit pushes the human back at 4 m/s (pushing people off the wall ledge to the ground!).
- `rally`: every 10s it screams, and other zombies within 12m gain 25% speed for 5s (with a brighter-eyes effect). Priority target.
- Boss: T.5.
- Each type picks a random model from `zombieModels.json` (ZF.1) unless it has `modelOverride`; `tintOverride` replaces the random tint so that **you can tell the type by color**. If the group has extra models, you can assign one to a specific type with `modelOverride: "z2"`.
- Zombies use the **same hitbox** as humans (head ×2 by default, boss ×3), with the hitbox multiplied by `scale`.

---

## Task T.3 – Zombie waves (`shared/src/waves.json`)

```json
{
  "spawnPoints": {
    "baseB": "all ground nodes inside base B",
    "laneLeft": "ground nodes at the map's left edge, on the x > 0 side",
    "laneRight": "ground nodes at the map's right edge, on the x > 0 side"
  },
  "scaling": {
    "countPerExtraPlayer": 0.6,
    "hpPerExtraPlayer": 0.35,
    "difficulty": { "easy": { "count": 0.7, "hp": 0.7, "damage": 0.7 },
                    "normal": { "count": 1.0, "hp": 1.0, "damage": 1.0 },
                    "hard": { "count": 1.3, "hp": 1.3, "damage": 1.25 } }
  },
  "maxAlive": 28,
  "waves": [
    { "title": "WAVE 1", "hint": "Let's get warmed up",            "groups": [ { "type": "walker", "count": 10, "from": ["baseB"], "everyMs": 1500 } ] },
    { "title": "WAVE 2", "hint": "These ones run fast",            "groups": [ { "type": "walker", "count": 10, "from": ["baseB"], "everyMs": 1200 },
                                                                            { "type": "runner", "count": 6,  "from": ["laneLeft","laneRight"], "everyMs": 2500, "delayMs": 8000 } ] },
    { "title": "WAVE 3", "hint": "Watch the loopholes!",           "groups": [ { "type": "walker", "count": 12, "from": ["baseB"], "everyMs": 1000 },
                                                                            { "type": "crawler", "count": 8, "from": ["baseB"], "everyMs": 2000, "delayMs": 5000 } ] },
    { "title": "WAVE 4", "hint": "Watch out for zombies leaping onto the ledge",  "groups": [ { "type": "walker", "count": 12, "from": ["baseB","laneLeft"], "everyMs": 1000 },
                                                                            { "type": "leaper", "count": 6,  "from": ["baseB"], "everyMs": 3000, "delayMs": 6000 } ] },
    { "title": "WAVE 5", "hint": "A brute is coming",              "groups": [ { "type": "walker", "count": 14, "from": ["baseB"], "everyMs": 900 },
                                                                            { "type": "runner", "count": 8,  "from": ["laneLeft","laneRight"], "everyMs": 1800 },
                                                                            { "type": "brute",  "count": 1,  "from": ["baseB"], "delayMs": 15000 } ] },
    { "title": "WAVE 6", "hint": "Take down the screamer first!",  "groups": [ { "type": "walker", "count": 14, "from": ["baseB","laneRight"], "everyMs": 800 },
                                                                            { "type": "screamer", "count": 2, "from": ["baseB"], "everyMs": 10000, "delayMs": 5000 },
                                                                            { "type": "crawler", "count": 8, "from": ["baseB"], "everyMs": 1500 } ] },
    { "title": "WAVE 7", "hint": "They're coming from every side", "groups": [ { "type": "runner", "count": 14, "from": ["laneLeft","laneRight"], "everyMs": 1000 },
                                                                            { "type": "leaper", "count": 8,  "from": ["baseB"], "everyMs": 2000 },
                                                                            { "type": "brute",  "count": 2,  "from": ["baseB"], "everyMs": 12000, "delayMs": 10000 } ] },
    { "title": "WAVE 8", "hint": "Hold the line!",                 "groups": [ { "type": "walker", "count": 20, "from": ["baseB","laneLeft","laneRight"], "everyMs": 600 },
                                                                            { "type": "crawler", "count": 10, "from": ["baseB"], "everyMs": 1200 },
                                                                            { "type": "screamer", "count": 2, "from": ["laneLeft","laneRight"], "everyMs": 8000 } ] },
    { "title": "WAVE 9", "hint": "The last wave before the Kingpin arrives", "groups": [ { "type": "runner", "count": 16, "from": ["laneLeft","laneRight"], "everyMs": 700 },
                                                                            { "type": "leaper", "count": 10, "from": ["baseB"], "everyMs": 1500 },
                                                                            { "type": "brute",  "count": 3,  "from": ["baseB"], "everyMs": 9000 } ] },
    { "title": "WAVE 10", "hint": "THE ZOMBIE KINGPIN",            "groups": [ { "type": "boss",   "count": 1,  "from": ["baseB"] },
                                                                            { "type": "walker", "count": 16, "from": ["baseB","laneLeft","laneRight"], "everyMs": 2500, "delayMs": 10000 } ] }
  ]
}
```

- `spawnPoints`: the descriptions above are the **meaning**; the code takes real nodes from the nav grid by zone (task B.1). Pick a random node that is **not in any player's line of sight** (raycast); otherwise move on to another node.
- Actual count = `round(count × difficulty.count × (1 + countPerExtraPlayer × (players − 1)))`. Actual health is computed similarly.
- While `maxAlive` zombies are alive, spawning pauses and waits for some to die.
- Hot-reload the file in dev.

---

## Task T.4 – Zombie AI (server) ⚠️

A zombie is a **separate entity** `ZombieEntity` (not a `Player`), but it **shares `stepMovement`** with the zombie movement (ZF.2) so that collisions, ramp walking, and jumping are identical, and the client draws it with interpolation like other players.

- Each zombie has a `PlayerState` + a `ZombieBrain`. Each server tick: the brain produces an `InputCmd` → `stepMovement`. The brain **thinks 5 times per second**, spread evenly.
- **Target selection**: the nearest living player **by path** (A* length, cached for 1s), preferring a player it can see. Zombies always know where players are (zombies "sniff"), no need to see them — this is PvE, the point is to rush in.
- **Special nav edges** (added to the B.1 nav grid, tagged by kind):
  - `hole`: passes through each loophole (node before the hole → node after the hole, traversed by crouch + jump). Only zombies with `crawl_holes`.
  - `leapUp`: a ground node at the foot of the fortress wall → the wall-top node directly above (height difference ≤ 4.2m). Only zombies with `leap`, when the ability is off cooldown.
  - `leapTower`: a wall-ledge node → a nearby tower-top node (height difference ≤ 2.2m). `leap` only.
  - A* receives the list of allowed edges per zombie type.
- **Walking**: follows the path, picks W/A/S/D keys like bots (B.2), looks in the direction of travel (a zombie always looks ahead).
- **Crowd separation**: zombies do not collide with each other (like humans), so they easily stack. Add a light separation push: each zombie's heading is offset away from other zombies within a 0.8m radius, so the crowd looks spread out.
- **Attack**: target within 1.6m and visible (raycast) → turn to face, stop, claw (`attackMs` rhythm, with a 0.25s wind-up telegraph; if the human backs off in time it misses). Damage is multiplied by the difficulty factor.
- **Stuck**: no progress for 2s → jump once + re-path; stuck for 6s → if no one can see it, teleport to the nearest valid node (prevents a zombie stuck in a corner from keeping the wave from ending).
- **Falling off the map / ending up somewhere odd**: below y = −5 → dies, no money awarded.
- **Network sync**: zombies are sent in the snapshot as a slimmed-down `NetPlayer`: `{ id, type, pos, vel, yaw, flags (attack, leap, crawl, hit, dead), hpPct }`. 28 zombies × 20Hz with msgpack is still small. The client interpolates like other players (task 3.5).
- **Performance**: 28 zombies, one Rapier capsule each; A* caches paths by destination node; re-path when the target moves more than 3m away from the old path.

Acceptance:
- [ ] A walker takes the ramp up to the wall ledge to reach a player standing on the ledge.
- [ ] A crawler squeezes through a loophole into base A; a walker does not.
- [ ] A leaper jumps from the wall foot onto the ledge; from the ledge onto the tower.
- [ ] 28 zombies do not clump into one blob, and none stays stuck forever.
- [ ] The server holds 60 ticks/second with 28 zombies + 4 players.

---

## Task T.5 – Boss "Zombie Kingpin"

- Model: any zombie, `scale 2.2`, dark red tint, bigger and brighter eyes. A large boss health bar at the top of the screen (`ZOMBIE KINGPIN` + health %).
- Does not squeeze through holes, does not leap onto ledges, takes the ramp path. **Standing on the ledge or tower is not safe** because it has these abilities:
- **Ground slam (`slam`)**: when a player is within 7m, it raises both arms for 1.0s (a **red circle** is drawn on the ground as a telegraph with a 6m radius) → slams: players inside the circle lose 35 health and are thrown 9 m/s away + 5 m/s upward. Cooldown 8s.
- **Summon the horde (`summon`)**: each time boss health drops below 75%, 50%, 25%: it roars and spawns 6 runners around the boss (ignoring `maxAlive`).
- **Charge (`charge`)**: target at 10–25m, on the same plane: lowers its head for a 0.8s telegraph (a roar) → charges straight at 14 m/s for 1.2s or until it hits a wall; hitting a player: 50 health + knockback. Hitting a wall: stunned for 2s, takes ×1.5 damage (a chance to unload ammo). Cooldown 12s.
- Weak point: head ×3.
- Death: slow death animation, symbolic money drop (effect), banner `KINGPIN DOWN!`.

Acceptance:
- [ ] Every ability has enough telegraph for an alert player to dodge it.
- [ ] A boss that hits a wall is stunned, and unloading into its head makes its health drop quickly.

---

## Task T.6 – Downed and rescuing teammates

- During a wave, a player whose health reaches 0 is **downed** (not fully dead): lies down, crawls slowly at 1 m/s, can shoot with a pistol (if they have one), and only dies for good 30 seconds later. Zombies still attack a downed player.
- A teammate standing next to them (≤ 1.5m) **holds the E key for 3 seconds** → revives them with 40 health. If the rescuer is hit during the rescue, they must restart the hold.
- Playing alone: no downed state, health 0 is immediate death (so you do not wait a meaningless 30s).
- HUD: a downed player shows a red cross icon through walls to teammates, with a ring for the time remaining.

Acceptance:
- [ ] 2 tabs: tab A goes down, tab B can rescue; a zombie clawing B during the rescue resets the rescue ring.

---

## Task T.7 – Defense HUD

- Top center: `WAVE 4 / 10  ·  23 zombies left` (during a wave) or `Next wave in 0:18` (between waves).
- Wave-start banner (3s): the title + hint from `waves.json` (`WAVE 4` / `Watch out for zombies leaping onto the ledge`).
- Wave-clear banner: `WAVE 4 CLEARED · +$1200`.
- Boss health bar when there is a boss.
- **Zombie health**: a small health bar over the head of a zombie shot within the last 3s (to know whether it is about to go down). Brute/screamer/boss always show the type name in the matching color.
- **Floating damage numbers** (on by default in Defense).
- Screen-edge arrows pointing to the direction of zombies attacking the nearest **teammate** (not just you), so you know whom to rescue.
- End of match: a stats table per player: zombies killed, damage, number of rescues, highest wave.

---

## Task T.8 – Atmosphere and cleanup

- Use the night preset + flashlight from ZF.3.
- Dead zombies: stay for 4s then sink into the ground (no fade, to save shader cost), at most 30 corpses at once (the oldest corpse disappears first).
- Between waves: the background sound softens; 5 seconds before a new wave: distant screams echo from the direction the zombies will come from.
- Boss wave: switch to a tenser background track (if a `boss_theme.ogg` file exists; if not, skip).

---

## Task T.9 – Balance

Playtest and tune `zombieTypes.json`, `waves.json`. Goals (`normal` difficulty):
- [ ] **1 player** who plays decently and buys sensibly: holds out to around wave 7–8, and clears all 10 waves if playing very well.
- [ ] **4 players**: clear 10 waves if they coordinate, lose if each runs off on their own.
- [ ] Money is enough that by wave 5 you can buy a good rifle + grenades, but not so much that you buy everything from wave 2.
- [ ] Every special zombie type forces players to change how they defend (watch the holes, watch the ledge, prioritize the screamer).
- Record the numbers of each attempt (wave lost, time per wave, money) in `plan/notes/defense-balance.md` for comparison.

---

## Notes for the user

- The "Two Citadels" map now plays the role of a fortress: base A is home, the A fortress wall is the defensive line, tower A is the last stand, and base B and the two edge passages are the doors the zombies flood in through.
- If you have extra zombie models: assign them to the zombie type you want with `modelOverride` in `zombieTypes.json` (for example a bulky model for `brute`, a skinny one for `runner`). If unassigned, zombies pick randomly.
- Easy to extend later: add waves 11–20 for an "endless" mode; adding a new zombie type is just one JSON entry + one ability in code.
