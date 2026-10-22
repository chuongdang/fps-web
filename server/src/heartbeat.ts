import type { WebSocket, WebSocketServer } from 'ws'

// A dead connection without a close frame (tab closed abruptly, proxy/tunnel holding the socket, network drop)
// never produces a 'close' event on the server, so a ghost player stays in the room. Ping periodically: anyone who
// does not answer with a Pong before the next ping is terminated (-> 'close' -> Room.leave).
export function startHeartbeat(wss: WebSocketServer, intervalMs = 5000): () => void {
  const alive = new WeakMap<WebSocket, boolean>()
  wss.on('connection', ws => {
    alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))
  })
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue }
      alive.set(ws, false)
      ws.ping()
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
