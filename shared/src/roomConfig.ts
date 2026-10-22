// Room settings: mode + parameters. The server always clamps to SETTINGS_LIMITS and never trusts the client.
export type GameMode = 'elimination' | 'tdm' | 'infection' | 'defense'
export const GAME_MODES: readonly GameMode[] = ['elimination', 'tdm', 'infection', 'defense']
export function isGameMode(v: unknown): v is GameMode { return typeof v === 'string' && (GAME_MODES as readonly string[]).includes(v) }
/** Zombie modes (plan 16/17): everyone is on the human side (team A), zombies are side B; night + flashlight; infinite reserve ammo */
export function isZombieMode(m: GameMode): boolean { return m === 'infection' || m === 'defense' }

export const MODE_LABEL: Record<GameMode, string> = {
  elimination: 'Elimination',
  tdm: 'Team Deathmatch',
  infection: 'Infection',
  defense: 'Defense',
}
export const MODE_DESC: Record<GameMode, string> = {
  elimination: 'One life per round. First to win 10 rounds.',
  tdm: 'Continuous respawn. Play to 50 kills or until time runs out.',
  infection: 'The mother zombie infects the whole room. Survive until time runs out to win.',
  defense: 'The whole team holds the fort against 10 waves of zombies, the last wave has a boss.',
}

export interface EliminationSettings {
  mode: 'elimination'
  roundsToWin: number     // 10 → at most 19 rounds
  roundTimeSec: number    // 105 (1:45)
  freezeSec: number       // 5 – standing still at round start
  buyTimeSec: number      // 20 – counted from the start of freeze
  roundEndSec: number     // 5 – show round result
  halftimeSec: number     // 10 – half-time break, sides swap
  matchEndSec: number     // 15 – match end screen
}

export interface TdmSettings {
  mode: 'tdm'
  killLimit: number       // 50
  timeLimitMin: number    // 10
}

export type Lighting = 'day' | 'night'
export type DefenseDifficulty = 'easy' | 'normal' | 'hard'

/** Infection (plan 16, part I) */
export interface InfectionSettings {
  mode: 'infection'
  rounds: number          // 8
  prepSec: number         // 20 – everyone is human, find a spot, buy weapons
  roundTimeSec: number    // 180
  roundEndSec: number     // 6
  matchEndSec: number     // 15
  lighting: Lighting      // 'night'
}

/** Defense (plan 17) */
export interface DefenseSettings {
  mode: 'defense'
  difficulty: DefenseDifficulty   // 'normal'
  waves: number                   // 10
  intermissionSec: number         // 25
  prepSec: number                 // 30
  endSec: number                  // 20 – win/lose screen before returning to WARMUP
  lighting: Lighting              // 'night'
}

export interface RoomConfig {
  name: string            // room name, 1–32 characters
  map: string
  maxPlayers: number      // 2–10, even
  settings: EliminationSettings | TdmSettings | InfectionSettings | DefenseSettings
}

export const DEFAULT_SETTINGS = {
  elimination: { mode: 'elimination', roundsToWin: 10, roundTimeSec: 105, freezeSec: 5, buyTimeSec: 20, roundEndSec: 5, halftimeSec: 10, matchEndSec: 15 },
  tdm: { mode: 'tdm', killLimit: 50, timeLimitMin: 10 },
  infection: { mode: 'infection', rounds: 8, prepSec: 20, roundTimeSec: 180, roundEndSec: 6, matchEndSec: 15, lighting: 'night' },
  defense: { mode: 'defense', difficulty: 'normal', waves: 10, intermissionSec: 25, prepSec: 30, endSec: 20, lighting: 'night' },
} as const satisfies { elimination: EliminationSettings; tdm: TdmSettings; infection: InfectionSettings; defense: DefenseSettings }

export const SETTINGS_LIMITS = {
  roundsToWin: [3, 16], roundTimeSec: [60, 300], killLimit: [10, 200], timeLimitMin: [3, 30],
  infectionRounds: [1, 20], infectionRoundTimeSec: [60, 300], waves: [1, 10], intermissionSec: [10, 60],
} as const

export const MAX_PLAYERS_LIMITS = [2, 10] as const
export const DEFAULT_MAX_PLAYERS = 10

/** Part the client sends when creating a room (untrusted) */
export interface RoomOptions {
  mode?: GameMode
  maxPlayers?: number
  settings?: Partial<Record<'roundsToWin' | 'roundTimeSec' | 'killLimit' | 'timeLimitMin' | 'rounds' | 'waves' | 'intermissionSec', number>> & { lighting?: string; difficulty?: string }
}

function clampInt(v: unknown, [lo, hi]: readonly [number, number], def: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : def
  return Math.min(hi, Math.max(lo, n))
}

/** Max players: clamp to 2–10 then round down to an even number (equal teams) */
export function clampMaxPlayers(v: unknown): number {
  const n = clampInt(v, MAX_PLAYERS_LIMITS, DEFAULT_MAX_PLAYERS)
  return n - (n % 2)
}

export function sanitizeRoomConfig(name: string, map: string, raw: unknown): RoomConfig {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as RoomOptions
  const mode: GameMode = isGameMode(o.mode) ? o.mode : 'tdm'
  const s = (typeof o.settings === 'object' && o.settings !== null ? o.settings : {}) as NonNullable<RoomOptions['settings']>
  const maxPlayers = clampMaxPlayers(o.maxPlayers)
  if (mode === 'elimination') {
    const d = DEFAULT_SETTINGS.elimination
    return { name, map, maxPlayers, settings: {
      ...d,
      roundsToWin: clampInt(s.roundsToWin, SETTINGS_LIMITS.roundsToWin, d.roundsToWin),
      roundTimeSec: clampInt(s.roundTimeSec, SETTINGS_LIMITS.roundTimeSec, d.roundTimeSec),
    } }
  }
  const lighting: Lighting = s.lighting === 'day' ? 'day' : s.lighting === 'night' ? 'night' : DEFAULT_SETTINGS.infection.lighting
  if (mode === 'infection') {
    const d = DEFAULT_SETTINGS.infection
    return { name, map, maxPlayers, settings: {
      ...d, lighting,
      rounds: clampInt(s.rounds, SETTINGS_LIMITS.infectionRounds, d.rounds),
      roundTimeSec: clampInt(s.roundTimeSec, SETTINGS_LIMITS.infectionRoundTimeSec, d.roundTimeSec),
    } }
  }
  if (mode === 'defense') {
    const d = DEFAULT_SETTINGS.defense
    const difficulty: DefenseDifficulty = s.difficulty === 'easy' || s.difficulty === 'hard' ? s.difficulty : 'normal'
    return { name, map, maxPlayers, settings: {
      ...d, lighting, difficulty,
      waves: clampInt(s.waves, SETTINGS_LIMITS.waves, d.waves),
      intermissionSec: clampInt(s.intermissionSec, SETTINGS_LIMITS.intermissionSec, d.intermissionSec),
    } }
  }
  const d = DEFAULT_SETTINGS.tdm
  return { name, map, maxPlayers, settings: {
    ...d,
    killLimit: clampInt(s.killLimit, SETTINGS_LIMITS.killLimit, d.killLimit),
    timeLimitMin: clampInt(s.timeLimitMin, SETTINGS_LIMITS.timeLimitMin, d.timeLimitMin),
  } }
}
