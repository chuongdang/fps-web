import { Btn } from './movement'

export const TEAMS = {
  A: { name: 'Cops',  color: 0x2f6fd6, uiColor: '#2f6fd6' },
  B: { name: 'Terrorists', color: 0x2b2b2b, uiColor: '#e0a030' },
} as const
export type TeamId = 'A' | 'B'

export function otherTeam(t: TeamId): TeamId { return t === 'A' ? 'B' : 'A' }

export interface MatchRules {
  maxPerTeam: number
  maxTeamDiff: number   // max headcount difference between the 2 teams when choosing/switching team
  minPlayersToStart: number
  countdownMs: number
  durationMs: number
  killLimit: number
  endScreenMs: number
  friendlyFire: boolean
}

export const MATCH: MatchRules = {
  maxPerTeam: 5,
  maxTeamDiff: 2,
  minPlayersToStart: 2,
  countdownMs: 5000,
  durationMs: 10 * 60 * 1000,
  killLimit: 50,
  endScreenMs: 10000,
  friendlyFire: false,
}

// Team Deathmatch uses 0–3. Elimination: Waiting = warmup (WARMUP), Playing = round in progress (LIVE), Ended = match over (MATCH_END),
// plus Freeze (standing still at round start), RoundEnd (show round result), Halftime (half-time break, sides swap)
export const MatchPhase = {
  Waiting: 0,
  Countdown: 1,
  Playing: 2,
  Ended: 3,
  Freeze: 4,
  RoundEnd: 5,
  Halftime: 6,
  Prep: 7,   // Infection: preparation (everyone is human, free to move/shoot/buy)
} as const
export type MatchPhase = (typeof MatchPhase)[keyof typeof MatchPhase]

const ALL_BTNS = Object.values(Btn).reduce((a, b) => a | b, 0)

/**
 * Buttons allowed by match phase + alive state. Server and client share this so prediction matches:
 * dead, COUNTDOWN, FREEZE, HALFTIME → no buttons (mouse look still works); ENDED → can move but not fire/reload.
 */
export function phaseButtonMask(phase: MatchPhase, alive: boolean): number {
  if (!alive || phase === MatchPhase.Countdown || phase === MatchPhase.Freeze || phase === MatchPhase.Halftime) return 0
  if (phase === MatchPhase.Ended) return ALL_BTNS & ~(Btn.Fire | Btn.Reload)
  return ALL_BTNS
}

// Winning team at match end; null = draw
export function winnerOf(scoreA: number, scoreB: number): TeamId | null {
  return scoreA === scoreB ? null : scoreA > scoreB ? 'A' : 'B'
}
