// Handles one connection (real WebSocket or the offline LocalTransport): shared by the Node server and the offline Web Worker.
// Does not import ws/fs/process, so it runs in the browser.
import { MsgType, isCharacterSet, DEFAULT_CHARACTER_SET, type JoinMsg, type MovementConfig, type Transport } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { enqueueCmds } from './simulation'
import { handleBuy } from './shop'
import { handleDrop, handlePickup } from './weaponDrops'
import { handleDebugCmd } from './debugCmds'
import { RoomManager, sanitizeName, sanitizeRoom, type Player, type Room } from './room'

export interface ServerContext {
  rooms: RoomManager
  cfg: MovementConfig
  tick(): number                       // current TickLoop tick
  now(): number                        // serverTime (ms) for the Pong reply
  allowDebugCmds: boolean              // debug commands (M.8): false in production
  log?(text: string): void
  /** Server version: if set, the client must send the same version in ListRooms/Join or it is rejected. Offline (same bundle as the client) leaves it unset. */
  version?: string
  /** Offline: create a private room for the first connection (instead of a normal Join). */
  joinOverride?(transport: Transport, name: string, msg: JoinMsg): { room: Room; player: Player } | null
  /** After a player enters the room (world loaded or not): the offline host places bots, etc. */
  onJoined?(room: Room, player: Player): void
  onOfflineCmd?(room: Room, player: Player, msg: Extract<import('@fps/shared').AnyMsg, { t: typeof MsgType.OfflineCmd }>): void
  onLeft?(room: Room, player: Player): void
}

export function handleConnection(ctx: ServerContext, transport: Transport): void {
  const { rooms, cfg } = ctx
  const log = ctx.log ?? (() => {})
  let room: Room | null = null
  let player: Player | null = null
  let refused = false   // rejected because of a version mismatch: ignore every later message

  transport.onMessage(msg => {
    if (refused) return
    if (ctx.version !== undefined && (msg.t === MsgType.ListRooms || msg.t === MsgType.Join) && msg.version !== ctx.version) {
      refused = true
      log(`Rejected client version ${String(msg.version)} (server ${ctx.version})`)
      transport.send({ t: MsgType.JoinRejected, reason: 'version' })
      return
    }
    if (msg.t === MsgType.Ping) {
      transport.send({ t: MsgType.Pong, clientTime: msg.clientTime, serverTime: ctx.now() })
      if (player && typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) player.pingMs = Math.min(999, Math.max(0, msg.rtt))
    } else if (msg.t === MsgType.Inputs) {
      if (player) enqueueCmds(player, msg.cmds, ctx.now())
    } else if (msg.t === MsgType.RtcOffer) {
      // This server has no WebRTC (a server that has it handles the offer one layer down, rtcTransport.ts): say so, the client then stays on the WebSocket without waiting
      transport.send({ t: MsgType.RtcAnswer, error: 'disabled' })
    } else if (msg.t === MsgType.SetDebug) {
      if (player) player.debugShots = msg.shots === true
    } else if (msg.t === MsgType.Buy) {
      if (room && player && typeof msg.key === 'string') handleBuy(room, player, msg.key)
    } else if (msg.t === MsgType.DropWeapon) {
      if (room && player) handleDrop(room, player)
    } else if (msg.t === MsgType.PickupWeapon) {
      if (room && player) handlePickup(room, player)
    } else if (msg.t === MsgType.ChooseTeam) {
      // Switch team at any time if the balance rules (maxTeamDiff, maxPerTeam) allow it; otherwise keep the old team
      if (!room || !player) return
      const pref = msg.team === 'A' || msg.team === 'B' ? msg.team : 'auto'
      const team = room.assignTeam(pref, player)
      if (team && team !== player.team && room.mode.canSwitchTeam(room, player)) { room.setTeam(player, team); room.resetEconomy(player); room.respawn(player) }
      else transport.send({ t: MsgType.TeamAssigned, id: player.id, team: player.team })
    } else if (msg.t === MsgType.DebugCmd) {
      // Debug commands (M.8): only accepted outside production
      if (ctx.allowDebugCmds && room && player && typeof msg.cmd === 'string') handleDebugCmd(room, player, msg.cmd.slice(0, 64))
    } else if (msg.t === MsgType.OfflineCmd) {
      if (room && player && room.offline) ctx.onOfflineCmd?.(room, player, msg)
    } else if (msg.t === MsgType.ListRooms) {
      transport.send({ t: MsgType.RoomList, rooms: rooms.list(), maps: rooms.mapList() })
    } else if (msg.t === MsgType.Join) {
      if (player) return   // each connection joins only once
      const name = sanitizeName(msg.name)
      const roomId = sanitizeRoom(msg.room)
      if (!name || !roomId) { transport.send({ t: MsgType.JoinRejected, reason: 'bad' }); return }
      let res: { room: Room; player: Player } | null
      if (ctx.joinOverride) {
        res = ctx.joinOverride(transport, name, msg)
      } else {
        const exists = rooms.rooms.has(roomId)
        if (msg.create === true && exists) { transport.send({ t: MsgType.JoinRejected, reason: 'exists' }); return }
        if (msg.create === false && !exists) { transport.send({ t: MsgType.JoinRejected, reason: 'missing' }); return }
        const pref = msg.team === 'A' || msg.team === 'B' ? msg.team : 'auto'
        res = rooms.tryJoin(roomId, name, transport, ctx.tick(), pref, isCharacterSet(msg.characterSet) ? msg.characterSet : DEFAULT_CHARACTER_SET, typeof msg.mapId === 'string' ? msg.mapId : undefined, msg.create === true && typeof msg.options === 'object' ? msg.options : undefined)
      }
      if (!res) { log(`[room ${roomId}] "${name}" rejected: room full`); transport.send({ t: MsgType.JoinRejected, reason: 'full' }); return }
      ;({ room, player } = res)
      const joined = player, joinedRoom = room
      createWorld(room.map, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(w => {
        // The player may have left before the world finished loading
        if (joinedRoom.players.has(joined.id)) joined.world = w
        else w.dispose()
      })
      log(`[room ${roomId}] #${player.id} "${name}" joined (${room.players.size} players)`)
      ctx.onJoined?.(room, player)
    }
  })

  transport.onClose(() => {
    if (!room || !player) return
    room.leave(player.id)
    log(`[room ${room.id}] #${player.id} "${player.name}" left (${room.players.size} players)`)
    ctx.onLeft?.(room, player)
  })
}
