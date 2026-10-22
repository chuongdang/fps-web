import { encode, decode, withNetsim, type Transport } from '@fps/shared'

export function connectWebSocket(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const msgCbs: Parameters<Transport['onMessage']>[0][] = []
    const closeCbs: (() => void)[] = []
    ws.onmessage = e => {
      try { const m = decode(e.data as ArrayBuffer); for (const cb of msgCbs) cb(m) } catch { /* corrupt packet: ignore */ }
    }
    // Reload/tab close: close the socket explicitly so the server notices at once instead of waiting for a timeout
    window.addEventListener('pagehide', () => ws.close(1000))
    ws.onclose = () => { for (const cb of closeCbs) cb() }
    ws.onerror = () => reject(new Error(`WebSocket error: ${url}`))
    ws.onopen = () => resolve({
      send: msg => { if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg)) },
      onMessage: cb => { msgCbs.push(cb) },
      onClose: cb => { closeCbs.push(cb) },
    })
  })
}

// Netsim is only enabled with ?lat= or ?jit= in the URL (dev)
export function maybeNetsim(t: Transport, search = location.search): Transport {
  const q = new URLSearchParams(search)
  const latencyMs = Number(q.get('lat') ?? 0) || 0
  const jitterMs = Number(q.get('jit') ?? 0) || 0
  if (latencyMs <= 0 && jitterMs <= 0) return t
  console.log(`[netsim] lat=${latencyMs}ms/direction jit=±${jitterMs}ms`)
  return withNetsim(t, { latencyMs, jitterMs })
}
