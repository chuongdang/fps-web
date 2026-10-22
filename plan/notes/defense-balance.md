# Defense – balance data (T.9)

Tool: `BALANCE=1 npx vitest run server/src/defenseBalance.test.ts` (a HARD bot plays the role of a player holding the base, difficulty `normal`, simulated faster than real time).

| Run | Configuration | Result | Notes |
|---|---|---|---|
| 1 | 1 hard bot | lost at wave 1 after 27s | |
| 1 | 4 hard bots | lost at wave 2 after 113s (wave 1 cleared after 70s) | final money 1700–2300/player |

**Balance cannot be concluded yet.** The bot is not representative of a player: it stands in the middle of the base and gunfights as if against players, does not defend at ledges/towers, does not back up while shooting, and does not throw grenades at crowds. The plan's goal (1 decent player holds until wave 7–8; 4 players clear 10 waves if they coordinate) needs **playtesting with real people**, recording the wave lost, the time per wave, and the money in this table.

Tuning knobs (no code changes needed): `shared/src/zombieTypes.json` (hp, runSpeed, clawDamage, attackMs, reward), `shared/src/waves.json` (counts, spawn pacing, difficulty/player-count multipliers, `maxAlive`), `shared/src/defense.ts → DEFENSE` (end-of-wave reward, downed/rescue time, 250ms claw telegraph), `BOSS`.
