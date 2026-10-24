// Server end of the WebRTC upgrade (shared/unreliable.ts has the routing; net/rtc.ts is the browser end). The client sends an SDP offer over the WebSocket,
// we answer and a DataChannel (unordered, no retransmits) opens between us; snapshots, inputs and pings then travel over it while it is healthy and over the
// WebSocket when it is not. If WebRTC is not configured, not reachable (UDP blocked) or anything fails, the game simply stays on the WebSocket.
//
// Needs the server to be reachable over UDP: `portRange` is the UDP ports it may use (one per connected player) and `publicIps` the address(es) the
// browser must send to (the server's public IP; a machine behind NAT / Docker does not know it).
import { RTCPeerConnection, type RTCDataChannel } from 'werift'
import { MsgType, decode, encode, withUnreliable, type AnyMsg, type DatagramChannel, type Transport, type UnreliableTransport } from '@fps/shared'

export interface RtcConfig {
  portRange?: [number, number]
  publicIps?: string[]
  /** Peer connections at the same time (each holds a UDP port and some memory) */
  maxPeers?: number
  log?(text: string): void
}

const OPEN_TIMEOUT_MS = 15_000
const MAX_SDP_BYTES = 16 * 1024
let activePeers = 0

function channelTransport(dc: RTCDataChannel): DatagramChannel {
  return {
    isOpen: () => dc.readyState === 'open',
    bufferedAmount: () => dc.bufferedAmount,
    send(msg) {
      if (dc.readyState !== 'open') return
      try { dc.send(Buffer.from(encode(msg))) } catch { /* the channel closed under us: the next health check hands over to the WebSocket */ }
    },
    onMessage(cb) {
      dc.onMessage.subscribe(data => {
        if (typeof data === 'string') return
        try { cb(decode(data)) } catch { /* corrupt packet: ignore */ }
      })
    },
    onClose(cb) { dc.stateChanged.subscribe(s => { if (s === 'closed') cb() }) },
  }
}

/** Wrap one client's WebSocket transport: the same interface, plus the WebRTC upgrade when the client asks for it */
export function withServerRtc(base: Transport, cfg: RtcConfig): UnreliableTransport {
  const log = cfg.log ?? (() => {})
  let pc: RTCPeerConnection | null = null
  let chain: Promise<void> = Promise.resolve()   // signalling messages are handled one after the other
  let openTimer: ReturnType<typeof setTimeout> | null = null
  let welcomed = false   // only a connection that has joined a room (passed the version check) may take a UDP port

  const closePeer = (): void => {
    if (openTimer) { clearTimeout(openTimer); openTimer = null }
    if (!pc) return
    const p = pc; pc = null
    activePeers--
    t.setChannel(null)
    p.close().catch(() => {})
  }

  const handleOffer = async (sdp: string): Promise<void> => {
    if (pc) { closePeer() }   // a second offer replaces the first
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > MAX_SDP_BYTES) { base.send({ t: MsgType.RtcAnswer, error: 'bad offer' }); return }
    if (activePeers >= (cfg.maxPeers ?? 200)) { base.send({ t: MsgType.RtcAnswer, error: 'busy' }); return }
    const peer = new RTCPeerConnection({
      iceServers: [],
      icePortRange: cfg.portRange,
      iceAdditionalHostAddresses: cfg.publicIps,
      iceUseIpv4: true, iceUseIpv6: false,
    })
    pc = peer; activePeers++
    peer.onDataChannel.subscribe(dc => {
      if (dc.label !== 'game' || pc !== peer) return
      const ch = channelTransport(dc)
      const open = (): void => {
        if (openTimer) { clearTimeout(openTimer); openTimer = null }
        log('WebRTC channel open')
        t.setChannel(ch)
      }
      if (dc.readyState === 'open') open()
      else dc.stateChanged.subscribe(s => { if (s === 'open') open() })
    })
    peer.onIceCandidate.subscribe(c => { if (c && pc === peer) { const j = c.toJSON(); base.send({ t: MsgType.RtcCandidate, candidate: j.candidate, sdpMid: j.sdpMid, sdpMLineIndex: j.sdpMLineIndex }) } })
    peer.connectionStateChange.subscribe(s => { if ((s === 'failed' || s === 'closed') && pc === peer) { log(`WebRTC ${s}`); closePeer() } })
    openTimer = setTimeout(() => { if (pc === peer && !t.channel) { log('WebRTC channel did not open in time: staying on the WebSocket'); closePeer() } }, OPEN_TIMEOUT_MS)
    await peer.setRemoteDescription({ type: 'offer', sdp })
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    base.send({ t: MsgType.RtcAnswer, sdp: peer.localDescription!.sdp })
  }

  const signaling = (msg: AnyMsg): boolean => {
    if (msg.t === MsgType.RtcOffer) {
      if (!welcomed) { base.send({ t: MsgType.RtcAnswer, error: 'join a room first' }); return true }
      chain = chain.then(() => handleOffer(msg.sdp)).catch(err => { log(`WebRTC offer failed: ${String(err)}`); closePeer(); base.send({ t: MsgType.RtcAnswer, error: 'failed' }) })
      return true
    }
    if (msg.t === MsgType.RtcCandidate) {
      chain = chain.then(async () => {
        if (!pc || typeof msg.candidate !== 'string') return
        await pc.addIceCandidate({ candidate: msg.candidate, sdpMid: msg.sdpMid ?? undefined, sdpMLineIndex: msg.sdpMLineIndex ?? undefined })
      }).catch(() => { /* a candidate that does not apply (late, duplicate): harmless */ })
      return true
    }
    return false
  }

  const t = withUnreliable(base, { role: 'server', signaling })
  const sendVia = t.send
  t.send = msg => { if (msg.t === MsgType.Welcome) welcomed = true; sendVia(msg) }
  base.onClose(() => { closePeer(); t.dispose() })
  return t
}

/**
 * WebRTC settings from the environment, undefined = off (the default: the game works over the WebSocket alone).
 *   FPS_RTC=1                       turn it on
 *   FPS_RTC_PUBLIC_IP=1.2.3.4[,..]  the address(es) browsers must send UDP to: the machine's public IP (required behind NAT / Docker)
 *   FPS_RTC_PORTS=20000-20099       the UDP ports to use, one per connected player (open them in the firewall; default: any free port)
 *   FPS_RTC_MAX=100                 most WebRTC players at the same time (default 200)
 */
export function rtcConfigFromEnv(env: Record<string, string | undefined>): RtcConfig | undefined {
  if (!/^(1|true|yes|on)$/i.test(env.FPS_RTC ?? '')) return undefined
  const cfg: RtcConfig = {}
  const m = /^(\d{1,5})-(\d{1,5})$/.exec((env.FPS_RTC_PORTS ?? '').trim())
  if (m && Number(m[1]) <= Number(m[2]) && Number(m[2]) <= 65535) cfg.portRange = [Number(m[1]), Number(m[2])]
  const ips = (env.FPS_RTC_PUBLIC_IP ?? '').split(',').map(x => x.trim()).filter(Boolean)
  if (ips.length) cfg.publicIps = ips
  const max = Number(env.FPS_RTC_MAX)
  if (Number.isInteger(max) && max > 0) cfg.maxPeers = max
  return cfg
}

/** For tests and the status line */
export function activeRtcPeers(): number { return activePeers }
