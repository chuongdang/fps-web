import { describe, it, expect, afterEach } from 'vitest'
import { RTCPeerConnection } from 'werift'
import { MsgType, decode, encode, type AnyMsg, type SnapshotMsg, type Transport } from '@fps/shared'
import { withServerRtc, activeRtcPeers, rtcConfigFromEnv } from './rtcTransport'
import { handleConnection } from './connection'
import { RoomManager } from './room'

// A werift peer plays the browser: same SDP / ICE / DataChannel protocol, real UDP on localhost.
function fakeBase() {
  const sent: AnyMsg[] = []
  let onMsg: (m: AnyMsg) => void = () => {}
  let onCls: () => void = () => {}
  const t: Transport = { send: m => { sent.push(m) }, onMessage: c => { onMsg = c }, onClose: c => { onCls = c } }
  return { t, sent, emit: (m: AnyMsg) => onMsg(m), close: () => onCls() }
}
const until = async (cond: () => boolean, ms = 10_000, what = 'condition'): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`); await new Promise(r => setTimeout(r, 20)) }
}
const snapshot: SnapshotMsg = { t: MsgType.Snapshot, tick: 3, serverTime: 50, ack: 7, players: [], money: 100 }

const cleanup: (() => void)[] = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

async function connect() {
  const base = fakeBase()
  const server = withServerRtc(base.t, {})
  server.send({ t: MsgType.Welcome } as AnyMsg)   // joined a room: the server now accepts an offer
  base.sent.length = 0
  const client = new RTCPeerConnection({ iceServers: [] })
  cleanup.push(() => { void client.close() }, () => base.close())
  const dc = client.createDataChannel('game', { ordered: false, maxRetransmits: 0 })
  const clientGot: AnyMsg[] = []
  dc.onMessage.subscribe(d => { if (typeof d !== 'string') clientGot.push(decode(d)) })
  client.onIceCandidate.subscribe(c => { if (c) { const j = c.toJSON(); base.emit({ t: MsgType.RtcCandidate, candidate: j.candidate, sdpMid: j.sdpMid, sdpMLineIndex: j.sdpMLineIndex }) } })
  let applied = 0
  const applyServerSignals = async (): Promise<void> => {
    for (; applied < base.sent.length; applied++) {
      const m = base.sent[applied]!
      if (m.t === MsgType.RtcAnswer && m.sdp) await client.setRemoteDescription({ type: 'answer', sdp: m.sdp })
      if (m.t === MsgType.RtcCandidate) await client.addIceCandidate({ candidate: m.candidate, sdpMid: m.sdpMid ?? undefined, sdpMLineIndex: m.sdpMLineIndex ?? undefined })
    }
  }
  await client.setLocalDescription(await client.createOffer())
  base.emit({ t: MsgType.RtcOffer, sdp: client.localDescription!.sdp })
  await until(() => base.sent.some(m => m.t === MsgType.RtcAnswer), 10_000, 'the answer')
  await applyServerSignals()
  const pump = setInterval(() => { void applyServerSignals() }, 50)
  cleanup.push(() => clearInterval(pump))
  await until(() => server.channel !== null && dc.readyState === 'open', 10_000, 'the channel to open')
  return { base, server, client, dc, clientGot }
}

describe('server WebRTC upgrade (real UDP on localhost)', () => {
  it('negotiates over the base transport, then hot messages travel over the channel and the rest over the base', async () => {
    const { base, server, dc, clientGot } = await connect()
    expect(server.unreliableActive!()).toBe(true)

    const serverGot: AnyMsg[] = []
    server.onMessage(m => serverGot.push(m))
    dc.send(Buffer.from(encode({ t: MsgType.Inputs, cmds: [{ seq: 1, buttons: 1, yaw: 0, pitch: 0, weapon: 0 }] })))   // client -> server over the channel
    await until(() => serverGot.length === 1, 5000, 'the inputs')
    expect(serverGot[0]!.t).toBe(MsgType.Inputs)

    const before = base.sent.length
    server.send(snapshot)                                  // server -> client over the channel
    server.send({ t: MsgType.PlayerLeft, id: 3 })          // everything else stays on the WebSocket
    await until(() => clientGot.length === 1, 5000, 'the snapshot')
    expect(clientGot[0]).toMatchObject({ t: MsgType.Snapshot, tick: 3, ack: 7, money: 100 })
    expect(base.sent.slice(before).map(m => m.t)).toEqual([MsgType.PlayerLeft])
    expect(server.stats.sentUnreliable).toBe(1)
  })

  it('a Ping over the channel is answered over the channel', async () => {
    const { server, dc, clientGot } = await connect()
    server.onMessage(m => { if (m.t === MsgType.Ping) server.send({ t: MsgType.Pong, clientTime: m.clientTime, serverTime: 9 }) })
    dc.send(Buffer.from(encode({ t: MsgType.Ping, clientTime: 42 })))
    await until(() => clientGot.some(m => m.t === MsgType.Pong), 5000, 'the pong')
    expect(clientGot.find(m => m.t === MsgType.Pong)).toMatchObject({ clientTime: 42, serverTime: 9 })
  })

  it('closing the WebSocket frees the peer (and its UDP port)', async () => {
    const { base } = await connect()
    expect(activeRtcPeers()).toBeGreaterThan(0)
    const n = activeRtcPeers()
    base.close()
    await until(() => activeRtcPeers() === n - 1, 3000, 'the peer to be freed')
  })

  it('a bad or oversized offer is answered with an error, the connection stays usable', async () => {
    const base = fakeBase()
    withServerRtc(base.t, {}).send({ t: MsgType.Welcome } as AnyMsg); base.sent.length = 0
    base.emit({ t: MsgType.RtcOffer, sdp: '' })
    base.emit({ t: MsgType.RtcOffer, sdp: 'x'.repeat(20_000) })
    await until(() => base.sent.length >= 2, 3000, 'two answers')
    expect(base.sent.every(m => m.t === MsgType.RtcAnswer && !!m.error)).toBe(true)
    const garbage = fakeBase()
    withServerRtc(garbage.t, {}).send({ t: MsgType.Welcome } as AnyMsg); garbage.sent.length = 0
    garbage.emit({ t: MsgType.RtcOffer, sdp: 'this is not sdp' })
    await until(() => garbage.sent.length >= 1, 3000, 'an error answer')
    expect(garbage.sent[0]).toMatchObject({ t: MsgType.RtcAnswer, error: 'bad offer' })
    // something that looks like SDP but has no data channel: the parser is lenient, nothing ever opens, and closing the connection still frees the peer
    const hollow = fakeBase()
    const t = withServerRtc(hollow.t, {}); t.send({ t: MsgType.Welcome } as AnyMsg); hollow.sent.length = 0
    hollow.emit({ t: MsgType.RtcOffer, sdp: 'v=0\r\nbroken' })
    await until(() => hollow.sent.length >= 1, 3000, 'an answer')
    expect(t.channel).toBeNull()
    hollow.close()
    await until(() => activeRtcPeers() === 0, 3000, 'the peer to be freed')
  })

  it('maxPeers: an offer over the limit is refused', async () => {
    const base = fakeBase()
    withServerRtc(base.t, { maxPeers: 0 }).send({ t: MsgType.Welcome } as AnyMsg); base.sent.length = 0
    base.emit({ t: MsgType.RtcOffer, sdp: 'v=0\r\n' })
    await until(() => base.sent.length >= 1, 3000, 'the refusal')
    expect(base.sent[0]).toMatchObject({ t: MsgType.RtcAnswer, error: 'busy' })
  })
})

describe('who may take a UDP port', () => {
  it('an offer before the connection has joined a room is refused, nothing is allocated', () => {
    const base = fakeBase()
    withServerRtc(base.t, {})
    base.emit({ t: MsgType.RtcOffer, sdp: 'v=0\r\n' })
    expect(base.sent).toEqual([{ t: MsgType.RtcAnswer, error: 'join a room first' }])
    expect(activeRtcPeers()).toBe(0)
  })
})

describe('a server without WebRTC', () => {
  it('declines the offer at once, so the client does not wait for a timeout', () => {
    const base = fakeBase()
    const map = { name: 't', boxes: [], ramps: [], spawns: { A: [], B: [] }, buyZones: {} }
    handleConnection({ rooms: new RoomManager(map as never, () => 0), cfg: {} as never, tick: () => 0, now: () => 0, allowDebugCmds: false }, base.t)
    base.emit({ t: MsgType.RtcOffer, sdp: 'v=0\r\n' })
    expect(base.sent).toEqual([{ t: MsgType.RtcAnswer, error: 'disabled' }])
  })
})

describe('rtcConfigFromEnv', () => {
  it('is off unless FPS_RTC is set', () => {
    expect(rtcConfigFromEnv({})).toBeUndefined()
    expect(rtcConfigFromEnv({ FPS_RTC: '0' })).toBeUndefined()
    expect(rtcConfigFromEnv({ FPS_RTC_PUBLIC_IP: '1.2.3.4' })).toBeUndefined()
  })
  it('reads the public ip(s), the UDP port range and the limit; ignores bad values', () => {
    expect(rtcConfigFromEnv({ FPS_RTC: '1' })).toEqual({})
    expect(rtcConfigFromEnv({ FPS_RTC: 'true', FPS_RTC_PUBLIC_IP: '45.77.170.74, 10.0.0.2', FPS_RTC_PORTS: '20000-20099', FPS_RTC_MAX: '50' }))
      .toEqual({ publicIps: ['45.77.170.74', '10.0.0.2'], portRange: [20000, 20099], maxPeers: 50 })
    expect(rtcConfigFromEnv({ FPS_RTC: '1', FPS_RTC_PORTS: '30000-20000', FPS_RTC_MAX: 'abc' })).toEqual({})
    expect(rtcConfigFromEnv({ FPS_RTC: '1', FPS_RTC_PORTS: '1-99999' })).toEqual({})
  })
})

