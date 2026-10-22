import type { AnyMsg } from './protocol'

// Common interface; client and server each have their own implementation (WebSocket)
export interface Transport {
  send(msg: AnyMsg): void
  onMessage(cb: (msg: AnyMsg) => void): void   // accumulates, calls every listener in registration order
  onClose(cb: () => void): void
}

export interface NetsimOptions {
  latencyMs: number            // delay per direction
  jitterMs: number             // ± variation around latencyMs
  now?: () => number           // injected for tests
  random?: () => number
}

// Wraps a Transport, delaying both directions. Keeps packet order (like TCP):
// a later packet's delivery time ≥ the previous one's, per direction.
export function withNetsim(inner: Transport, opts: NetsimOptions): Transport {
  const now = opts.now ?? (() => performance.now())
  const random = opts.random ?? Math.random

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
      const t = now()
      const delay = Math.max(0, opts.latencyMs + (random() * 2 - 1) * opts.jitterMs)
      lastDue = Math.max(t + delay, lastDue)
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
