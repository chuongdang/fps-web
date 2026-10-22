# 13 – Two game modes + room creation

| Display name | Code id | Rules summary |
|---|---|---|
| **Elimination** | `elimination` | Played in rounds, one life per round. A team that is wiped out loses the round. The first team to win 10 rounds wins the match. |
| **Team Deathmatch** | `tdm` | Continuous respawn, shoot until the kill limit or the time runs out (this is exactly the current mode from task 06). |

Order: M.1 → M.2 → M.3 → M.4 → M.5 → M.6 → M.7 → M.8. Tasks marked ⚠️ should use a stronger model.

Principle: **Team Deathmatch must run exactly as it does now** after the code is split out. Every difference between the 2 modes lives in the mode class + config, with no `if (mode === ...)` scattered everywhere.

---

## Room settings (`shared/src/roomConfig.ts`)

```ts
export type GameMode = 'elimination' | 'tdm';

export const MODE_LABEL: Record<GameMode, string> = {
  elimination: 'Elimination',
  tdm: 'Team Deathmatch',
};

export interface EliminationSettings {
  mode: 'elimination';
  roundsToWin: number;     // default 10 → at most 19 rounds
  roundTimeSec: number;    // 105 (1:45)
  freezeSec: number;       // 5 – standing still at the start of the round
  buyTimeSec: number;      // 20 – counted from the start of freeze
  roundEndSec: number;     // 5 – show the round result
  halftimeSec: number;     // 10 – break at halftime, swap sides
}

export interface TdmSettings {
  mode: 'tdm';
  killLimit: number;       // 50
  timeLimitMin: number;    // 10
}

export interface RoomConfig {
  name: string;            // room name, 1–32 characters
  map: string;             // 'hai-thanh'
  maxPlayers: number;      // 2–10, even
  settings: EliminationSettings | TdmSettings;
}

export const DEFAULT_SETTINGS = {
  elimination: { mode: 'elimination', roundsToWin: 10, roundTimeSec: 105, freezeSec: 5, buyTimeSec: 20, roundEndSec: 5, halftimeSec: 10 },
  tdm: { mode: 'tdm', killLimit: 50, timeLimitMin: 10 },
} as const;

export const SETTINGS_LIMITS = {
  roundsToWin: [3, 16], roundTimeSec: [60, 300], killLimit: [10, 200], timeLimitMin: [3, 30],
};
```

The server **always** clamps values to `SETTINGS_LIMITS`, never trusting the client.

## Economy per mode (`shared/src/economy.ts`)

Split the `ECONOMY` of task 09 into 2 sets; the functions `quoteBuy`, `applyBuy`… take an additional config parameter:

```ts
export const ECONOMY_TDM = { ...ECONOMY };  // unchanged from task 09

export const ECONOMY_ELIM = {
  startMoney: 800,
  maxMoney: 16000,
  killReward: 300,
  bountyStreak: 3,
  bountyReward: 600,
  sellRatio: 0.8,
  defaultResaleValue: 0,
  keepLoadoutIfSurvived: true,   // survive the round: keep guns, grenades
  roundWin: 3000,
  roundLossBase: 1500,
  roundLossStep: 400,            // consecutive losses: 1500, 1900, 2300, 2700, 3000
  roundLossMax: 3000,
  roundDraw: 1500,               // drawn round: everyone +1500, loss streak unchanged
  resetAtHalftime: true,         // swap sides: money back to startMoney, guns back to default
};
```

- Kill streak (`killStreak`) in Elimination: **kept across rounds** if you survive, reset to 0 on death (the bounty rule keeps its meaning).
- Elimination's `startMoney` is $800 (the first round only affords a small upgrade, the typical "pistol round"), changeable.

---

## Task M.1 – Split out the mode code (server) ⚠️

Create `server/src/modes/`:

```ts
export interface MatchMode {
  readonly mode: GameMode;
  start(room: Room): void;
  tick(room: Room, nowMs: number): void;
  onPlayerJoin(room: Room, p: Player): void;     // assign team, decide to spawn immediately or spectate
  onPlayerLeave(room: Room, p: Player): void;
  onKill(room: Room, killer: Player | null, victim: Player, weapon: string): void;
  canRespawn(room: Room, p: Player): boolean;
  canBuy(room: Room, p: Player, nowMs: number): boolean; // in addition to inBuyZone
  canMove(room: Room, p: Player): boolean;        // false during freeze
  canDealDamage(room: Room): boolean;
  economy(): typeof ECONOMY_TDM;
  stateMessage(room: Room): MatchStateMsg;
}
```

- `TdmMode`: move the **entire** existing logic in `match.ts` (task 06) here, reading `killLimit`, `timeLimitMin` from settings.
- `EliminationMode`: task M.3.
- `Room` holds `config: RoomConfig` and `mode: MatchMode`, and every old place that called `match.*` now calls through `room.mode`.

Acceptance:
- [ ] Create a Team Deathmatch room: play one match with 2 tabs, all rules as before (respawn, money, bounty, side swap, scoreboard).
- [ ] The old tests pass, without changing test logic (only fix imports if needed).
- [ ] `grep` finds no `mode === 'tdm'` / `mode === 'elimination'` outside the `modes/` directory and the UI.

---

## Task M.2 – Create a room, room list

### Messages

```ts
// C2S
  | { t: 6; config: RoomConfig }                         // CreateRoom
  | { t: 7 }                                             // ListRooms
  | { t: 1; name: string; room: string }                 // Join (unchanged, room = room code)

// S2C
  | { t: 119; code: string }                             // RoomCreated
  | { t: 120; rooms: RoomSummary[] }                     // RoomList
interface RoomSummary {
  code: string; name: string; map: string; mode: GameMode;
  players: number; maxPlayers: number;
  status: RoomStatus;        // { code: "waiting" } | { code: "round", round: 5, maxRounds: 19, scoreA: 3, scoreB: 2 } | { code: "timeLeft", seconds: 372, ... } — the client turns it into text
}
```

- Room code: 5 easy-to-read uppercase characters (excluding `0`, `O`, `1`, `I`). An empty room is deleted after 60s (as before).
- The URL `?room=ABCDE` goes straight into the room (to send a link to friends through ngrok).

### Screens (client)

- **Lobby**: enter the player name (remembered in localStorage), the room list (name, mode, map, player count, status), auto-refreshing every 3s, a **Join** button, a **Create room** button, a room code input field.
- **Create room**:
  - Room name, map (dropdown, currently only "Two Walls"), maximum players (2–10).
  - Choose the mode with 2 large cards: **Elimination** (1-line description: "One life per round. First to win 10 rounds.") and **Team Deathmatch** ("Continuous respawn. Shoot to 50 kills or until time runs out.").
  - The settings section changes by mode: Elimination (rounds to win, time per round); Team Deathmatch (kill limit, match time). Has a "Default" button.
  - After creating, go straight into the room, showing the room code + a copy-link button.
- In game: a small label in the top-left corner `Elimination · Two Walls · ABCDE`.

Acceptance:
- [ ] Tab A creates an Elimination room, tab B sees the room in the list and can join.
- [ ] Open the link `?room=ABCDE` in tab C: goes straight into that room.
- [ ] Temporarily modify the client to send `roundsToWin: 999`: the server clamps it to 16.

---

## Task M.3 – Elimination mode (server) ⚠️

### Phases

```
WARMUP ──(each team ≥ 1 player)──► FREEZE ──(freezeSec)──► LIVE
   ▲                                  ▲                      │
   │                                  │      (one team all dead / roundTimeSec runs out)
   │                                  │                      ▼
   │                                  └──(roundEndSec)── ROUND_END
   │                                                         │
   │                (just finished round roundsToWin − 1) ──► HALFTIME ──(halftimeSec)──► FREEZE
   │                                                         │
   └──(a team has nobody connected)        (a team reaches roundsToWin / maxRounds exhausted)
                                                             ▼
                                                        MATCH_END ──(15s)──► WARMUP (new match)
```

- `maxRounds = 2 × roundsToWin − 1`.
- **WARMUP**: free play, instant respawn, no scoring, free buying (like Team Deathmatch), money unchanged.
- **FREEZE** (start of each round):
  1. Remove all grenades in flight, remove scorch marks/corpses (send `RoundReset`).
  2. Everyone connected (including spectators waiting to join) respawns at their team's base, **each person at a different spawn point** (no duplicate picks), health 100, ammo full.
  3. Loadout: whoever was **still alive at the end of the previous round** keeps their loadout (`keepLoadoutIfSurvived`), whoever died goes back to the team default.
  4. Cannot move (`canMove = false`), can still turn the mouse, can buy.
- **Buy time**: `canBuy` is true while `now < freezeStart + buyTimeSec` (and you must still be in the buy zone). When buy time ends: the cart turns off, the menu closes itself.
- **LIVE**: `canRespawn = false`. A dead player switches to spectating (M.5).
- **Round end** (checked every tick during LIVE):
  1. A team has nobody alive → the other team wins, reason `elimination`.
  2. Both teams all die on the same tick (grenade) → **draw**, reason `draw`.
  3. Time runs out → the team with **more players alive** wins (`time_alive`); equal -> the team with the higher **total health** wins (`time_hp`); still equal -> **draw** (`draw`).
- **ROUND_END**: players can still shoot each other (CS style) but it does not change the round result. End-of-round money is awarded (M.4). Only players who are alive at the end of the ROUND_END phase count as "survived" for keeping guns.
- **HALFTIME**: after round `roundsToWin − 1` (default round 9). Show a banner, swap sides (`sideSwapped = !sideSwapped`), and if `resetAtHalftime` then money goes back to `startMoney`, loadout to default, loss streak to 0.
- **MATCH_END**: the first team to reach `roundsToWin` wins. If `maxRounds` runs out without anyone reaching it (due to drawn rounds) → the team with more round wins wins, equal -> overall draw. After 15s: reset score, money, loadout, teams stay the same, go back to FREEZE of round 1 (if there are enough players) or WARMUP.
- **Player joining mid-match**: joins the team with fewer players, **spectates** until the next round's FREEZE when they get to play, money = `startMoney` (or if in the second half: still `startMoney`).
- **Player leaving mid-round**: counts as dead (check the round-end conditions immediately). A team with nobody connected: the current round is awarded as a loss to that team, then back to WARMUP, **keeping the score**; once there are enough players again, play continues from the next round.
- Remove "invulnerability after spawn" in Elimination (everyone spawns at the same time in the base, so it is not needed).

### Messages

```ts
// S2C, MatchState (t: 111) extended:
  { t: 111; mode: GameMode; phase: string; phaseEndsAt: number;
    round: number; maxRounds: number; scoreA: number; scoreB: number;   // Elimination: rounds won; Team Deathmatch: kills
    aliveA: number; aliveB: number;                                    // Elimination only
    buyEndsAt: number | null; sideSwapped: boolean }
  | { t: 121; round: number; winner: TeamId | null; reason: 'elimination' | 'time_alive' | 'time_hp' | 'draw' }   // RoundEnd
  | { t: 122; round: number }                                                                                     // RoundReset
  | { t: 123; winner: TeamId | null; scoreA: number; scoreB: number; mvpId: number | null }                       // MatchEnd
```

Acceptance (use the M.8 debug commands to go faster):
- [ ] 2 tabs, 1v1: A kills B → banner "COPS WIN ROUND 1", 5s later both respawn at the base, score 1–0.
- [ ] Dying during LIVE: no respawn, switch to spectating.
- [ ] Time runs out in a round, 2v2 with 2 vs 1 left → the 2-player team wins. 1 vs 1, health 80 vs 40 → the 80-health team wins.
- [ ] Freeze: cannot walk, can buy; after 20s from the start of freeze you can no longer buy.
- [ ] Survive a round holding a Sniper → still holding the Sniper next round. Die -> next round back to the default M16/AK47.
- [ ] After round 9: swap-sides banner, bases swap, money back to $800.
- [ ] A team reaches 10 rounds: the end screen, 15s later a new match from 0–0.
- [ ] A player joining mid-round: spectates, gets to play next round.
- [ ] A grenade thrown at the end of a round does not explode in the next round.

---

## Task M.4 – End-of-round money (Elimination)

On entering ROUND_END:
- Winning team: each player `+roundWin`, the team's loss streak goes to 0.
- Losing team: `lossStreak++`, each player `+min(roundLossBase + (lossStreak − 1) × roundLossStep, roundLossMax)`.
- Drawn round: each player `+roundDraw`, loss streak unchanged.
- Applies to **everyone on the team**, including those already dead; not to spectators waiting to join.
- Send a `MoneyEvent` with `reason: 'round_win' | 'round_loss' | 'round_draw'`.
- Kills in Elimination use `ECONOMY_ELIM.killReward` / `bountyReward`.

Acceptance (vitest for the money-computing function, `shared`):
- [ ] Losing 1, 2, 3, 4, 5, 6 rounds in a row: 1500, 1900, 2300, 2700, 3000, 3000.
- [ ] Lose 2 rounds, win 1, lose 1: the last loss earns 1500.
- [ ] A draw in the middle of a loss streak of 2: earns 1500, and the next lost round earns 2300.
- [ ] Money never exceeds 16000.

---

## Task M.5 – Spectator mode on death (Elimination)

- Dying during LIVE → after 2 seconds (watching your own fall), the camera switches to **follow behind a living teammate** (3rd person, shoulder height, offset to the right, with wall clipping protection like the F10 camera task).
- **Left click / Space key**: switch to the next teammate. If the teammate being watched is killed → automatically switch to another person after 1.5s.
- The camera view follows the **interpolated yaw/pitch** of the person being watched (you see where they are aiming).
- HUD while spectating: a bottom-center line `Spectating: [name]` + that person's health; hide your own weapon slots, money, and cart.
- A player joining mid-round (no living team to watch, or before the first round): the camera floats in a fixed high position looking down at the whole map, slowly rotating.
- You are **not** allowed to watch enemies (to avoid leaking positions when sitting in the same room).

Acceptance:
- [ ] 3 tabs, 2v1: the first to die can watch a teammate, Space switches person.
- [ ] It is impossible to switch to watching the enemy team with any key.

---

## Task M.6 – Elimination HUD

- **Top center**:
  ```
          [●●○○○]  Cops 3  ·  1:24  ·  2 Terrorists  [●●●○○]
                         Round 6 / 19
  ```
  - Round dots: one dot per player of the team, lit = alive, dim = dead (team color).
  - Clock: the time remaining in the current phase; during FREEZE show `0:05` in yellow; under 10 seconds of LIVE it turns red.
- **Buy time**: next to the cart show `Buy: 0:14` while buy time remains; hide it when over.
- **Round end banner** (center of the screen, 3s): `COPS WIN ROUND 5` / `TERRORISTS WIN ROUND 5` / `ROUND DRAWN`, with a small line below giving the reason: `Total elimination` / `Time out · more players alive` / `Time out · more health remaining`. Along with the end-of-round money you received: `+$3000`.
- **Side swap banner**: `END OF FIRST HALF · SWAP SIDES`, also showing the score.
- **Match end screen**: the winning team, score, MVP (most kills, ties broken by fewer deaths), the scoreboard opens automatically, a countdown to the new match.
- **Audio**: round start (a short synthesized whistle), round won (2 rising notes), round lost (2 falling notes), the last 10 seconds a small "tick" every second.
- Team Deathmatch keeps the old HUD (task 5.3); it only shares the top-center frame but shows kills and match time, with no alive/dead dots and no round number.

Acceptance:
- [ ] Score, round, time, and the number of survivors on each team can be read in a single glance.
- [ ] The round end banner states the correct reason in all 3 cases.

---

## Task M.7 – Team Deathmatch: settings + draw

- Read `killLimit`, `timeLimitMin` from the room settings in place of the `MATCH` constants of task 06.
- Time runs out with equal scores → **draw**, the end screen says `DRAW`.
- Top-center HUD (shared frame with Elimination): `Cops 23 · 06:12 · 18 Terrorists`, with a small line below `Goal: 50 kills`.

Acceptance:
- [ ] Create a Team Deathmatch room with 10 kills, 3 minutes: it ends correctly when 10 kills are reached or 3 minutes run out.

---

## Task M.8 – Debug commands (enabled only when running dev)

Type into the in-game chat/console box (the `~` key opens the command box); the server only accepts them when `NODE_ENV !== 'production'`:

| Command | Effect |
|---|---|
| `/endround A` or `/endround B` / `/endround draw` | end the round immediately with that result |
| `/setround 9` | jump to round 9 (to test the side swap) |
| `/time 10` | set the time remaining in the current phase to 10 seconds |
| `/money 16000` | set your money |
| `/hp 30` | set your health |
| `/kill` | suicide (test spectator mode) |

Acceptance:
- [ ] All commands work in dev; in a production build, sending a command is ignored by the server.

---

## Notes for the user

- The Elimination economy numbers ($800 start, win $3000, loss $1500 rising, kill $300) follow the spirit of CS, tune them in `ECONOMY_ELIM`.
- 1v1 Elimination is very tense, testing with 2 tabs is enough to see it. Only with groups of 3v3 or more do you really see the value of the teammate spectator mode.
- There is no **bomb / defusal** like the original CS yet. If you want to add it, it would be a 3rd mode, done after these 2 modes are stable.
