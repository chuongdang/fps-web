// Unreliable path for the hot messages. A WebSocket is TCP: one lost packet freezes the whole connection (200+ ms) and everything sent meanwhile arrives
// in a burst. Snapshots and inputs do not need that: a newer one makes an older one worthless. So when a WebRTC DataChannel (unordered, no retransmits)
// is open, these travel over it, and everything else (hits, kills, shop, chat of the match...) stays on the reliable WebSocket.
//
// withUnreliable(base, opts) wraps the WebSocket transport and has the same interface, so no game code changes. Both ends use it (client and server):
//  - routing:   Snapshot / Inputs / Ping / Pong go over the channel while it is healthy; everything else, and these too when it is not, over the base.
//  - health:    the channel counts as healthy while something arrived on it in the last healthMs. Both ends send a tiny keepalive every keepaliveMs, so a
//               silent path is noticed within a second and the base takes over; the keepalives keep being sent, so the channel is used again when it recovers.
//  - redundancy (client): every Inputs packet repeats the previous cmds (`redundancy` in total), so a lost packet costs nothing. The server drops a
//               cmd it already ran (seq <= lastProcessedSeq).
//  - replies:   a Pong goes back the way its Ping came.
// Messages from both paths are delivered to the same listeners. Snapshots are ignored when old (tick <= last) by the receiver already.
import type { AnyMsg } from './protocol'
import type { InputCmd } from './movement'
import { MsgType } from './protocol'
import type { Transport } from './transport'

/** An unreliable message channel (a DataChannel behind a Transport-shaped adapter) */
export interface DatagramChannel extends Transport {
  isOpen(): boolean
  bufferedAmount?(): number   // bytes queued and not yet sent: when it grows the path is congested
}

export interface UnreliableOptions {
  role: 'client' | 'server'
  /** Treat the channel as dead when nothing arrived on it for this long (ms) */
  healthMs?: number
  /** Keepalive period (ms) */
  keepaliveMs?: number
  /** How many cmds one Inputs packet carries (the new one plus the previous ones) */
  redundancy?: number
  /** Do not queue more than this many bytes on the channel: send on the base instead */
  maxBuffered?: number
  /** Consumes signalling messages (RtcOffer / RtcAnswer / RtcCandidate) before they reach the listeners; true = consumed */
  signaling?: (msg: AnyMsg) => boolean
  now?: () => number
}

export interface UnreliableStats {
  sentUnreliable: number
  sentReliable: number
  recvUnreliable: number
  recvReliable: number
  fallbacks: number        // times the channel went from healthy to silent
  lastRxAgoMs: number      // ms since the channel last delivered anything (Infinity if never)
}

export interface UnreliableTransport extends Transport {
  /** Use `channel` (null = none, e.g. it closed) */
  setChannel(channel: DatagramChannel | null): void
  readonly channel: DatagramChannel | null
  readonly stats: UnreliableStats
  /** Stop the keepalive timer (call when the connection ends) */
  dispose(): void
}

const OVER_CHANNEL = new Set<number>([MsgType.Snapshot, MsgType.Inputs, MsgType.Ping, MsgType.Pong])
export const UNRELIABLE_DEFAULTS = { healthMs: 1000, keepaliveMs: 250, redundancy: 4, maxBuffered: 16 * 1024 } as const

export function withUnreliable(base: Transport, opts: UnreliableOptions): UnreliableTransport {
  const now = opts.now ?? (() => performance.now())
  const healthMs = opts.healthMs ?? UNRELIABLE_DEFAULTS.healthMs
  const keepaliveMs = opts.keepaliveMs ?? UNRELIABLE_DEFAULTS.keepaliveMs
  const redundancy = Math.max(1, opts.redundancy ?? UNRELIABLE_DEFAULTS.redundancy)
  const maxBuffered = opts.maxBuffered ?? UNRELIABLE_DEFAULTS.maxBuffered

  const listeners: ((msg: AnyMsg) => void)[] = []
  const deliver = (msg: AnyMsg): void => { for (const l of listeners) l(msg) }
  let ch: DatagramChannel | null = null
  let lastRx = -Infinity
  let wasHealthy = false
  let pingFrom: 'channel' | 'base' = 'base'
  let timer: ReturnType<typeof setInterval> | null = null
  const recent: InputCmd[] = []   // the last cmds sent (any path), for the redundancy
  const stats: UnreliableStats = { sentUnreliable: 0, sentReliable: 0, recvUnreliable: 0, recvReliable: 0, fallbacks: 0, lastRxAgoMs: Infinity }

  const healthy = (): boolean => {
    const ok = ch !== null && ch.isOpen() && now() - lastRx <= healthMs
    if (wasHealthy && !ok) stats.fallbacks++
    wasHealthy = ok
    return ok
  }

  const keepalive = (): AnyMsg => opts.role === 'client'
    ? { t: MsgType.Ping, clientTime: 0, ka: true }
    : { t: MsgType.Pong, clientTime: 0, serverTime: 0, ka: true }

  const startTimer = (): void => {
    if (timer !== null) return
    timer = setInterval(() => {
      if (ch && ch.isOpen()) ch.send(keepalive())
      healthy()   // notices the fall back even when nothing is being sent
    }, keepaliveMs)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()   // Node: do not keep the process alive for a keepalive
  }
  const stopTimer = (): void => { if (timer !== null) { clearInterval(timer); timer = null } }

  base.onMessage(msg => {
    if (opts.signaling?.(msg)) return
    stats.recvReliable++
    if (msg.t === MsgType.Ping) pingFrom = 'base'
    deliver(msg)
  })

  const t: UnreliableTransport = {
    get channel() { return ch },
    stats,
    unreliableActive: () => healthy(),
    setChannel(next) {
      if (ch === next) return
      ch = next
      wasHealthy = false
      if (!next) { stopTimer(); return }
      lastRx = now()   // optimistic: a channel that just opened is trusted for healthMs
      next.onMessage(msg => {
        if (ch !== next) return
        lastRx = now()
        if ((msg.t === MsgType.Ping || msg.t === MsgType.Pong) && msg.ka) return   // keepalive: proves the path, is not a message
        stats.recvUnreliable++
        if (msg.t === MsgType.Ping) pingFrom = 'channel'
        deliver(msg)
      })
      next.onClose(() => { if (ch === next) t.setChannel(null) })
      startTimer()
    },
    send(msg) {
      let out = msg
      if (opts.role === 'client' && msg.t === MsgType.Inputs) {
        const sent = msg.cmds
        const cmds = [...recent.filter(c => !sent.some(s => s.seq === c.seq)), ...sent]
        recent.push(...sent)
        if (recent.length > redundancy - 1) recent.splice(0, recent.length - (redundancy - 1))
        out = { ...msg, cmds: cmds.slice(-redundancy) }
        if (!(ch && healthy() && over(ch))) { base.send(msg); stats.sentReliable++; return }   // the reliable path needs no repeats
        ch.send(out); stats.sentUnreliable++
        return
      }
      if (OVER_CHANNEL.has(msg.t) && ch && healthy() && (msg.t !== MsgType.Pong || pingFrom === 'channel') && over(ch)) {
        ch.send(msg); stats.sentUnreliable++
        return
      }
      base.send(msg); stats.sentReliable++
    },
    onMessage(cb) { listeners.push(cb) },
    onClose(cb) { base.onClose(cb) },
    dispose() { stopTimer() },
  }
  Object.defineProperty(stats, 'lastRxAgoMs', { get: () => now() - lastRx, enumerable: true })
  base.onClose(() => stopTimer())

  function over(c: DatagramChannel): boolean {
    return (c.bufferedAmount?.() ?? 0) <= maxBuffered
  }
  return t
}
