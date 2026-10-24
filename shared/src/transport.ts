import type { AnyMsg } from './protocol'

// Common interface; client and server each have their own implementation (WebSocket)
export interface Transport {
  /** True while snapshots / inputs travel over an unreliable channel (shared/unreliable.ts): then a message can be lost for good, so the sender must not rely on delivery. Missing = reliable. */
  unreliableActive?(): boolean
  send(msg: AnyMsg): void
  onMessage(cb: (msg: AnyMsg) => void): void   // accumulates, calls every listener in registration order
  onClose(cb: () => void): void
}

export interface NetsimOptions {
  latencyMs: number            // delay per direction
  jitterMs: number             // ± variation around latencyMs
  // A lost packet on a real WebSocket (TCP) freezes the whole connection until it is resent: everything sent meanwhile arrives together afterwards.
  // Every `stallEveryMs` the connection freezes for `stallMs` in both directions (0 = off). The first freeze starts `stallEveryMs` after wrapping.
  stallEveryMs?: number
  stallMs?: number
  // UDP-like behaviour (the unreliable channel): `lossPct` % of the messages in each direction vanish, `unordered` lets jitter reorder messages (TCP never does)
  lossPct?: number
  unordered?: boolean
  now?: () => number           // injected for tests
  random?: () => number
}

// Wraps a Transport, delaying both directions. Keeps packet order (like TCP):
// a later packet's delivery time ≥ the previous one's, per direction.
export function withNetsim(inner: Transport, opts: NetsimOptions): Transport {
  const now = opts.now ?? (() => performance.now())
  const random = opts.random ?? Math.random
  const t0 = now()
  const every = opts.stallEveryMs ?? 0, stall = opts.stallMs ?? 0
  // A message that would arrive inside a freeze window arrives when the window ends
  const afterStall = (due: number): number => {
    if (every <= 0 || stall <= 0 || due < t0 + every) return due
    const start = t0 + Math.floor((due - t0) / every) * every
    return due < start + stall ? start + stall : due
  }

  // FIFO queue + one timer: setTimeouts of different lengths do not guarantee order when they fire in the same ms
  function makeDelayer(deliver: (msg: AnyMsg) => void) {
    const queue: { due: number; msg: AnyMsg }[] = []
    let lastDue = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const drain = () => {
      timer = null
      while (queue.length > 0 && queue[0]!.due <= now()) deliver(queue.shift()!.msg)
      if (queue.length > 0) timer = setTimeout(drain, Math.max(0, queue[0]!.due - now()))
    }
    return (msg: AnyMsg) => {
      if (opts.lossPct && random() * 100 < opts.lossPct) return
      const t = now()
      const delay = Math.max(0, opts.latencyMs + (random() * 2 - 1) * opts.jitterMs)
      const due = afterStall(t + delay)
      if (opts.unordered) {
        // a later message may overtake an earlier one: keep the queue sorted by due time
        lastDue = due
        let i = queue.length
        while (i > 0 && queue[i - 1]!.due > due) i--
        queue.splice(i, 0, { due, msg })
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(drain, Math.max(0, queue[0]!.due - t))
        return
      }
      lastDue = Math.max(due, lastDue)
      queue.push({ due: lastDue, msg })
      if (timer === null) timer = setTimeout(drain, Math.max(0, lastDue - t))
    }
  }

  const listeners: ((msg: AnyMsg) => void)[] = []
  const delayIn = makeDelayer(msg => { for (const l of listeners) l(msg) })
  const delayOut = makeDelayer(msg => inner.send(msg))
  inner.onMessage(delayIn)

  return {
    send: delayOut,
    onMessage(cb) { listeners.push(cb) },
    onClose(cb) { inner.onClose(cb) },
  }
}
