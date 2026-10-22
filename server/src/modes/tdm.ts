// Team Deathmatch: continuous respawns, play until the kill limit or the time runs out. Moved over unchanged from match.ts (task 06).
// WAITING → COUNTDOWN (enough players) → PLAYING (countdown over) → ENDED (time up / killLimit reached) → COUNTDOWN (swap sides)
import { ECONOMY_TDM, MatchPhase, MsgType, RESPAWN_DELAY_MS, SPAWN_INVULN_MS, addMoney, killReward, type MatchStateMsg, type RoomStatus } from '@fps/shared'
import type { Player, Room } from '../room'
import { broadcastScoreboard, setPhase } from '../match'
import { runKillRules } from '../teamRules'
import type { MatchMode } from './index'

// Start a new match: score/kills/deaths reset to 0, everyone back at base (one spawn point each), health/ammo full, no invulnerability
function resetForCountdown(room: Room): void {
  room.clearDrops()
  room.scoreA = 0
  room.scoreB = 0
  const used = { A: 0, B: 0 }
  for (const p of room.players.values()) {
    p.kills = 0
    p.deaths = 0
    const spawns = room.baseSpawns(p.team)
    const sp = spawns[used[p.team]++ % spawns.length]
    room.resetEconomy(p)
    room.respawn(p, sp)
    p.invulnUntil = 0
  }
}

export class TdmMode implements MatchMode {
  readonly mode = 'tdm' as const

  economy() { return ECONOMY_TDM }

  tick(room: Room, now: number): void {
    const r = room.rules
    const enough = room.players.size >= r.minPlayersToStart
    switch (room.phase) {
      case MatchPhase.Waiting:
        if (enough) { resetForCountdown(room); setPhase(room, MatchPhase.Countdown, now + r.countdownMs) }
        break
      case MatchPhase.Countdown:
        if (!enough) { setPhase(room, MatchPhase.Waiting, 0) }
        else if (now >= room.phaseEndsAt) setPhase(room, MatchPhase.Playing, now + r.durationMs)
        break
      case MatchPhase.Playing:
        if (!enough) { room.scoreA = room.scoreB = 0; setPhase(room, MatchPhase.Waiting, 0) }
        else if (room.scoreA >= r.killLimit || room.scoreB >= r.killLimit || now >= room.phaseEndsAt) {
          setPhase(room, MatchPhase.Ended, now + r.endScreenMs)
          broadcastScoreboard(room)
        }
        break
      case MatchPhase.Ended:
        if (now >= room.phaseEndsAt) {
          if (!enough) { room.scoreA = room.scoreB = 0; setPhase(room, MatchPhase.Waiting, 0); break }
          room.sideSwapped = !room.sideSwapped
          resetForCountdown(room)
          setPhase(room, MatchPhase.Countdown, now + r.countdownMs)
        }
        break
    }
  }

  onPlayerJoin(room: Room, p: Player): void {
    // Joining mid-match: invulnerable as if just respawned (5.4)
    if (room.phase !== MatchPhase.Waiting) p.invulnUntil = room.serverNow + SPAWN_INVULN_MS
  }

  onPlayerLeave(): void { /* the tick handles a shortage of players itself */ }

  onKill(room: Room, killer: Player | null, victim: Player): number {
    if (room.phase !== MatchPhase.Playing) return 0
    victim.deaths++
    if (!killer || killer.team === victim.team) return 0
    killer.kills++
    if (killer.team === 'A') room.scoreA++; else room.scoreB++
    const reward = killReward(victim.killStreak, ECONOMY_TDM)
    killer.money = addMoney(killer.money, reward, ECONOMY_TDM)
    killer.killStreak++
    killer.transport.send({ t: MsgType.MoneyEvent, delta: reward, reason: victim.killStreak >= ECONOMY_TDM.bountyStreak ? 'bounty' : 'kill' })
    return reward
  }

  afterDeaths(room: Room): void { runKillRules(room) }

  respawnDelayMs(room: Room): number { return room.phase === MatchPhase.Waiting ? 0 : RESPAWN_DELAY_MS }

  canBuy(room: Room): boolean { return room.phase !== MatchPhase.Ended }

  canSwitchTeam(): boolean { return true }

  roomStatus(room: Room): RoomStatus {
    if (room.phase === MatchPhase.Waiting) return { code: 'waiting' }
    if (room.phase === MatchPhase.Playing) return { code: 'timeLeft', seconds: Math.max(0, Math.ceil((room.phaseEndsAt - room.serverNow) / 1000)), scoreA: room.scoreA, scoreB: room.scoreB }
    return { code: room.phase === MatchPhase.Ended ? 'ended' : 'preparing' }
  }

  stateMessage(room: Room): MatchStateMsg {
    return {
      t: MsgType.MatchState, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
      scoreA: room.scoreA, scoreB: room.scoreB, sideSwapped: room.sideSwapped,
      mode: 'tdm', round: 0, maxRounds: 0, aliveA: 0, aliveB: 0, buyEndsAt: null,
    }
  }
}
