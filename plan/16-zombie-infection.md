# 16 – Zombie: shared foundation + the **Infection** mode

This file has 2 parts:
- **Part ZF (zombie foundation)**: model, zombie character, leap ability, crawling, knockback, night, flashlight, sound. **Shared by both Infection and Defense (file 17).** Do this part first.
- **Part I (Infection)**: human-vs-human rules, mother zombie, infection, hero.

Prerequisites: task 11 (skeletal character), 13 (MatchMode, room creation). File 17 additionally needs task 15 (bots, nav grid).

Order: ZF.1 → ZF.2 → ZF.3 → ZF.4 → ZF.5 → ZF.6 → ZF.7 → I.1 → I.2 → I.3 → I.4 → I.5. Tasks marked ⚠️ should use a strong model.

---

# PART ZF – ZOMBIE FOUNDATION (shared)

## Task ZF.1 – Zombie models and variants

The user already has 1 zombie model and will add a few more. Each model goes through the character pipeline of task 11:

1. **Claude Code**: `prep_mixamo.py` → `assets/source/zombies/mixamo_in/<name>.fbx` (default height 1.8m; a big zombie can use `--height 2.1`).
2. **User (Mixamo)**: re-rig → `mixamo_out/<name>_rigged.fbx`. Zombie animations **only need to be downloaded once** (shared by all zombies since they use the same Mixamo skeleton), Without Skin, 30fps, In Place, saved to `assets/source/zombies/mixamo_out/anims/`:

| Save as | Mixamo keyword | Notes |
|---|---|---|
| `z_idle.fbx` | zombie idle | |
| `z_walk.fbx` | zombie walk | |
| `z_run.fbx` | zombie running | |
| `z_attack_1.fbx` | zombie attack | claw swipe |
| `z_attack_2.fbx` | zombie punching / zombie biting | attack variant |
| `z_scream.fbx` | zombie scream | when turning into a zombie, when leaping |
| `z_crawl.fbx` | zombie crawl / crawling | crawling through a hole |
| `z_jump.fbx` | jump | used for the high leap ability |
| `z_death_1.fbx`, `z_death_2.fbx` | zombie dying / zombie death | |
| `z_hit.fbx` | zombie reaction hit / hit reaction | recoil when shot |
| `z_transform.fbx` | zombie stand up / getting up | human turning zombie (getting up) |

3. **Claude Code**: `build-character` (task C.3) → `client/public/models/zombies/<name>.glb`.

**Model list** `shared/src/zombieModels.json`:

```json
{
  "models": [
    { "id": "z1", "file": "zombies/z1.glb", "scale": 1.0, "eyeBone": "mixamorigHead", "eyeOffset": [0, 0.08, 0.09] }
  ],
  "variation": {
    "scaleJitter": 0.06,
    "tints": ["#9fb59a", "#b5a99a", "#8fa0a8", "#a89a9a"],
    "tintStrength": 0.35,
    "eyeGlow": "#ff3b2f"
  }
}
```

- Each zombie, when spawned, picks a random model, a scale offset of ±6%, multiplies color by a tint (keeping the original texture, only shifting the hue), and has **glowing red eyes** (2 small additive sprites attached to the head bone at `eyeOffset`). 1 model + 4 tints is enough to look different.
- **Zombie from an infected human** (Infection): reuses that person's Cops/Terrorists model, applying a gray-green tint + red eyes + zombie animations. No separate model is needed, yet you can still tell "who just got turned".
- Missing zombie model (file not there yet): use the Terrorists model + tint as a temporary zombie.

Acceptance:
- [ ] The viewer can play every `z_*` animation on every zombie model, standing in place.
- [ ] 10 zombies of the same model still look different (tint, size).

---

## Task ZF.2 – Zombie role in gameplay (shared + server) ⚠️

- `Player` gets `role: 'human' | 'zombie'` and `zombieType: string | null` (Infection uses `'mother'` / `'normal'`; Defense uses the types from file 17).
- **Zombie weapon** (`WEAPONS`, `category: 'claw'`, not buyable, not droppable):
  - Normal claw (left mouse): melee hitscan with range `1.8m`, `damage` taken from the zombie type, `fireIntervalMs 550`.
  - Heavy claw (right mouse): range `2.0m`, damage ×2, `fireIntervalMs 1100`, with a 0.3s wind-up before it lands (the human has time to back off).
  - No spread, no recoil, with lag compensation like the knife.
- **Zombie movement** (a separate `MovementConfig`, chosen by `role` in `stepMovement`, still deterministic):
  - `runSpeed` per zombie type (default 9.5, faster than a human's 8.5).
  - `crouchHeight: 0.85` (smaller than a human's 1.2) → **crawls through loopholes** (hole 1.0m tall, bottom 1.0m above the ground): the zombie jumps while crouched to squeeze into the hole. Jumping while crouched is allowed for zombies.
  - No slide, no bunny hop (consecutive jumping loses 30% of horizontal speed on each landing).
- **High leap ability** (key **E**, new bit `Btn.Ability`): `vel.y = 13.8` (apex ≈ 4.3m: reaches the **4m wall ledge**, does **not** reach the 6m tower), plus 5 m/s in the look direction, cooldown `leapCooldownMs = 8000`. The cooldown lives in `PlayerState` (deterministic, with tests).
- **Knockback when hit** (server, on every shot that hits a zombie):
  ```
  impulse = damage × knockbackPerDamage[weapon] × (1 − zombie.knockbackResist)
  vel += horizontalDir(shooter → zombie) × impulse + up × impulse × 0.25
  ```
  `knockbackPerDamage`: shotgun 0.06 per pellet (8 pellets hitting = a very strong push), sniper 0.05, rulo 0.05, AK47 0.025, M16 0.02, SMG 0.015, colt 0.02. Clamp total horizontal velocity after the push to ≤ 14 m/s. A zombie that is airborne gets ×1.5 (shot off the ledge!).
  - Applied to server state; the zombie's own client is reconciled naturally. A slight jerk is accepted (the player playing the zombie will see themselves "shot back" after one ping).
- **Zombie regeneration**: not hit for `regenDelayMs` (4000) → regenerates `regenPerSec` health per second up to the maximum.
- Zombies **cannot** buy, **cannot** pick up guns, **cannot** throw grenades. The shop is hidden for zombies.
- Players (human): **infinite reserve ammo** in zombie modes (only magazines need reloading). Add an `infiniteReserve` flag to the mode settings.

Acceptance:
- [ ] A zombie can crawl through the loopholes in the fortress wall (crouch + jump into the hole). A human cannot.
- [ ] A zombie can leap with E from the ground onto the wall-top surface; leaping from the ground to the tower top is **not** possible; from the wall ledge to the tower top it is possible (2m difference).
- [ ] Shooting a shotgun at a zombie climbing a ramp: it is thrown back down.
- [ ] The movement determinism test passes with zombies (crouch-jump, E ability).

---

## Task ZF.3 – Night + flashlight

- Add `lighting: 'day' | 'night'` to the room settings (default `night` for the 2 zombie modes).
- **Night preset**: a very dark hemisphere light (blue-black), a weak "moon" directional light with a pale blue tint, `scene.fog` (FogExp2, density ~0.035, blue-black color), a dark skybox with a few stars, a few orange-yellow street lamps fixed on the fortress walls (PointLight, **no shadows**, at most 6) so the map is not pitch dark.
- **Flashlight** (humans, key **F**, on by default): a `SpotLight` attached to the camera (25° angle, 30m range, shadows off), the viewmodel has a light streak. Other players also see your flashlight beam: a SpotLight attached to the look direction on the 3rd-person model, **at most 4 other players' flashlights** are on at the same time (the nearest to you), and the rest only draw a fake light cone (an additive cone mesh, not a real light) to keep FPS.
- **Zombie night vision**: when you are a zombie, the screen has a slight red-tinted filter and overall brightness is raised (ambient ×3 on the zombie's client side only). Zombies have no flashlight. The red eyes of other zombies are **always visible** in the dark (the sprite is unaffected by lighting).

Acceptance:
- [ ] At night the map is still readable thanks to the street lamps; outside the lit areas you must use the flashlight.
- [ ] 8 players with flashlights on: still ≥ 60 FPS.
- [ ] Playing as a zombie: you see better than a human, with a red tint.

---

## Task ZF.4 – Zombie viewpoint (1st/3rd person)

- **1st-person zombie**: cut the arms from the zombie model (or the infected human model + tint) with `build-fp-arms` (task C.6). No gun. Both hands sit low on either side of the screen and sway while running.
  - Normal claw: one hand swings diagonally across the screen (bezier curve, 180ms, keyframes in `poses.json → zombie.swipe`), alternating left/right.
  - Heavy claw: both hands raise up (0.3s) then slam down.
  - E leap: both hands swing backward.
- **3rd-person zombie**: uses the `z_*` animations. Run → `z_run`, walk → `z_walk`, crouch/crawl → `z_crawl`, claw → `z_attack_1/2` upper body only (masked as in G.6), getting hit → `z_hit` blended 30% on the upper body, jump → `z_jump`, death → `z_death_*`.
- **Turning into a zombie**: the infected human falls down (0.5s) → `z_transform` (1.5s, invulnerable, cannot move) → becomes a zombie. That player's screen: green flash, slight image distortion, a scream.

Acceptance:
- [ ] Playing as a zombie you see zombie hands, and clawing feels like a real arm swing.
- [ ] Other players see the zombie run, claw, crawl, and leap with the correct animations.

---

## Task ZF.5 – Zombie sounds

Add to the sound system (task 08). Prefer files; if missing, use a rough synthesized sound:

| Sound | When |
|---|---|
| `growl_01..05` | the zombie growls at random every 3–8s, positional (the player can hear which direction the zombie is coming from) |
| `scream` | turning into a zombie, mother zombie appearing, E leap |
| `claw_swing`, `claw_hit` | claw misses / claw hits |
| `zombie_step` | heavy footsteps (4dB louder than human footsteps) |
| `zombie_hurt_01..03` | getting shot (limited to once per 0.3s per zombie) |
| `zombie_death` | death |
| `infect_sting` | short jingle when someone is infected (the whole room hears it, quiet) |
| `ambient_night` | night background: wind, insects, distant echoes, looping |
| `heartbeat` | humans: when a zombie is within 8m but not visible (vague warning) |

- Keywords for finding files: `zombie growl`, `zombie scream`, `monster roar`, `claw swipe`, `flesh hit`, `night ambience`.
- Synthesized fallback for `growl`: lowpass 400Hz noise + sawtooth tone at 70–110Hz with vibrato (LFO 6Hz), 0.8s. Only so it is not silent; replace it when a file exists.

Acceptance:
- [ ] With your eyes closed, you can tell whether a zombie is to the left, right, or behind you.

---

## Task ZF.6 – Zombie HUD

- **When a zombie**: replace the weapon/ammo slot with a **large health bar** (zombie health is in the thousands, show the number), an E leap icon with a cooldown ring, and the crosshair changes to a small claw shape. Hide money and the cart.
- **When a human**: ammo shows `25 / ∞`.
- Zombie hit: the shooter's hitmarker additionally shows a small damage number (on by default in zombie modes, because zombie health is large and you need to see how much you are dealing).

---

## Task ZF.7 – Performance check

- 20 zombies (skeletal models) + 8 humans + flashlights + fog: ≥ 60 FPS on an office machine. If not met:
  - Zombies farther than 25m: update animation at 30Hz instead of every frame, turn off glowing eyes beyond 40m.
  - Share materials per tint (do not create a new material for each zombie).

---

# PART I – THE INFECTION MODE

| Display name | Code |
|---|---|
| **Infection** | `infection` |

Summary: everyone starts as a human, and after 20 seconds a few become **mother zombies**. A zombie claws a human → the human becomes a zombie. If humans hold out until time runs out they win the round; if the zombies infect everyone the zombies win. The last human becomes the **hero**.

## Settings (`roomConfig.ts`)

```ts
export interface InfectionSettings {
  mode: 'infection';
  rounds: number;          // 8
  prepSec: number;         // 20 – everyone is human, find a spot, buy guns
  roundTimeSec: number;    // 180
  roundEndSec: number;     // 6
  lighting: 'day' | 'night';  // 'night'
}
```
`MODE_LABEL.infection = 'Infection'`. A minimum of 3 players to start (bots count as humans, see I.5).

## Mode config (`shared/src/infection.ts`)

```ts
export const INFECTION = {
  startMoney: 6000,            // per round, not carried over to the next round
  buyAnywhereDuringPrep: true, // during the prep phase you can buy anywhere
  motherCount: (players: number) => (players >= 8 ? 2 : 1),
  mother:  { hpBase: 3000, hpPerHuman: 400, runSpeed: 10.0, clawDamage: 60, knockbackResist: 0.3, regenPerSec: 80 },
  normal:  { hpBase: 1500, hpPerHuman: 150, runSpeed: 9.5,  clawDamage: 45, knockbackResist: 0.0, regenPerSec: 50 },
  regenDelayMs: 4000,
  zombieRespawnMs: 5000,       // a downed zombie respawns (still a zombie)
  transformMs: 1500,
  hero: { hp: 200, damageMult: 1.5, speedMult: 1.1 },
  points: { surviveRound: 3, infect: 1, killZombie: 2, killAsHero: 3, mother: 1 },
  sniff: { cooldownMs: 15000, radius: 18, durationMs: 2500 }, // the zombie "sniff" ability (I.3)
};
```

---

## Task I.1 – The `InfectionMode` class (server) ⚠️

Implements `MatchMode` (task M.1). The phases:

```
WARMUP ──(≥ 3 players)──► PREP (prepSec) ──► PICK (2s) ──► LIVE (roundTimeSec) ──► ROUND_END ──► PREP next round
                                                                                    │
                                                              (after `rounds` rounds) ──► MATCH_END ──(15s)──► WARMUP
```

- **PREP**: everyone is `human`, money = `startMoney`, can buy anywhere, respawn immediately if dead (no one is killing anyone). Spawns are spread across the whole map (pick ground nodes of the nav grid from task B.1 that are far apart, not just at the bases). There are no Cops/Terrorists teams in this mode: everyone is on the same "Human" side.
- **PICK**: pick `motherCount` random players as mother zombies, **do not re-pick the player who was mother zombie last round** if there are other choices. They transform in place (`transformMs`, invulnerable), and the whole room hears `scream` + a banner.
- **LIVE**:
  - A zombie claws a human: subtract `clawDamage` health; health ≤ 0 → the human is **infected** in place (becomes a `normal` zombie, health per the formula, `transformMs`), it does **not** count as a death, no gun is dropped.
  - A human downs a zombie (zombie health ≤ 0): the zombie falls, and after `zombieRespawnMs` respawns as a zombie at the point **farthest from humans**. The human who downed it gets `points.killZombie`.
  - Zombie health is recomputed whenever the number of living humans changes: `hpMax = hpBase + hpPerHuman × livingHumans` (current health keeps its % ratio).
  - Exactly 1 human left → **hero** (`hero`): health raised to 200, damage ×1.5, speed ×1.1, banner for the whole room.
  - No humans left → zombies win the round. Time runs out with ≥ 1 human left → humans win the round; each surviving human gets `+surviveRound`.
- **No friendly fire** between humans; zombies cannot claw zombies.
- **Player leaves mid-round**: if they were the only mother zombie and no zombies remain → immediately pick a human to be the new mother zombie.
- **Player joins mid-round**: joins as a **zombie** (normal) if LIVE; joining during PREP makes them a human.
- **Points**: the scoreboard is ordered by personal points (`points`), and the overall winner is the player with the most points after `rounds` rounds.

Additional messages:

```ts
  | { t: 130; playerId: number; byId: number | null; kind: 'mother' | 'infected' }  // Infected
  | { t: 131; playerId: number }                                                    // HeroChosen
  | { t: 132; humans: number; zombies: number }                                     // InfectionCount (on change)
```

Acceptance (use the M.8 debug commands, adding `/zombie` to turn yourself into a zombie, and `/human`):
- [ ] 3 tabs: after 20s one player becomes the mother zombie, and the whole room sees the banner.
- [ ] A zombie claws twice → the human becomes a zombie in place, gets up after 1.5s, and can claw other humans.
- [ ] Shoot a zombie to death: 5s later it respawns far away.
- [ ] 1 human left: becomes the hero, health 200.
- [ ] Time runs out with a human left: humans win the round; everyone infected: zombies win the round.
- [ ] After 8 rounds: the end screen shows by personal points.

---

## Task I.2 – Anti-tower-camping balance

- Check by playtesting: 3–4 players stand on the tower, 2 zombies. Goal: the zombies **have a chance** (using the wall ledge + E leap onto the tower + heavy claw), and good players can still hold if they coordinate.
- Balancing tools (already in the config, just tune numbers): `leapCooldownMs`, `knockbackPerDamage`, `hpPerHuman`, `clawDamage`.
- If the tower is still too strong after tuning numbers: add a **"tower decay"** rule (optional, `towerDecay` flag): a player standing on the tower top for more than 40s continuously loses 2 health/second (toxic smoke rises, with an effect). Tell the user before enabling it.

Acceptance:
- [ ] 4 players defending the tower vs 2 mother zombies, 5 rounds: the zombies win at least 1–2 rounds.

---

## Task I.3 – Zombie "sniff" ability

- The zombie presses **Q**: for `sniff.durationMs`, everyone within `sniff.radius` shows a **faint red outline through walls** on that zombie's screen (outline shader or redraw the mesh with a transparent red material, `depthTest: false`). Cooldown `sniff.cooldownMs`.
- A sniffed human hears a nearby `growl` + a small "nose" icon shows on the HUD for 2 seconds (they know they are exposed).
- Purpose: humans cannot hide in a dark corner for the whole 3 minutes.

Acceptance:
- [ ] A zombie pressing Q sees humans behind walls within 18m, and none beyond 18m.

---

## Task I.4 – Infection HUD and notifications

- Top center: `🧍 5  ·  2:13  ·  🧟 3` (humans / time / zombies), with a small line `Round 3/8`.
- Center-screen banner (2.5s): `MOTHER ZOMBIE HAS APPEARED`, `[name] HAS BEEN INFECTED` (small text, in the top corner, like the killfeed), `YOU HAVE BEEN INFECTED!` (large, green, only for that player), `[name] IS THE LAST HUMAN – HERO!`, `HUMANS WIN` / `ZOMBIES WIN`.
- PREP phase: large countdown `Zombies appear in 0:12`, the cart lit up everywhere.
- Killfeed: `Teo 🧟→ Mit` for infections, guns as before for a human downing a zombie.
- Scoreboard: a points column, an infections column, a zombie-kills column, and a current role column (human/zombie).

---

## Task I.5 – Bots in Infection (offline)

Bots (task 15) can play Infection so you can practice alone:
- **Bot as human**: a "hold position" behavior: pick the nearest defensive position (tower top, wall ledge, a corner with a wall behind), stand there shooting the nearest zombie; if a zombie gets too close (< 4m), back off toward teammates. No flanking, no closing in.
- **Bot as zombie**: uses the zombie behavior from file 17 (task T.4: path to the nearest human, using E-leap edges and crawl-through-hole edges, claw when close). A zombie bot uses sniff when it has not seen a human for 10s.
- The offline buttons (B.7) work in Infection; "team" is ignored, and bots take part like normal players.

Acceptance:
- [ ] Offline 1 player + 5 bots: play a full Infection round, and the bots turn into zombies and hunt.

---

## Notes for the user

- Finishing part ZF gives you 70% of Defense (file 17) already.
- To add more zombie models for variety: look for zombie models, rigged or not (they get re-rigged through Mixamo anyway). They only need to be humanoid with two arms and two legs, and have textures. Each new model costs only about 5 minutes (run the script + upload to Mixamo + build), and animations are shared.
