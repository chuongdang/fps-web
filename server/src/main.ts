import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { TICK_RATE, MATCH } from '@fps/shared'
import { MAPS } from '../../assets/maps'
import { lanAddresses } from './lan'
import { createGameServer } from './gameServer'
import { APP_VERSION } from './version'

const PORT = Number(process.env.FPS_PORT) || 8081   // npm run play uses 8082 so it can run alongside npm run dev

// Environment variables for quick testing: FPS_MATCH_MS (match duration), FPS_KILL_LIMIT
const rules = { ...MATCH }
if (Number(process.env.FPS_MATCH_MS) > 0) rules.durationMs = Number(process.env.FPS_MATCH_MS)
if (Number(process.env.FPS_KILL_LIMIT) > 0) rules.killLimit = Number(process.env.FPS_KILL_LIMIT)
if (Number(process.env.FPS_END_MS) > 0) rules.endScreenMs = Number(process.env.FPS_END_MS)

// Every map in the registry (assets/maps/index.ts) can be chosen when creating a room
const game = createGameServer({ maps: MAPS, rules, allowDebugCmds: process.env.NODE_ENV !== 'production', logTicks: true, version: APP_VERSION })

const server = createServer((_req, res) => {
  res.writeHead(200)
  res.end(`FPS Server tick=${TICK_RATE} rooms=${game.rooms.rooms.size}`)
})
game.attach(new WebSocketServer({ server }))

game.ready.then(() => {
  server.listen(PORT, () => {
    console.log(`listening ${PORT} (all network interfaces)`)
    for (const a of lanAddresses()) console.log(`  LAN ${a.iface}: ws://${a.address}:${PORT}   -> other machines open http://${a.address}:${process.env.FPS_WEB_PORT ?? 5173}`)
  })
})
