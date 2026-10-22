// Add / remove bots in a room (plan 15, B.2). A bot is a normal Player whose empty transport forwards messages to the BotController.
import { MsgType, defaultMovement, type BotDifficulty, type OfflineBotInfo, type TeamId } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import type { Player, Room } from '../room'
import { BotController } from './controller'
import { pickBotName } from './names'

/** Add a bot to `team` (or to the smaller team if 'auto'). Returns null when the room is full. */
export function addBot(room: Room, difficulty: BotDifficulty, team: TeamId | 'auto', rng: () => number = Math.random): Player | null {
  const ctl = new BotController(difficulty, rng)
  const name = pickBotName([...room.players.values()].map(p => p.name), difficulty, rng)
  const p = room.join(name, ctl.transport, room.tick, room.serverNow, team)
  if (!p) return null
  p.bot = ctl
  ctl.attach(room, p)
  const cfg = defaultMovement
  createWorld(room.map, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(w => {
    if (room.players.get(p.id) === p) p.world = w
    else w.dispose()
  })
  return p
}

export function removeBot(room: Room, id: number): boolean {
  const p = room.players.get(id)
  if (!p?.bot) return false
  room.leave(id)
  return true
}

export function clearBots(room: Room): void {
  for (const p of [...room.players.values()]) if (p.bot) room.leave(p.id)
}

export function botList(room: Room): OfflineBotInfo[] {
  const out: OfflineBotInfo[] = []
  for (const p of room.players.values()) if (p.bot) out.push({ id: p.id, name: p.name, difficulty: p.bot.difficulty, team: p.team })
  return out
}

export function offlineStateMsg(room: Room) {
  return { t: MsgType.OfflineState, infiniteMoney: room.infiniteMoney, bots: botList(room) } as const
}
