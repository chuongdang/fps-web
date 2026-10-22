import { loadMap, MATCH, defaultMovement, type MapFile, type MatchRules } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { WebSocketServer } from 'ws'
import { buildNav } from './bots/nav'
import { wrapWebSocket } from './transport'
import { startHeartbeat } from './heartbeat'
import { TickLoop } from './tickLoop'
import { stepRoom, sendSnapshots } from './simulation'
import { RoomManager } from './room'
import { handleConnection, type ServerContext } from './connection'

const stamp = () => new Date().toTimeString().slice(0, 8)

export interface GameServerOptions {
  /** The first map (id `deathmatch`) is the default; the others can be chosen when creating a room */
  maps: Record<string, MapFile>
  rules?: MatchRules
  allowDebugCmds: boolean
  maxRooms?: number
  /** Require clients to have the same version (see ServerContext.version) */
  version?: string
  /** Log ticks/second every 10 seconds while players are connected (dev server) */
  logTicks?: boolean
}

export interface GameServer {
  rooms: RoomManager
  /** Attach the WebSocketServer (noServer, or attached directly to the HTTP server) */
  attach(wss: WebSocketServer): void
  /** Resolves once Rapier has initialised wasm and the nav meshes are built; connections are only accepted after that */
  ready: Promise<void>
  close(): void
}

// Game server core shared by main.ts (dev) and standalone.ts (packaged): rooms, 60Hz loop, connection handling.
export function createGameServer(opts: GameServerOptions): GameServer {
  const cfg = defaultMovement
  const entries = Object.entries(opts.maps)
  const [defId, defFile] = entries.find(([id]) => id === 'deathmatch') ?? entries[0]!
  const rooms = new RoomManager(loadMap(defFile), undefined, opts.rules ?? { ...MATCH }, defId)
  if (opts.maxRooms) rooms.maxRooms = opts.maxRooms
  for (const [id, mf] of entries) if (id !== defId) rooms.registerMap(id, mf.name, loadMap(mf))
  const sweep = setInterval(() => rooms.sweep(), 5000)

  // 60Hz loop: simulate, then send a snapshot (every SNAPSHOT_EVERY_TICKS ticks)
  let ticksThisWindow = 0
  const loop = new TickLoop(() => performance.now(), (tick, serverTime) => {
    for (const room of rooms.rooms.values()) {
      stepRoom(room, cfg, serverTime, tick)
      sendSnapshots(room, tick, serverTime)
    }
    ticksThisWindow++
  })
  const pump = setInterval(() => loop.pump(), 1)

  let windowStart = performance.now()
  const tickLog = opts.logTicks ? setInterval(() => {
    const now = performance.now()
    let players = 0
    for (const r of rooms.rooms.values()) players += r.players.size
    if (players > 0) {
      console.log(`[tick] ${(ticksThisWindow * 1000 / (now - windowStart)).toFixed(1)}/s, skipped ${loop.skipped}, ${players} players`)
    }
    ticksThisWindow = 0
    windowStart = now
  }, 10_000) : null

  const ctx: ServerContext = {
    rooms, cfg,
    tick: () => loop.tick,
    now: () => performance.now(),   // serverTime = ms since the server started
    allowDebugCmds: opts.allowDebugCmds,
    version: opts.version,
    log: text => console.log(`${stamp()} ${text}`),
  }
  let stopHeartbeat: (() => void) | null = null
  const attach = (wss: WebSocketServer): void => {
    stopHeartbeat = startHeartbeat(wss)
    wss.on('connection', ws => handleConnection(ctx, wrapWebSocket(ws)))
  }

  // Rapier initialises wasm on the first createWorld; several concurrent createWorld calls while cold corrupt memory
  // ("recursive use of an object"). Accept connections only after initialisation is done.
  const ready = (async () => {
    for (const [id, { map }] of rooms.maps) {   // one nav grid per map, built one after another (see the Rapier note above)
      const w = await createWorld(map, cfg.standHeight, cfg.crouchHeight, cfg.radius)
      rooms.navs.set(id, buildNav(w, map, cfg))   // Defense zombies + bots follow this grid
      w.dispose()
    }
  })()

  return {
    rooms, attach, ready,
    close() {
      clearInterval(sweep); clearInterval(pump); if (tickLog) clearInterval(tickLog)
      stopHeartbeat?.()
    },
  }
}
