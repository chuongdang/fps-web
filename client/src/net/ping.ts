import { MsgType, type Transport } from '@fps/shared'
import { clock } from './clock'

export interface PingStats {
  rttMs: number          // RTT of the latest Pong (0 = none yet)
  outOfOrder: number     // number of Pongs that arrived out of order (must always be 0)
}

// Sends a Ping every second, measures RTT and syncs the clock (clock.ts). Pong echoes clientTime (increasing), so it doubles as the seq.
export function startPing(transport: Transport, stats: PingStats): void {
  let lastEcho = -Infinity
  transport.onMessage(msg => {
    if (msg.t !== MsgType.Pong) return
    stats.rttMs = performance.now() - msg.clientTime
    if (msg.clientTime < lastEcho) {
      stats.outOfOrder++
      console.warn(`[net] Pong out of order: ${msg.clientTime} < ${lastEcho}`)
    }
    lastEcho = msg.clientTime
    clock.addSample(msg.clientTime, msg.serverTime)
  })
  const send = () => transport.send({ t: MsgType.Ping, clientTime: performance.now(), rtt: stats.rttMs })
  send()
  setInterval(send, 1000)
}
