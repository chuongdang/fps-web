# Phase 5 – "Cops vs Terrorists" Team Deathmatch rules

Goal: a complete match with a beginning and an end.

## Config (`shared/src/teams.ts`, `shared/src/constants.ts`)

```ts
export const TEAMS = {
  A: { name: 'Cops',    color: 0x2f6fd6, uiColor: '#2f6fd6' },
  B: { name: 'Terrorists', color: 0x2b2b2b, uiColor: '#e0a030' },
} as const;
export type TeamId = 'A' | 'B';

export const MATCH = {
  maxPerTeam: 5,
  minPlayersToStart: 2,
  countdownMs: 5000,
  durationMs: 10 * 60 * 1000,
  killLimit: 50,
  endScreenMs: 10000,
  friendlyFire: false,
};
```

## Added messages

```ts
  | { t: 111; phase: MatchPhase; phaseEndsAt: number; scoreA: number; scoreB: number; sideSwapped: boolean } // MatchState (sent on change, and every 1s)
  | { t: 112; id: number; team: TeamId }                                    // TeamAssigned
  | { t: 113; rows: { id: number; name: string; team: TeamId; kills: number; deaths: number; ping: number }[] } // Scoreboard (every 1s)

// C2S
  | { t: 4; team: TeamId | 'auto' }                                          // ChooseTeam
```

`NetPlayer` adds `team`.

---

## Task 5.1 – Teams + team assignment

Do:
- On joining a room: the client chooses Cops / Terrorists / Auto. The server refuses if that team already has ≥ 1 more player than the other (and returns the team assigned instead).
- Other players' characters are tinted in their team color. Teammates have their name shown overhead (in the team color); enemies **do not** show names.
- Server phase 4: ignore teammates' hitboxes (bullets **pass through** teammates, not blocked).
- Spawn and respawn at the team's base (accounting for side swapping, task 5.4).

Acceptance:
- [ ] 3 players: it is not possible to put all 3 in the same team when the other team has 0.
- [ ] Shooting a teammate: no hitmarker, no health loss; the bullet passes through and hits the enemy behind.
- [ ] Respawn is always at your own team's base.

---

## Task 5.2 – Match state machine

```
WAITING ──(minPlayersToStart reached)──► COUNTDOWN ──(5s)──► PLAYING
   ▲                                    │                   │
   │                       (not enough players)   (time up / killLimit reached)
   └────────────────────────────────────┘                   ▼
                                    COUNTDOWN ◄──(10s)── ENDED
```

- WAITING: free play, no scoring, instant respawn.
- COUNTDOWN: everyone stands still at spawn (the server ignores movement input), and the HUD shows a large countdown in the center of the screen.
- PLAYING: scoring. Each kill adds 1 to the shooter's team. The first version has **no fall damage**.
- ENDED: shows "COPS WIN" / "TERRORISTS WIN" / "DRAW", the scoreboard opens automatically, and shooting is disabled.
- When ENDED finishes → reset score, kills/deaths, health, ammo, **swap sides**, go to COUNTDOWN.

Acceptance:
- [ ] Temporarily set `durationMs = 60000`, `killLimit = 5` to test: both end conditions work.
- [ ] During COUNTDOWN you cannot move, but you can still turn the mouse.
- [ ] Only 1 player left in the room mid-match: go back to WAITING.

---

## Task 5.3 – Scoreboard + team score HUD

Do:
- Top-center HUD: `Cops 12 — 9 Terrorists` + the match countdown clock (computed from `phaseEndsAt` and `serverNow()`).
- Hold Tab: a 2-column board by team, sorted by kills descending, with columns: name, K, D, ping. Your own row is highlighted.
- Ping comes from the server (the server measures RTT with its own ping, or the client reports its RTT in the Ping message).

Acceptance:
- [ ] The scoreboard updates within 1 second after each kill.
- [ ] The match clock differs by < 1 second across 3 tabs.

---

## Task 5.4 – Side swap + players joining mid-match

Do:
- `sideSwapped = true`: team A spawns at base B and vice versa. Each new match flips this flag.
- A player joining mid-match during PLAYING: automatically joins the team with fewer players (still allowed to choose if balanced), spawns immediately with invulnerability.
- A player leaving mid-match: the team score stays unchanged.

Acceptance (end-of-phase test = the definition of "done" for the first version):
- [ ] 4–6 players play 2 consecutive matches: in match 2 sides have swapped, scores reset, no errors.
- [ ] A player joining mid-match is assigned to a team correctly and plays normally.
