// Dynamic team rules: a list of rules run after each event (currently only "a player was downed/killed"). A new rule = write a function and add it to the array.
import { otherTeam, type TeamId } from '@fps/shared'
import type { Player, Room } from './room'

export type TeamRule = (room: Room) => void

/** The top-scoring player (most kills, fewest deaths, lowest id) of team `team` */
export function topScorer(room: Room, team: TeamId): Player | null {
  let best: Player | null = null
  for (const p of room.players.values()) {
    if (p.team !== team) continue
    if (!best || p.kills > best.kills || (p.kills === best.kills && (p.deaths < best.deaths || (p.deaths === best.deaths && p.id < best.id)))) best = p
  }
  return best
}

/** A team has more than 1 player over the other (a gap up to maxTeamDiff is allowed when choosing a team) -> move the top scorer to the smaller team */
export const rebalanceTopScorer: TeamRule = room => {
  if (room.offline) return   // offline: which side a bot is on is the player's choice, no auto-balancing
  const a = room.teamCount('A'), b = room.teamCount('B')
  if (Math.abs(a - b) <= 1) return
  const big: TeamId = a > b ? 'A' : 'B'
  const p = topScorer(room, big)
  if (!p) return
  room.setTeam(p, otherTeam(big))
  room.respawn(p)   // back to the new team's base with the new team's default loadout; money kept
}

export const RULES_ON_KILL: TeamRule[] = [rebalanceTopScorer]

export function runKillRules(room: Room): void {
  for (const rule of RULES_ON_KILL) rule(room)
}
