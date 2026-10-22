import { MATCH, type MatchRules } from '@fps/shared'

/** Offline room rules (plan 15, B.7): Team Deathmatch with no kill or time limit; one player is enough to start; the player picks the team */
export function offlineRules(): MatchRules {
  return { ...MATCH, maxPerTeam: 5, maxTeamDiff: 10, minPlayersToStart: 1, countdownMs: 1500, durationMs: 1e11, killLimit: 1e9, endScreenMs: 5000, friendlyFire: false }
}

export const OFFLINE_ROOM = 'offline'
