// Entry point of the offline Web Worker (plan 15, B.0). Runs the very same Room/simulation code as the Node server and talks to the page via postMessage
// (still encoding/decoding msgpack like a real network). The page creates it with: new Worker(new URL('.../offline/worker.ts', import.meta.url), { type: 'module' }).
import { decode, encode, loadMap, type AnyMsg, type Transport } from '@fps/shared'
import { MAPS, DEFAULT_MAP_ID } from '../../../assets/maps'
import { setBotParams } from '../bots/params'
import { createOfflineHost } from './host'

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((e: { data: unknown }) => void) | null
}
const scope = globalThis as unknown as WorkerScope

const handlers: ((m: AnyMsg) => void)[] = []
const closers: (() => void)[] = []

const transport: Transport = {
  send(msg) {
    const buf = encode(msg).slice()   // a trimmed copy that owns its buffer, so it can be transferred (no further copy)
    scope.postMessage(buf.buffer, [buf.buffer])
  },
  onMessage(cb) { handlers.push(cb) },
  onClose(cb) { closers.push(cb) },
}

scope.onmessage = e => {
  const d = e.data
  if (d instanceof ArrayBuffer) {
    try { const m = decode(d); for (const h of handlers) h(m) } catch { /* corrupt packet: ignore */ }
  } else if (d && typeof d === 'object') {
    const o = d as { t?: string; params?: unknown }
    if (o.t === 'bots') setBotParams(o.params)         // hot-reload bots.json (dev)
    else if (o.t === 'close') for (const c of closers) c()
  }
}

createOfflineHost(loadMap(MAPS[DEFAULT_MAP_ID]!)).then(host => {
  host.connect(transport)
  setInterval(() => host.pump(), 2)
  scope.postMessage({ t: 'ready' })
}).catch(err => scope.postMessage({ t: 'error', message: String(err?.message ?? err) }))
