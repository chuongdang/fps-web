// Browser end of the WebRTC upgrade (server/src/rtcTransport.ts is the other end, shared/unreliable.ts the routing). After the WebSocket has joined a room
// we offer a DataChannel (unordered, no retransmits) over it; once it is open, snapshots / inputs / pings travel over it while it is healthy and over the
// WebSocket when it is not. Anything that goes wrong (no WebRTC in the browser, the server has it off, UDP blocked, a firewall) leaves the game on the
// WebSocket, exactly as before. `?rtc=0` in the URL turns it off (to compare).
import { MsgType, decode, encode, withNetsim, withUnreliable, type AnyMsg, type DatagramChannel, type Transport, type UnreliableTransport } from '@fps/shared'

/** STUN lets the browser learn its public address; without it the connection still works through the server's replies, this just makes it more reliable behind NATs */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const OPEN_TIMEOUT_MS = 12_000

/** What F3 shows: the current connection's unreliable transport, if any */
export const rtcDebug: { transport: UnreliableTransport | null; state: string } = { transport: null, state: 'off' }

function domChannel(dc: RTCDataChannel): DatagramChannel {
  dc.binaryType = 'arraybuffer'
  const msgCbs: ((m: AnyMsg) => void)[] = []
  const closeCbs: (() => void)[] = []
  dc.onmessage = e => { if (typeof e.data === 'string') return; try { const m = decode(e.data as ArrayBuffer); for (const cb of msgCbs) cb(m) } catch { /* corrupt packet */ } }
  dc.onclose = () => { for (const cb of closeCbs) cb() }
  return {
    isOpen: () => dc.readyState === 'open',
    bufferedAmount: () => dc.bufferedAmount,
    send: msg => { if (dc.readyState === 'open') { try { dc.send(encode(msg)) } catch { /* closing */ } } },
    onMessage: cb => { msgCbs.push(cb) },
    onClose: cb => { closeCbs.push(cb) },
  }
}

/** Dev only: ?lat= ?jit= ?loss= (percent) make the unreliable channel behave like a bad internet path: delay, jitter that reorders, packets that vanish */
export function maybeNetsimChannel(ch: DatagramChannel, search = location.search): DatagramChannel {
  const q = new URLSearchParams(search)
  const latencyMs = Number(q.get('lat') ?? 0) || 0
  const jitterMs = Number(q.get('jit') ?? 0) || 0
  const lossPct = Number(q.get('loss') ?? 0) || 0
  if (latencyMs <= 0 && jitterMs <= 0 && lossPct <= 0) return ch
  console.log(`[netsim] channel lat=${latencyMs}ms jit=±${jitterMs}ms loss=${lossPct}% (unordered)`)
  const sim = withNetsim(ch, { latencyMs, jitterMs, lossPct, unordered: true })
  return { ...sim, isOpen: () => ch.isOpen(), ...(ch.bufferedAmount ? { bufferedAmount: () => ch.bufferedAmount!() } : null) }
}

/** Wrap the (already netsim'ed) WebSocket transport. Returns it unchanged when WebRTC is unavailable or switched off. */
export function enableRtc(base: Transport, search = location.search): Transport {
  if (typeof RTCPeerConnection === 'undefined' || new URLSearchParams(search).get('rtc') === '0') { rtcDebug.state = 'off'; return base }
  let pc: RTCPeerConnection | null = null
  let started = false

  const stop = (reason: string): void => {
    rtcDebug.state = reason
    t.setChannel(null)
    if (pc) { const p = pc; pc = null; try { p.close() } catch { /* already closed */ } }
  }

  const start = async (): Promise<void> => {
    started = true
    rtcDebug.state = 'connecting'
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc = peer
    const dc = peer.createDataChannel('game', { ordered: false, maxRetransmits: 0 })
    const ch = maybeNetsimChannel(domChannel(dc), search)
    const timer = setTimeout(() => { if (pc === peer && !t.channel) { console.warn('[rtc] the channel did not open (UDP blocked?): staying on the WebSocket'); stop('timeout, using WebSocket') } }, OPEN_TIMEOUT_MS)
    dc.addEventListener('open', () => { clearTimeout(timer); if (pc === peer) { t.setChannel(ch); rtcDebug.state = 'open'; console.log('[rtc] unreliable channel open') } })
    dc.addEventListener('close', () => { clearTimeout(timer); if (pc === peer) stop('closed, using WebSocket') })
    peer.addEventListener('connectionstatechange', () => { if (pc === peer && (peer.connectionState === 'failed' || peer.connectionState === 'closed')) stop(`${peer.connectionState}, using WebSocket`) })
    peer.addEventListener('icecandidate', e => {
      if (e.candidate && pc === peer) base.send({ t: MsgType.RtcCandidate, candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex })
    })
    await peer.setLocalDescription(await peer.createOffer())
    base.send({ t: MsgType.RtcOffer, sdp: peer.localDescription!.sdp })
  }

  const signaling = (msg: AnyMsg): boolean => {
    if (msg.t === MsgType.Welcome && !started) {   // joined a room: now is the time (the Welcome itself still reaches the game)
      start().catch(err => { console.warn('[rtc] could not start:', err); stop('failed, using WebSocket') })
      return false
    }
    if (msg.t === MsgType.RtcAnswer) {
      if (msg.error || !msg.sdp) { console.log(`[rtc] server declined: ${msg.error ?? 'no answer'}; staying on the WebSocket`); stop(`server: ${msg.error ?? 'declined'}`); return true }
      pc?.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(err => { console.warn('[rtc] bad answer:', err); stop('failed, using WebSocket') })
      return true
    }
    if (msg.t === MsgType.RtcCandidate) {
      pc?.addIceCandidate({ candidate: msg.candidate, sdpMid: msg.sdpMid ?? null, sdpMLineIndex: msg.sdpMLineIndex ?? null }).catch(() => { /* late or duplicate candidate */ })
      return true
    }
    return false
  }

  const t = withUnreliable(base, { role: 'client', signaling })
  rtcDebug.transport = t
  base.onClose(() => { stop('connection closed'); t.dispose(); if (rtcDebug.transport === t) rtcDebug.transport = null })
  return t
}
