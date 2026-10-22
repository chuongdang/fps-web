import { encode, decode, type Transport } from '@fps/shared'

/** Transport that talks to the offline Web Worker via postMessage; still encodes/decodes msgpack like a real network. No netsim applied (ping = 0). */
export function createLocalTransport(worker: Worker): Transport {
  const msgCbs: Parameters<Transport['onMessage']>[0][] = []
  const closeCbs: (() => void)[] = []
  worker.addEventListener('message', e => {
    const d = e.data
    if (!(d instanceof ArrayBuffer)) return   // control messages ('ready', 'error') are handled where the worker is created
    try { const m = decode(d); for (const cb of msgCbs) cb(m) } catch { /* corrupt packet: ignore */ }
  })
  window.addEventListener('pagehide', () => { for (const cb of closeCbs) cb(); worker.terminate() })
  return {
    send: msg => {
      const b = encode(msg).slice()
      worker.postMessage(b.buffer, [b.buffer])
    },
    onMessage: cb => { msgCbs.push(cb) },
    onClose: cb => { closeCbs.push(cb) },
  }
}

/** Open the offline worker and wait for it to finish loading Rapier + the movement mesh. Rejects if the worker fails. */
export function startOfflineWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../../server/src/offline/worker.ts', import.meta.url), { type: 'module' })
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Offline worker failed to start')) }, 20000)
    worker.addEventListener('message', function onMsg(e) {
      const d = e.data as { t?: string; message?: string }
      if (d?.t === 'ready') { clearTimeout(timer); worker.removeEventListener('message', onMsg); resolve(worker) }
      else if (d?.t === 'error') { clearTimeout(timer); worker.terminate(); reject(new Error(d.message ?? 'Offline worker error')) }
    })
    worker.addEventListener('error', ev => { clearTimeout(timer); worker.terminate(); reject(new Error(ev.message || 'Offline worker error')) })
    // Dev: editing server/src/bots/bots.json → the plugin in vite.config.ts pushes the new content over the HMR channel (no page reload) → bots change behaviour immediately
    if (import.meta.hot) {
      import.meta.hot.on('bots-json', (params: unknown) => {
        worker.postMessage({ t: 'bots', params })
        console.log('[bots] bots.json reloaded, bots change behaviour immediately')
      })
    }
  })
}
