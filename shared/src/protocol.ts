import { encode as mpEncode, decode as mpDecode } from '@msgpack/msgpack'
import { Btn, type InputCmd, type PlayerState } from './movement'
import { SNAPSHOT_MARKER, encodeSnapshotFrame, decodeSnapshotFrame } from './snapshotCodec'
import type { HitBox } from './hitbox'
import { SLOT_COUNT, type WeaponState } from './weapons'
import type { OwnedWeapon } from './economy'
import type { MatchPhase, TeamId } from './teams'
import type { CharacterSetId } from './characters'
import type { ThrowMode } from './grenade'
import type { GameMode, RoomConfig, RoomOptions } from './roomConfig'

// Message classification per plan/04-phase3-netcode-move.md (C2S 1-3, S2C 101-105)
export const MsgType = {
  // Client → Server
  Join: 1,
  Inputs: 2,
  Ping: 3,
  SetDebug: 4,
  ChooseTeam: 5,
  Buy: 6,            // plan says t:5 but 5 is ChooseTeam
  ListRooms: 7,      // request the room list + maps (before Join)
  DebugCmd: 8,       // debug command (task M.8); the server only accepts it when not running in production
  OfflineCmd: 9,     // plan 15: control an offline room (add/remove bots, switch side, infinite money); only offline rooms accept it
  DropWeapon: 10,    // G: drop the held gun (shared/weaponDrop.ts)
  PickupWeapon: 11,  // E: pick up the nearest dropped gun in reach
  RtcOffer: 12,      // WebRTC upgrade (net/rtc.ts, shared/unreliable.ts): the client's SDP offer for an unreliable DataChannel, over the WebSocket
  RtcCandidate: 13,  // ICE candidate, either direction, over the WebSocket
  // Server → Client
  Welcome: 101,
  Pong: 102,
  Snapshot: 103,
  PlayerJoined: 104,
  PlayerLeft: 105,
  HitConfirm: 106,
  Kill: 107,
  Respawn: 108,
  ShotFx: 109,
  DebugShot: 110,
  Hurt: 111,
  MatchState: 112,   // plan says 111 but 111 is already Hurt
  TeamAssigned: 113,
  Scoreboard: 114,
  BuyResult: 115,    // plan says 114 but 114 is Scoreboard
  MoneyEvent: 116,
  GrenadeSpawn: 117,   // plan 12 says 116–118 but 116 is already MoneyEvent
  GrenadeExplode: 118,
  GrenadeAnim: 119,
  RoomList: 120,       // reply to ListRooms
  JoinRejected: 121,   // Join not possible (room full / already exists / not found)
  RoundEnd: 122,       // Elimination: round over (plan 13 says 121–123 but 120/121 are taken)
  RoundReset: 123,     // Elimination: new round starts (clears grenades/corpses)
  MatchEnd: 124,       // Elimination: match over
  OfflineState: 125,   // plan 15: bot list + infinite money of the offline room
  BotDebug: 126,       // plan 15 (F11): per-bot state, 10 times/second, only when the client enables it
  NavDebug: 127,       // plan 15 (F11): navigation mesh, sent once when enabled
  Infected: 130,       // plan 16: mother zombie appears / a player got infected
  HeroChosen: 131,     // plan 16: the last human becomes the hero
  InfectionCount: 132, // plan 16: human / zombie counts (when they change)
  Sniffed: 133,        // plan 16 (I.3): sent to a player sniffed by a zombie (nearby growl + nose icon)
  DefenseState: 140,   // plan 17: phase, wave, zombies remaining
  WaveStart: 141,      // plan 17: banner at the start of a wave
  WaveClear: 142,      // plan 17: wave cleared + bonus money
  DefenseEnd: 143,     // plan 17: win/lose + stats
  Telegraph: 144,      // plan 17: boss ability warning (red ring on the ground, charge direction)
  WeaponDropSpawn: 150,   // a gun was dropped (or: a gun already lying here when you joined)
  WeaponDropRemove: 151,  // a dropped gun was picked up / expired (id -1 = every dropped gun)
  HoldSlot: 152,          // the server changed which slot you hold (after a drop / pickup): the next cmd must carry it
  RtcAnswer: 160,         // reply to RtcOffer: the SDP answer, or `error` when the server has no WebRTC (the client stays on the WebSocket)
} as const

export type MsgTypeValue = (typeof MsgType)[keyof typeof MsgType]

// Client → Server
export interface InputsMsg {
  t: typeof MsgType.Inputs
  cmds: InputCmd[]
}

export interface PingMsg {
  t: typeof MsgType.Ping
  clientTime: number
  rtt?: number   // latest RTT measured by the client (ms), used by the server for the ping column on the scoreboard
  ka?: true      // keepalive on the unreliable channel (shared/unreliable.ts): only says "this path works", never reaches the game code
}

// WebRTC upgrade signalling (over the WebSocket, never over the unreliable channel itself)
export interface RtcOfferMsg { t: typeof MsgType.RtcOffer; sdp: string }
export interface RtcCandidateMsg { t: typeof MsgType.RtcCandidate; candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }
export interface RtcAnswerMsg { t: typeof MsgType.RtcAnswer; sdp?: string; error?: string }

export interface JoinMsg {
  t: typeof MsgType.Join
  name: string
  room: string
  team?: TeamId | 'auto'   // team to join; default auto
  characterSet?: string    // character set; only takes effect when this player creates a new room (wrong/missing → default)
  create?: boolean         // true: create a new room (error if the name exists); false: only join an existing room; missing: join, create if absent
  mapId?: string           // map of the new room (missing/wrong → first map)
  options?: RoomOptions    // mode + settings of the new room (server clamps to SETTINGS_LIMITS)
  version?: string         // client version; if the server sets a version and it differs/is missing, reject ('version')
}

export type BotDifficulty = 'medium' | 'hard'
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['medium', 'hard']
export const BOT_TAG: Record<BotDifficulty, string> = { medium: 'MED', hard: 'HARD' }

// Offline room (plan 15, B.7). `ally`: bot on your own side (Shift); by default a bot is on the enemy side.
export type OfflineCmdMsg = { t: typeof MsgType.OfflineCmd } & (
  | { cmd: 'addBot'; difficulty: BotDifficulty; ally?: boolean }
  | { cmd: 'removeBot'; id: number }
  | { cmd: 'clearBots' }
  | { cmd: 'swapSide' }
  | { cmd: 'infiniteMoney'; on: boolean }
  | { cmd: 'botDebug'; on: boolean }
)

export interface OfflineBotInfo { id: number; name: string; difficulty: BotDifficulty; team: TeamId }
export interface OfflineStateMsg {
  t: typeof MsgType.OfflineState
  infiniteMoney: boolean
  bots: OfflineBotInfo[]
}

export interface BotDebugInfo {
  id: number
  state: string                          // 'Engage', 'TakeCover'...
  eye: [number, number, number]
  look: [number, number, number]         // point the bot is looking straight at (green)
  want: [number, number, number] | null  // point the bot intends to aim at (red)
  path: [number, number, number][]
}
export interface BotDebugMsg { t: typeof MsgType.BotDebug; bots: BotDebugInfo[] }
/** nodes: flat [x, y, z, coverMask, ...]; edges: flat [a, b, ...] (node indices) */
export interface NavDebugMsg { t: typeof MsgType.NavDebug; nodes: number[]; edges: number[] }

// In-game debug command (task M.8): '/endround A' ...
export interface DebugCmdMsg { t: typeof MsgType.DebugCmd; cmd: string }

// Request the list of existing rooms
export interface ListRoomsMsg { t: typeof MsgType.ListRooms; version?: string }   // version: client version (the packaged server rejects if different)

// Switch team (server applies balance rules, replies with TeamAssigned)
export interface ChooseTeamMsg {
  t: typeof MsgType.ChooseTeam
  team: TeamId | 'auto'
}

// Buy a weapon (server checks: alive, in buy zone, enough money, ≤ 5 commands/second)
export interface BuyMsg {
  t: typeof MsgType.Buy
  key: string
}

// Drop the held gun / pick up the nearest dropped gun (server checks: alive, human, mode allows it, reach, ≤ 5 commands/second)
export interface DropWeaponMsg { t: typeof MsgType.DropWeapon }
export interface PickupWeaponMsg { t: typeof MsgType.PickupWeapon }

// Toggle DebugShot (F7); outside the plan, needed so the server knows when to send
export interface SetDebugMsg {
  t: typeof MsgType.SetDebug
  shots: boolean
}

// Server → Client
export interface RoomInfo {
  id: string                 // room name
  mapId: string
  characterSet: CharacterSetId
  players: number
  maxPlayers: number
  teamA: number
  teamB: number
  mode: GameMode
  status: RoomStatus         // what the room is doing now; the client turns the code + numbers into text (no prose crosses the wire)
}
/** Room state shown on the lobby cards. `waiting`: not enough players; `preparing`/`ended`: Team Deathmatch between matches. */
export type RoomStatus =
  | { code: 'waiting' }
  | { code: 'preparing' }
  | { code: 'ended' }
  | { code: 'timeLeft'; seconds: number; scoreA: number; scoreB: number }                              // Team Deathmatch, playing
  | { code: 'round'; round: number; maxRounds: number; scoreA: number; scoreB: number }               // Elimination
  | { code: 'infectionRound'; round: number; maxRounds: number; humans: number; zombies: number }     // Infection
  | { code: 'wave'; wave: number; maxWaves: number; players: number }                                 // Defense
export interface MapInfo { id: string; name: string }
export interface RoomListMsg { t: typeof MsgType.RoomList; rooms: RoomInfo[]; maps: MapInfo[] }
export type JoinRejectReason = 'full' | 'exists' | 'missing' | 'bad' | 'version'
export interface JoinRejectedMsg { t: typeof MsgType.JoinRejected; reason: JoinRejectReason }

export interface WelcomeMsg {
  t: typeof MsgType.Welcome
  yourId: number
  tick: number
  serverTime: number
  mapId: string                  // id of the room's map (key of assets/maps/index.ts); the client builds that map
  mapName: string
  characterSet: CharacterSetId   // character set of the room
  config: RoomConfig             // mode + room settings
  players: { id: number; name: string }[]   // players already in the room when joining (to know names for the killfeed)
}

// All PlayerState fields so the client can reset its state exactly (reconcile in 3.6)
export const NetFlag = {
  Grounded:  1 << 0,
  Crouching: 1 << 1,
  Sliding:   1 << 2,   // slideTimer > 0; display only, not used to rebuild state
  Dead:      1 << 3,   // dead, waiting to respawn (no hitbox, not drawn)
  Invuln:    1 << 4,   // invulnerable after respawn (drawn blinking)
  Downed:    1 << 9,   // Defense: downed awaiting revive (lying, slow crawl)
  Flashlight: 1 << 8,  // player has the flashlight on (night): others draw the light beam
  Hero:      1 << 7,   // hero (Infection): 200 health, damage ×1.5, run ×1.1
  Zombie:    1 << 5,   // zombie role (plan 16): uses the zombie movement/claw config, draws the zombie model
  Transform: 1 << 6,   // transforming (invulnerable, cannot move)
} as const

export interface NetPlayer {
  id: number
  pos: [number, number, number]
  vel: [number, number, number]
  yaw: number
  pitch: number
  flags: number
  slideTimer: number
  slideCooldown: number
  adsT: number     // ADS level 0..1 (reconcile uses the exact value; others use it to draw the gun at the cheek)
  hp: number
  team: TeamId
  weapon: number   // held weapon (to draw the gun in other players' hands)
  killStreak: number   // current kill streak (≥ ECONOMY.bountyStreak: wanted mark overhead)
  leapCd?: number      // zombie: seconds left on the E leap cooldown (reconcile uses the exact value)
  hpMax?: number       // zombie: max health (zombie health is in the thousands, the HUD needs it to draw the health bar)
  runSpeed?: number    // zombie: run speed by type (the client builds the same movement config as the server)
  ztype?: string       // zombie: type ('mother'/'normal'/'walker'/...), to pick the look/tint
  zscale?: number      // big/small zombie (boss 2.2): model and hitbox size
  downLeft?: number    // Defense: ms left for a downed player (time ring)
  reviveP?: number     // Defense: revive progress 0..1
  sniffLeft?: number   // zombie (Infection): ms left on the active sniff ability
  sniffCd?: number     // zombie: ms left on the sniff cooldown
}

export interface SnapshotMsg {
  t: typeof MsgType.Snapshot
  tick: number
  serverTime: number
  ack: number          // lastProcessedSeq for the client receiving this packet
  players: NetPlayer[]
  wpn?: WeaponState    // WeaponState of the client receiving this packet, after cmd `ack` (the client replays unacked cmds on top)
  money?: number       // money of the client receiving this packet
  loadout?: (OwnedWeapon | null)[]   // purchased weapons in 5 slots (with the money paid → show resale price; slot 5 also carries the grenade count)
}

export interface PlayerJoinedMsg {
  t: typeof MsgType.PlayerJoined
  id: number
  name: string
}

export interface PlayerLeftMsg {
  t: typeof MsgType.PlayerLeft
  id: number
}

// Whole room: who killed whom
export interface KillMsg {
  t: typeof MsgType.Kill
  killerId: number
  victimId: number
  weapon: number
  headshot: boolean
  reward: number          // money the killer received (0 if not counted: teammate, outside PLAYING...)
  victimStreak: number    // victim's kill streak before dying (≥ 3 = wanted)
}

// Whole room: a player respawns at pos/yaw (that player's own client teleports, no smoothing)
export interface RespawnMsg {
  t: typeof MsgType.Respawn
  id: number
  pos: [number, number, number]
  yaw: number
}

// Sent privately to the victim (outside the plan): incoming bullet direction to draw a red edge + hit sound
export interface HurtMsg {
  t: typeof MsgType.Hurt
  origin: [number, number, number]   // shooter's eye
  damage: number
  fall?: true   // damage from a fall from height (no shooter; origin = own feet): the client flashes the whole screen red instead of a directional edge
}

// Sent privately to the shooter: a shot that hit a player (the hitmarker only shows when this packet is received)
export interface HitConfirmMsg {
  t: typeof MsgType.HitConfirm
  damage: number
  headshot: boolean
  targetId: number
}

// Sent to the whole room except the shooter: draw the tracer + positional gun sound. `weapon` is outside the plan, needed to choose the gun sound.
export interface ShotFxMsg {
  t: typeof MsgType.ShotFx
  shooterId: number
  weapon: number
  origin: [number, number, number]
  dir: [number, number, number]
  dist: number
  extra?: { dir: [number, number, number]; dist: number }[]   // remaining rays of a multi-ray weapon (shotgun), same origin
}

// Only sent to the shooter when debug is on: ray + everyone else's hitboxes at the rewound time
export interface DebugShotMsg {
  t: typeof MsgType.DebugShot
  origin: [number, number, number]
  dir: [number, number, number]
  boxes: HitBox[]
}

// Whole room: sent on phase change and every 1s. phaseEndsAt in serverTime (0 = no deadline)
export interface MatchStateMsg {
  t: typeof MsgType.MatchState
  phase: MatchPhase
  phaseEndsAt: number
  scoreA: number          // Elimination: rounds won; Team Deathmatch: kills
  scoreB: number
  sideSwapped: boolean
  mode: GameMode
  round: number           // Elimination: current round (1…); Team Deathmatch: 0
  maxRounds: number
  aliveA: number          // Elimination: players alive per team
  aliveB: number
  buyEndsAt: number | null   // Elimination: buy time ends (serverTime); null = no limit
}

// Elimination: round just ended. winner null = draw. Money received in MoneyEvent (round_win / round_loss / round_draw)
export type RoundEndReason = 'elimination' | 'time_alive' | 'time_hp' | 'draw' | 'infected_all' | 'time_survive'
export interface RoundEndMsg { t: typeof MsgType.RoundEnd; round: number; winner: TeamId | null; reason: RoundEndReason }
export interface RoundResetMsg { t: typeof MsgType.RoundReset; round: number }
export interface MatchEndMsg { t: typeof MsgType.MatchEnd; winner: TeamId | null; scoreA: number; scoreB: number; mvpId: number | null }

export interface TeamAssignedMsg {
  t: typeof MsgType.TeamAssigned
  id: number
  team: TeamId
}

export interface ScoreboardRow {
  id: number; name: string; team: TeamId; kills: number; deaths: number; ping: number; money?: number
  // Infection: personal points, humans infected, zombies downed, current role
  pts?: number; inf?: number; zk?: number; role?: 'human' | 'zombie'
  // Defense: damage dealt, teammate revives
  dmg?: number; rev?: number
}   // money is only present when the receiver is on the same team
export interface ScoreboardMsg {
  t: typeof MsgType.Scoreboard
  rows: ScoreboardRow[]
}

// Private to the buyer
export interface BuyResultMsg {
  t: typeof MsgType.BuyResult
  ok: boolean
  reason?: string   // out_of_zone | dead | phase | rate | not_buyable | already_owned | not_enough_money | unknown
  key: string
}

export type MoneyReason = 'kill' | 'bounty' | 'buy' | 'sell' | 'reset' | 'round_win' | 'round_loss' | 'round_draw'
// Private to the receiver: money change (to show +$500...)
export interface MoneyEventMsg {
  t: typeof MsgType.MoneyEvent
  delta: number
  reason: MoneyReason
}

// Grenade leaves the hand (whole room). The client simulates the trajectory itself (deterministic grenadePhysics) from pos/vel/spawnTick;
// throwSeq = WeaponState.throwSeq at throw time, so the owner recognises its own predicted grenade.
export interface GrenadeSpawnMsg {
  t: typeof MsgType.GrenadeSpawn
  id: number
  ownerId: number
  mode: ThrowMode
  pos: [number, number, number]
  vel: [number, number, number]
  spawnTick: number
  throwSeq: number
  kind?: string   // weapon key of the grenade ('smoke'); missing = 'm67'
}

// Explosion (source of truth: it explodes exactly here, remove the local grenade). hits = damage applied to each player
export interface GrenadeExplodeMsg {
  t: typeof MsgType.GrenadeExplode
  id: number
  pos: [number, number, number]
  hits: { id: number; damage: number }[]
  kind?: string   // 'smoke': no damage, bursts into a smoke cloud (the client draws it per SMOKE); missing = M67 explosion
}

// Other players' actions for 3rd-person drawing: pull pin / throw / cancel
export interface GrenadeAnimMsg {
  t: typeof MsgType.GrenadeAnim
  playerId: number
  phase: 'pulling' | 'throw' | 'cancel'
  mode?: ThrowMode   // pulling/throw: strong or low throw
  kind?: string      // weapon key of the held grenade ('smoke'); missing = 'm67'
}

// A gun is lying in the world. The client simulates the flight itself (grenadePhysics, from pos/vel/spawnTick) like a grenade without a fuse;
// resting = already at rest (guns that were there when you joined). weapon = WEAPONS id, ammo = rounds left in the magazine.
export interface WeaponDropSpawnMsg {
  t: typeof MsgType.WeaponDropSpawn
  id: number
  weapon: number
  ammo: number
  ownerId: number     // who dropped it (-1 = none)
  pos: [number, number, number]
  vel: [number, number, number]
  spawnTick: number
  resting: boolean
}
export interface WeaponDropRemoveMsg { t: typeof MsgType.WeaponDropRemove; id: number; byId?: number }   // byId: who picked it up (absent = expired / cleared)
export interface HoldSlotMsg { t: typeof MsgType.HoldSlot; slot: number }

// Infection (plan 16): byId = zombie that clawed (null = chosen mother zombie / fell off the map by itself)
export interface InfectedMsg { t: typeof MsgType.Infected; playerId: number; byId: number | null; kind: 'mother' | 'infected' }
export interface SniffedMsg { t: typeof MsgType.Sniffed; byId: number }
export interface HeroChosenMsg { t: typeof MsgType.HeroChosen; playerId: number }
export interface InfectionCountMsg { t: typeof MsgType.InfectionCount; humans: number; zombies: number }

// Defense (plan 17)
export type DefensePhase = 'waiting' | 'prep' | 'wave' | 'intermission' | 'victory' | 'defeat'
export interface DefenseStateMsg { t: typeof MsgType.DefenseState; phase: DefensePhase; wave: number; waves: number; phaseEndsAt: number; zombiesLeft: number }
export interface WaveStartMsg { t: typeof MsgType.WaveStart; wave: number; title: string; hint: string }
export interface WaveClearMsg { t: typeof MsgType.WaveClear; wave: number; bonus: number }
export interface DefenseStatMsg { id: number; kills: number; damage: number; revives: number }
export interface DefenseEndMsg { t: typeof MsgType.DefenseEnd; result: 'victory' | 'defeat'; wave: number; stats: DefenseStatMsg[] }
/** Boss ability warning: slam = red circle of radius `radius` around `pos`; charge = charge line from `pos` along `dir`, `radius` long */
export interface TelegraphMsg { t: typeof MsgType.Telegraph; kind: 'slam' | 'charge' | 'summon'; pos: [number, number, number]; dir?: [number, number, number]; radius: number; endsAt: number }

export interface PongMsg {
  t: typeof MsgType.Pong
  clientTime: number
  serverTime: number
  ka?: true      // keepalive on the unreliable channel (see PingMsg.ka)
}

export type AnyMsg =
  | JoinMsg | InputsMsg | PingMsg | SetDebugMsg | ChooseTeamMsg | BuyMsg | DropWeaponMsg | PickupWeaponMsg | ListRoomsMsg | OfflineCmdMsg
  | RtcOfferMsg | RtcCandidateMsg | RtcAnswerMsg
  | WelcomeMsg | PongMsg | SnapshotMsg | PlayerJoinedMsg | PlayerLeftMsg | HitConfirmMsg | ShotFxMsg | DebugShotMsg | KillMsg | RespawnMsg | HurtMsg | MatchStateMsg | TeamAssignedMsg | ScoreboardMsg | BuyResultMsg | MoneyEventMsg | GrenadeSpawnMsg | GrenadeExplodeMsg | GrenadeAnimMsg | WeaponDropSpawnMsg | WeaponDropRemoveMsg | HoldSlotMsg | RoomListMsg | JoinRejectedMsg | DebugCmdMsg | RoundEndMsg | RoundResetMsg | MatchEndMsg | OfflineStateMsg | BotDebugMsg | NavDebugMsg | InfectedMsg | HeroChosenMsg | InfectionCountMsg | SniffedMsg | DefenseStateMsg | WaveStartMsg | WaveClearMsg | DefenseEndMsg | TelegraphMsg

export const MAX_PITCH = 1.56
const ALL_BUTTONS = Object.values(Btn).reduce((a, b) => a | b, 0)

// Cmds from the client are untrusted: validate before queueing
export function isValidCmd(c: unknown): c is InputCmd {
  if (typeof c !== 'object' || c === null) return false
  const m = c as Record<string, unknown>
  return (
    typeof m.seq === 'number' && Number.isInteger(m.seq) &&
    typeof m.buttons === 'number' && Number.isInteger(m.buttons) && m.buttons >= 0 &&
    (m.buttons & ~ALL_BUTTONS) === 0 &&
    typeof m.yaw === 'number' && Number.isFinite(m.yaw) &&
    typeof m.pitch === 'number' && Math.abs(m.pitch) <= MAX_PITCH &&
    typeof m.weapon === 'number' && Number.isInteger(m.weapon) && m.weapon >= 0 && m.weapon < SLOT_COUNT &&   // slots 0–4
    
    (m.fireRenderTime === undefined || (typeof m.fireRenderTime === 'number' && Number.isFinite(m.fireRenderTime)))
  )
}

export function stateToNet(id: number, s: PlayerState, hp = 100, extraFlags = 0, team: TeamId = 'A', weapon = 0, killStreak = 0): NetPlayer {
  const out: NetPlayer = {
    id,
    pos: [s.pos[0], s.pos[1], s.pos[2]],
    vel: [s.vel[0], s.vel[1], s.vel[2]],
    yaw: s.yaw, pitch: s.pitch,
    flags: (s.grounded ? NetFlag.Grounded : 0) | (s.crouching ? NetFlag.Crouching : 0) | (s.slideTimer > 0 ? NetFlag.Sliding : 0) | extraFlags,
    slideTimer: s.slideTimer, slideCooldown: s.slideCooldown, adsT: s.adsT,
    hp, team, weapon, killStreak,
  }
  if (s.leapCd) out.leapCd = s.leapCd
  return out
}

export function netToState(n: NetPlayer): PlayerState {
  return {
    pos: [n.pos[0], n.pos[1], n.pos[2]],
    vel: [n.vel[0], n.vel[1], n.vel[2]],
    yaw: n.yaw, pitch: n.pitch,
    grounded: (n.flags & NetFlag.Grounded) !== 0,
    crouching: (n.flags & NetFlag.Crouching) !== 0,
    slideTimer: n.slideTimer, slideCooldown: n.slideCooldown, adsT: n.adsT ?? 0,
    ...(n.leapCd ? { leapCd: n.leapCd } : null),
  }
}

export function encode(msg: AnyMsg): Uint8Array {
  if (msg.t === MsgType.Snapshot) return encodeSnapshotFrame(msg)   // the one hot message has its own compact format (snapshotCodec.ts)
  return mpEncode(msg)
}

export function decode(buf: Uint8Array | ArrayBuffer): AnyMsg {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (bytes[0] === SNAPSHOT_MARKER) return { t: MsgType.Snapshot, ...decodeSnapshotFrame(bytes) }
  return mpDecode(bytes) as AnyMsg
}
