// Game modes (task 13). Everything that differs between modes lives in the mode class; the rest of the server only calls through room.mode.
import type { EconomyConfig, GameMode, MatchStateMsg, RoomConfig, RoomStatus, ScoreboardRow, TeamId } from '@fps/shared'
import type { Player, Room } from '../room'
import { TdmMode } from './tdm'
import { EliminationMode } from './elimination'
import { InfectionMode } from './infection'
import { DefenseMode } from './defense'

export interface MatchMode {
  readonly mode: GameMode
  economy(): EconomyConfig
  /** Called every tick after deaths/respawns are settled: the match state machine */
  tick(room: Room, now: number): void
  /** `p` is already in room.players and has received Welcome/team */
  onPlayerJoin(room: Room, p: Player): void
  /** After `p` has been removed from room.players */
  onPlayerLeave(room: Room, p: Player): void
  /** `victim` just died (alive=false, killStreak untouched). Returns the reward money added to `killer` (0 if none) */
  onKill(room: Room, killer: Player | null, victim: Player): number
  /** Runs once after the tick's deaths are settled (dynamic team rules, etc.) */
  afterDeaths(room: Room): void
  /** ms to wait before respawning after death; null = no respawn until the mode respawns the player itself */
  respawnDelayMs(room: Room, p?: Player): number | null
  canBuy(room: Room, p: Player, nowMs: number): boolean   // besides the alive + buy-zone checks
  canSwitchTeam(room: Room, p: Player): boolean
  roomStatus(room: Room): RoomStatus   // for the lobby room list
  stateMessage(room: Room): MatchStateMsg
  // ── Optional hooks for the zombie modes (plan 16/17)
  /** Team everyone joins on connect (zombie modes: the human side 'A'); if set, team balancing is skipped */
  joinTeam?(room: Room): TeamId
  /** Buy anywhere (skips the buy-zone check) */
  buyAnywhere?(room: Room, p: Player): boolean
  /** `p` just ran out of health (hp <= 0). Returns true = the mode handled it (not counted as a death) */
  onLethal?(room: Room, p: Player): boolean
  /** Mode-specific respawn point; null/missing = default rule */
  pickSpawn?(room: Room, p: Player): { pos: [number, number, number]; yaw: number } | null
  /** After each cmd of `p` has run (pressed keys): mode-specific abilities (Q sniff, etc.) */
  onCmd?(room: Room, p: Player, buttons: number): void
  /** After a player/zombie takes `applied` damage from `shooter` (wave statistics) */
  onDamage?(room: Room, shooter: Player, target: Player, applied: number): void
  /** Add the mode's own columns to a scoreboard row */
  scoreboardRow?(room: Room, p: Player, row: ScoreboardRow): void
  /** Mode-specific debug command (M.8); undefined if unsupported */
  devEndRound?(room: Room, winner: 'A' | 'B' | 'draw'): boolean
  devSetRound?(room: Room, round: number): boolean
  /** /zombie, /human (plan 16): switch a player's role for testing */
  devSetRole?(room: Room, p: Player, role: 'zombie' | 'human'): boolean
  /** /wave n, /clearwave (Defense) */
  devSetWave?(room: Room, wave: number): boolean
  devClearWave?(room: Room): boolean
}

export function createMode(config: RoomConfig): MatchMode {
  const s = config.settings
  switch (s.mode) {
    case 'elimination': return new EliminationMode(s)
    case 'infection': return new InfectionMode(s)
    case 'defense': return new DefenseMode(s)
    default: return new TdmMode()
  }
}
